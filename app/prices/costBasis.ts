import type { Address, PublicClient } from 'viem'
import type {
  IndexedListing,
  IndexedSwap,
  IndexEnvelope,
  PoolSwapStore,
} from '../indexer/types'
import {
  ethPerTokenFromSlot0,
  usdPerTokenFromSideSlot0,
} from './spotMath'

export type CostBasis = {
  avgCostUsd: number
  netTokensFromSwaps: number
  buyNotionalUsd: number
  buyTokens: number
  /** True when wallet balance is not explained by indexed swaps alone. */
  partial: boolean
  matchedSwaps: number
}

function tokenSideAmounts(
  store: PoolSwapStore,
  token: Address,
  ev: IndexedSwap,
): { tokenDelta: bigint; pairDelta: bigint } {
  const a0 = BigInt(ev.amount0)
  const a1 = BigInt(ev.amount1)
  const tok0 = store.key.currency0.toLowerCase() === token.toLowerCase()
  return tok0
    ? { tokenDelta: a0, pairDelta: a1 }
    : { tokenDelta: a1, pairDelta: a0 }
}

/**
 * Pool amounts are pool-side deltas: negative token amount ⇒ tokens left the
 * pool (wallet bought). Positive pair amount ⇒ pair entered the pool (paid).
 */
function classifyBuy(
  tokenDelta: bigint,
  pairDelta: bigint,
): { boughtTokens: bigint; paidPair: bigint } | null {
  if (tokenDelta >= 0n) return null
  const bought = -tokenDelta
  const paid = pairDelta > 0n ? pairDelta : pairDelta < 0n ? -pairDelta : 0n
  return { boughtTokens: bought, paidPair: paid }
}

function pairToUsd(
  paidPair: bigint,
  kind: 'main' | 'side',
  liveEthUsd: number | null,
): number | null {
  if (kind === 'side') return Number(paidPair) / 1e6
  if (liveEthUsd == null || liveEthUsd <= 0) return null
  return (Number(paidPair) / 1e18) * liveEthUsd
}

/**
 * Cost basis from indexed swaps where wallet is swap sender OR tx.origin.
 * Never invents a basis for creator-reserve / transfer inventory.
 */
export async function costBasisForWallet(
  client: PublicClient,
  envelope: IndexEnvelope,
  listing: IndexedListing,
  wallet: Address,
  balanceRaw: bigint,
  liveEthUsd: number | null,
): Promise<CostBasis | null> {
  const meta = envelope.listingSwapMeta?.[listing.listing.toLowerCase()]
  if (!meta || !envelope.swaps) return null

  const stores: PoolSwapStore[] = []
  const main = envelope.swaps[meta.mainPoolId.toLowerCase()]
  if (main) stores.push(main)
  if (meta.sidePoolId) {
    const side = envelope.swaps[meta.sidePoolId.toLowerCase()]
    if (side) stores.push(side)
  }

  const walletLc = wallet.toLowerCase()
  type Cand = { store: PoolSwapStore; ev: IndexedSwap }
  const all: Cand[] = []
  for (const store of stores) {
    for (const ev of store.events) all.push({ store, ev })
  }
  if (all.length === 0) return null

  // Fetch tx.from for swaps where sender isn't the wallet (routers).
  const needTx = [
    ...new Set(
      all
        .filter((c) => c.ev.sender.toLowerCase() !== walletLc)
        .map((c) => c.ev.txHash),
    ),
  ]
  const fromMap = new Map<string, Address>()
  await Promise.all(
    needTx.map(async (hash) => {
      try {
        const tx = await client.getTransaction({ hash })
        fromMap.set(hash.toLowerCase(), tx.from)
      } catch {
        /* skip */
      }
    }),
  )

  let buyTokens = 0n
  let buyNotional = 0
  let matched = 0
  let netTokens = 0n

  for (const { store, ev } of all) {
    const txFrom =
      ev.sender.toLowerCase() === walletLc
        ? wallet
        : fromMap.get(ev.txHash.toLowerCase())
    if (!txFrom) continue
    const mine =
      ev.sender.toLowerCase() === walletLc ||
      txFrom.toLowerCase() === walletLc
    if (!mine) continue
    matched++

    const { tokenDelta, pairDelta } = tokenSideAmounts(store, listing.token, ev)
    // User token delta = opposite of pool token delta
    netTokens += -tokenDelta

    const buy = classifyBuy(tokenDelta, pairDelta)
    if (!buy) continue
    const usd = pairToUsd(buy.paidPair, store.kind, liveEthUsd)
    if (usd == null || usd <= 0) continue
    buyTokens += buy.boughtTokens
    buyNotional += usd
  }

  if (buyTokens === 0n || buyNotional <= 0) return null

  const explained = Number(buyTokens) / 1e18
  const avgCostUsd = buyNotional / explained
  const netHuman = Number(netTokens) / 1e18
  const balHuman = Number(balanceRaw) / 1e18
  // Partial when held balance isn't explained by swap buys (reserve, transfers).
  const partial = balHuman > explained * 1.01 + 1e-4

  return {
    avgCostUsd,
    netTokensFromSwaps: netHuman,
    buyNotionalUsd: buyNotional,
    buyTokens: explained,
    partial,
    matchedSwaps: matched,
  }
}

/** Spot USD from a stored sqrt (for series / offline). */
export function usdFromStoreSqrt(
  store: PoolSwapStore,
  listing: IndexedListing,
  sqrt: bigint,
  liveEthUsd: number | null,
): number {
  if (store.kind === 'side') {
    return usdPerTokenFromSideSlot0(sqrt, store.key, listing.token)
  }
  if (liveEthUsd == null || liveEthUsd <= 0) return 0
  return ethPerTokenFromSlot0(sqrt, store.key) * liveEthUsd
}
