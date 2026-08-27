import {
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type ReadContractParameters,
} from 'viem'
import { ladderAuctionAbi } from '../abi/ladderAuction'
import { launchTokenAbi } from '../abi/launchToken'
import type {
  IndexedAuction,
  LadderAuctionState,
  LadderWalletFill,
} from './ladderTypes'

export type FreshAuctionFiledLog = {
  auction: Address
  creator: Address
  holdbackBps: number
  carveBps: number
  userSalt: Hex
  salt: Hex
  blockNumber: bigint
  logIndex: number
  txHash: Hex
}

const ZERO_STATE: LadderAuctionState = {
  startTime: '0',
  periodIndex: 0,
  rung: '0',
  price: '0',
  raised: '0',
  soldTokens: '0',
  committedTotal: '0',
  done: false,
  graduated: false,
  settled: false,
  uniqueBidders: 0,
  lpHealth: '0',
  liveBudget: '0',
  currentMmax: '0',
  raiseSplit: { toLP: '0', toTreasury: '0', toCreator: '0' },
  holdbackAmount: '0',
  readAt: 0,
}

type McResult = {
  status: 'success' | 'failure'
  result?: unknown
  error?: { shortMessage?: string; message?: string }
}

type ReadCall = {
  address: Address
  abi: Abi
  functionName: string
  args?: readonly unknown[]
}

/**
 * Immutables, in the exact order stateContracts' siblings are emitted below.
 * `token` is absent: it is read in a first pass, because name/symbol/decimals
 * cannot be batched until we know the token address (AuctionFiled does not carry it).
 */
const IMMUTABLE_LABELS = [
  'creator',
  'pairToken',
  'supply',
  'auctionSupply',
  'reserveTokens',
  'floorMcap',
  'floorPrice',
  'threshold',
  'duration',
  'rungStepWad',
  'minBidPair',
  'walletCapBps',
  'holdbackBps',
  'carveBps',
  'cashHoldbackBps',
  'sidePoolBps',
  'createSidePool',
  'liquidityLocked',
  'lpHealthTargetWad',
  'N',
  'pairScaleToWad',
  'settlement',
] as const

const TOKEN_LABELS = ['name', 'symbol', 'decimals'] as const

const STATE_LABELS = [
  'startTime',
  'periodIndex',
  'rung',
  'price',
  'raised',
  'soldTokens',
  'committedTotal',
  'done',
  'graduated',
  'settled',
  'uniqueBidders',
  'lpHealth',
  'liveBudget',
  'currentMmax',
  'raiseSplit',
  'holdbackAmount',
] as const

const HYDRATE_LABELS = [
  ...IMMUTABLE_LABELS,
  ...TOKEN_LABELS,
  ...STATE_LABELS,
] as const

type HydrateLabel = (typeof HYDRATE_LABELS)[number]
type StateLabel = (typeof STATE_LABELS)[number]

const HYDRATE_INDEX = new Map<HydrateLabel, number>(
  HYDRATE_LABELS.map((l, i) => [l, i]),
)
const STATE_INDEX = new Map<StateLabel, number>(
  STATE_LABELS.map((l, i) => [l, i]),
)

const HYDRATE_STRIDE = HYDRATE_LABELS.length
const STATE_STRIDE = STATE_LABELS.length

/**
 * Computed views rather than storage: they run library maths over the bidder list,
 * so a degenerate config can revert one without the card being unreadable.
 * They default to 0 instead of failing the whole row.
 */
const OPTIONAL_LABELS: readonly HydrateLabel[] = [
  'liveBudget',
  'currentMmax',
  'raiseSplit',
  'holdbackAmount',
  'decimals',
]

function fieldError(
  results: McResult[],
  base: number,
  labels: readonly string[],
): string | null {
  const missing: string[] = []
  for (let i = 0; i < labels.length; i++) {
    const r = results[base + i]
    if (!r || r.status !== 'success' || r.result == null) {
      const detail = r?.error?.shortMessage || r?.error?.message || 'no result'
      missing.push(`${labels[i]} (${detail})`)
    }
  }
  return missing.length ? missing.join('; ') : null
}

async function runMulticall(
  client: PublicClient,
  contracts: ReadCall[],
): Promise<McResult[]> {
  if (contracts.length === 0) return []
  try {
    return (await client.multicall({
      contracts,
      allowFailure: true,
    })) as McResult[]
  } catch (err) {
    // Fallback: sequential reads (e.g. multicall3 misconfigured)
    console.error(
      '[ladder] multicall threw — falling back to sequential reads:',
      err instanceof Error ? err.message : err,
    )
    const out: McResult[] = []
    for (const c of contracts) {
      try {
        const result = await client.readContract(
          c as unknown as ReadContractParameters,
        )
        out.push({ status: 'success', result })
      } catch (e) {
        out.push({
          status: 'failure',
          error: { shortMessage: e instanceof Error ? e.message : String(e) },
        })
      }
    }
    return out
  }
}

function stateContracts(auction: Address): ReadCall[] {
  return STATE_LABELS.map((functionName) => ({
    address: auction,
    abi: ladderAuctionAbi,
    functionName,
  }))
}

function hydrateContracts(
  auction: Address,
  token: Address,
): ReadCall[] {
  return [
    ...IMMUTABLE_LABELS.map((functionName) => ({
      address: auction,
      abi: ladderAuctionAbi as Abi,
      functionName,
    })),
    ...TOKEN_LABELS.map((functionName) => ({
      address: token,
      abi: launchTokenAbi as Abi,
      functionName,
    })),
    ...stateContracts(auction),
  ]
}

function decodeState(results: McResult[], base: number): LadderAuctionState {
  const pick = <T,>(label: StateLabel, fallback: T): T => {
    const r = results[base + STATE_INDEX.get(label)!]
    if (!r || r.status !== 'success' || r.result == null) return fallback
    return r.result as T
  }
  const split = pick<readonly [bigint, bigint, bigint]>('raiseSplit', [
    0n,
    0n,
    0n,
  ])
  return {
    startTime: pick<bigint>('startTime', 0n).toString(),
    periodIndex: pick<number>('periodIndex', 0),
    rung: pick<bigint>('rung', 0n).toString(),
    price: pick<bigint>('price', 0n).toString(),
    raised: pick<bigint>('raised', 0n).toString(),
    soldTokens: pick<bigint>('soldTokens', 0n).toString(),
    committedTotal: pick<bigint>('committedTotal', 0n).toString(),
    done: pick<boolean>('done', false),
    graduated: pick<boolean>('graduated', false),
    settled: pick<boolean>('settled', false),
    uniqueBidders: pick<number>('uniqueBidders', 0),
    lpHealth: pick<bigint>('lpHealth', 0n).toString(),
    liveBudget: pick<bigint>('liveBudget', 0n).toString(),
    currentMmax: pick<bigint>('currentMmax', 0n).toString(),
    raiseSplit: {
      toLP: split[0].toString(),
      toTreasury: split[1].toString(),
      toCreator: split[2].toString(),
    },
    holdbackAmount: pick<bigint>('holdbackAmount', 0n).toString(),
    readAt: Date.now(),
  }
}

function unreadableCard(
  L: FreshAuctionFiledLog,
  token: Address,
  error: string,
): IndexedAuction {
  console.error(
    `[ladder] hydrate failed auction=${L.auction} token=${token}: ${error}`,
  )
  return {
    v: 1,
    auction: L.auction,
    token,
    creator: L.creator,
    userSalt: L.userSalt,
    salt: L.salt,
    blockNumber: L.blockNumber.toString(),
    logIndex: L.logIndex,
    txHash: L.txHash,
    name: 'unreadable',
    symbol: '???',
    decimals: 18,
    pairToken: zeroAddress,
    supply: '0',
    auctionSupply: '0',
    reserveTokens: '0',
    floorMcap: '0',
    floorPrice: '0',
    threshold: '0',
    duration: '0',
    rungStepWad: '0',
    minBidPair: '0',
    walletCapBps: 0,
    // AuctionFiled carries these two, so they survive an unreadable auction.
    holdbackBps: L.holdbackBps,
    carveBps: L.carveBps,
    cashHoldbackBps: 0,
    sidePoolBps: 0,
    createSidePool: false,
    liquidityLocked: false,
    lpHealthTargetWad: '0',
    n: 0,
    pairScaleToWad: '1',
    settlement: zeroAddress,
    state: { ...ZERO_STATE, readAt: Date.now() },
    hydratedAt: Date.now(),
    hydrateError: error,
  }
}

/** First pass: token() per auction, so the metadata reads can join the main batch. */
async function readAuctionTokens(
  client: PublicClient,
  auctions: Address[],
): Promise<Address[]> {
  const results = await runMulticall(
    client,
    auctions.map((address) => ({
      address,
      abi: ladderAuctionAbi,
      functionName: 'token',
    })),
  )
  return auctions.map((_, i) => {
    const r = results[i]
    if (!r || r.status !== 'success' || r.result == null) return zeroAddress
    return r.result as Address
  })
}

export async function hydrateAuctions(
  client: PublicClient,
  logs: FreshAuctionFiledLog[],
): Promise<IndexedAuction[]> {
  if (logs.length === 0) return []

  const tokens = await readAuctionTokens(
    client,
    logs.map((L) => L.auction),
  )
  const results = await runMulticall(
    client,
    logs.flatMap((L, i) => hydrateContracts(L.auction, tokens[i]!)),
  )

  const required = HYDRATE_LABELS.filter((l) => !OPTIONAL_LABELS.includes(l))
  const out: IndexedAuction[] = []

  for (let i = 0; i < logs.length; i++) {
    const base = i * HYDRATE_STRIDE
    const L = logs[i]!
    const token = tokens[i]!

    // Required labels are interleaved with optional ones, so probe by name
    // rather than over a contiguous slice.
    const missing = required
      .map((label) => {
        const r = results[base + HYDRATE_INDEX.get(label)!]
        if (r && r.status === 'success' && r.result != null) return null
        const detail = r?.error?.shortMessage || r?.error?.message || 'no result'
        return `${label} (${detail})`
      })
      .filter((m): m is string => m != null)

    if (token === zeroAddress) missing.unshift('token (no result)')
    if (missing.length > 0) {
      out.push(unreadableCard(L, token, missing.join('; ')))
      continue
    }

    const pick = <T,>(label: HydrateLabel): T =>
      results[base + HYDRATE_INDEX.get(label)!]!.result as T

    out.push({
      v: 1,
      auction: L.auction,
      token,
      creator: pick<Address>('creator'),
      userSalt: L.userSalt,
      salt: L.salt,
      blockNumber: L.blockNumber.toString(),
      logIndex: L.logIndex,
      txHash: L.txHash,
      name: pick<string>('name'),
      symbol: pick<string>('symbol'),
      decimals: Number(
        results[base + HYDRATE_INDEX.get('decimals')!]?.result ?? 18,
      ),
      pairToken: pick<Address>('pairToken'),
      supply: pick<bigint>('supply').toString(),
      auctionSupply: pick<bigint>('auctionSupply').toString(),
      reserveTokens: pick<bigint>('reserveTokens').toString(),
      floorMcap: pick<bigint>('floorMcap').toString(),
      floorPrice: pick<bigint>('floorPrice').toString(),
      threshold: pick<bigint>('threshold').toString(),
      duration: pick<bigint>('duration').toString(),
      rungStepWad: pick<bigint>('rungStepWad').toString(),
      minBidPair: pick<bigint>('minBidPair').toString(),
      walletCapBps: pick<number>('walletCapBps'),
      holdbackBps: pick<number>('holdbackBps'),
      carveBps: pick<number>('carveBps'),
      cashHoldbackBps: pick<number>('cashHoldbackBps'),
      sidePoolBps: pick<number>('sidePoolBps'),
      createSidePool: pick<boolean>('createSidePool'),
      liquidityLocked: pick<boolean>('liquidityLocked'),
      lpHealthTargetWad: pick<bigint>('lpHealthTargetWad').toString(),
      n: pick<number>('N'),
      pairScaleToWad: pick<bigint>('pairScaleToWad').toString(),
      settlement: pick<Address>('settlement'),
      state: decodeState(
        results,
        base + IMMUTABLE_LABELS.length + TOKEN_LABELS.length,
      ),
      hydratedAt: Date.now(),
    })
  }
  return out
}

/**
 * Hydrate a single auction by address when it is not yet in the local index.
 * The AuctionFiled stamps are unavailable off-chain, so creator comes from the
 * contract and the salts/tx are left zeroed. Returns null if no code or getters revert.
 */
export async function hydrateAuctionByAddress(
  client: PublicClient,
  auction: Address,
): Promise<IndexedAuction | null> {
  const code = await client.getBytecode({ address: auction })
  if (!code || code === '0x') return null

  try {
    const [creator, holdbackBps, carveBps] = await Promise.all([
      client.readContract({
        address: auction,
        abi: ladderAuctionAbi,
        functionName: 'creator',
      }),
      client.readContract({
        address: auction,
        abi: ladderAuctionAbi,
        functionName: 'holdbackBps',
      }),
      client.readContract({
        address: auction,
        abi: ladderAuctionAbi,
        functionName: 'carveBps',
      }),
    ])
    const zeroBytes32 = ('0x' + '00'.repeat(32)) as Hex
    const [record] = await hydrateAuctions(client, [
      {
        auction,
        creator,
        holdbackBps,
        carveBps,
        userSalt: zeroBytes32,
        salt: zeroBytes32,
        blockNumber: 0n,
        logIndex: 0,
        txHash: zeroBytes32,
      },
    ])
    if (!record || record.hydrateError) return null
    return { ...record, notYetIndexed: true }
  } catch (err) {
    console.error(
      '[ladder] hydrateAuctionByAddress failed:',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

/**
 * Re-read the MUTABLE slots only. A live auction moves every block, but the
 * immutables cannot, so a poll tick must never pay for them again.
 */
export async function refreshAuctionState(
  client: PublicClient,
  auction: Address,
): Promise<LadderAuctionState | null> {
  const results = await runMulticall(client, stateContracts(auction))
  const missing = STATE_LABELS.filter((label, i) => {
    if (OPTIONAL_LABELS.includes(label)) return false
    const r = results[i]
    return !r || r.status !== 'success' || r.result == null
  })
  if (missing.length > 0) {
    console.error(
      `[ladder] refreshAuctionState ${auction} — missing ${missing.join(', ')}`,
    )
    return null
  }
  return decodeState(results, 0)
}

/** Batched variant for the polling loop — one multicall for every live auction. */
export async function refreshAuctionStates(
  client: PublicClient,
  auctions: Address[],
): Promise<Map<string, LadderAuctionState>> {
  const out = new Map<string, LadderAuctionState>()
  if (auctions.length === 0) return out
  const results = await runMulticall(
    client,
    auctions.flatMap((a) => stateContracts(a)),
  )
  for (let i = 0; i < auctions.length; i++) {
    const base = i * STATE_STRIDE
    const slice = results.slice(base, base + STATE_STRIDE)
    // A wholly failed slice means the RPC dropped the row — keep the old snapshot.
    if (slice.every((r) => !r || r.status !== 'success')) continue
    out.set(auctions[i]!.toLowerCase(), decodeState(results, base))
  }
  return out
}

/**
 * Per-wallet position for a "my bid" panel. Both halves are returned because they
 * disagree on units by design — see LadderWalletFill.
 */
export async function readWalletFill(
  client: PublicClient,
  auction: Address,
  wallet: Address,
): Promise<LadderWalletFill | null> {
  const results = await runMulticall(client, [
    {
      address: auction,
      abi: ladderAuctionAbi,
      functionName: 'fillOf',
      args: [wallet],
    },
    {
      address: auction,
      abi: ladderAuctionAbi,
      functionName: 'wallets',
      args: [wallet],
    },
  ])
  const fill = results[0]
  const w = results[1]
  if (!fill || fill.status !== 'success' || fill.result == null) {
    console.error(
      `[ladder] readWalletFill ${auction}: ${fieldError(results, 0, ['fillOf', 'wallets'])}`,
    )
    return null
  }
  const f = fill.result as readonly [bigint, bigint, bigint, bigint]
  const s =
    w && w.status === 'success' && w.result != null
      ? (w.result as readonly [
          bigint,
          bigint,
          bigint,
          bigint,
          bigint,
          boolean,
          boolean,
          boolean,
        ])
      : null
  return {
    wallet,
    committed: f[0].toString(),
    spent: f[1].toString(),
    tokens: f[2].toString(),
    refund: f[3].toString(),
    committedWad: (s?.[0] ?? 0n).toString(),
    spentWad: (s?.[1] ?? 0n).toString(),
    refundClaimableWad: (s?.[4] ?? 0n).toString(),
    maxPrice: (s?.[3] ?? 0n).toString(),
    exists: s?.[5] ?? false,
    refundClaimed: s?.[6] ?? false,
    tokensClaimed: s?.[7] ?? false,
    readAt: Date.now(),
  }
}
