import { getAddress, pad, toHex, type Address, type Hex, type PublicClient } from 'viem'
import { directListingAbi } from '../abi/directListing'
import { launchTokenAbi } from '../abi/launchToken'
import type { IndexedListing, MainPoolKey } from './types'

export type FreshExpressLog = {
  listing: Address
  token: Address
  creator: Address
  userSalt: Hex
  salt: Hex
  blockNumber: bigint
  logIndex: number
  txHash: Hex
}

const ZERO_ADDR = getAddress(pad(toHex(0), { size: 20 }))
const EMPTY_POOL_KEY: MainPoolKey = {
  currency0: ZERO_ADDR,
  currency1: ZERO_ADDR,
  fee: 0,
  tickSpacing: 0,
  hooks: ZERO_ADDR,
}
const EMPTY_RESERVE: IndexedListing['creatorReserveState'] = {
  mode: 0,
  vestDuration: '0',
  unlockedAt: '0',
  total: '0',
  claimed: '0',
  filed: false,
}

type McResult = {
  status: 'success' | 'failure'
  result?: unknown
  error?: { shortMessage?: string; message?: string }
}

function fieldError(
  results: McResult[],
  base: number,
  labels: string[],
): string | null {
  const missing: string[] = []
  for (let i = 0; i < labels.length; i++) {
    const r = results[base + i]
    if (!r || r.status !== 'success' || r.result == null) {
      const detail =
        r?.error?.shortMessage || r?.error?.message || 'no result'
      missing.push(`${labels[i]} (${detail})`)
    }
  }
  return missing.length ? missing.join('; ') : null
}

function unreadableCard(L: FreshExpressLog, error: string): IndexedListing {
  console.error(
    `[indexer] hydrate failed listing=${L.listing} token=${L.token}: ${error}`,
  )
  return {
    v: 2,
    listing: L.listing,
    token: L.token,
    creator: L.creator,
    userSalt: L.userSalt,
    salt: L.salt,
    blockNumber: L.blockNumber.toString(),
    logIndex: L.logIndex,
    txHash: L.txHash,
    name: 'unreadable',
    symbol: '???',
    startMcap: '0',
    totalSupply: '0',
    startPriceWad: '0',
    creatorReserve: '0',
    creatorReserveState: EMPTY_RESERVE,
    liquidityLocked: false,
    createSidePool: false,
    sidePoolBps: 0,
    mainPoolKey: EMPTY_POOL_KEY,
    sidePoolDeployed: false,
    hydratedAt: Date.now(),
    hydrateError: error,
  }
}

const HYDRATE_LABELS = [
  'startMcap',
  'totalSupply',
  'startPriceWad',
  'creatorReserve',
  'creatorReserveState',
  'liquidityLocked',
  'createSidePool',
  'sidePoolBps',
  'sidePoolDeployed',
  'mainKey',
  'name',
  'symbol',
  'ethUsdWad',
] as const

const STRIDE = HYDRATE_LABELS.length

function hydrateContracts(logs: FreshExpressLog[]) {
  return logs.flatMap((L) => [
    { address: L.listing, abi: directListingAbi, functionName: 'startMcap' as const },
    { address: L.listing, abi: directListingAbi, functionName: 'totalSupply' as const },
    { address: L.listing, abi: directListingAbi, functionName: 'startPriceWad' as const },
    { address: L.listing, abi: directListingAbi, functionName: 'creatorReserve' as const },
    {
      address: L.listing,
      abi: directListingAbi,
      functionName: 'creatorReserveState' as const,
    },
    {
      address: L.listing,
      abi: directListingAbi,
      functionName: 'liquidityLocked' as const,
    },
    {
      address: L.listing,
      abi: directListingAbi,
      functionName: 'createSidePool' as const,
    },
    { address: L.listing, abi: directListingAbi, functionName: 'sidePoolBps' as const },
    {
      address: L.listing,
      abi: directListingAbi,
      functionName: 'sidePoolDeployed' as const,
    },
    { address: L.listing, abi: directListingAbi, functionName: 'mainKey' as const },
    { address: L.token, abi: launchTokenAbi, functionName: 'name' as const },
    { address: L.token, abi: launchTokenAbi, functionName: 'symbol' as const },
    { address: L.listing, abi: directListingAbi, functionName: 'ethUsdWad' as const },
  ])
}

async function runHydrateMulticall(
  client: PublicClient,
  logs: FreshExpressLog[],
): Promise<McResult[]> {
  const contracts = hydrateContracts(logs)
  try {
    return (await client.multicall({
      contracts,
      allowFailure: true,
    })) as McResult[]
  } catch (err) {
    // Fallback: sequential reads (e.g. multicall3 misconfigured)
    console.error(
      '[indexer] multicall threw — falling back to sequential reads:',
      err instanceof Error ? err.message : err,
    )
    const out: McResult[] = []
    for (const c of contracts) {
      try {
        const result = await client.readContract(c)
        out.push({ status: 'success', result })
      } catch (e) {
        out.push({
          status: 'failure',
          error: {
            shortMessage: e instanceof Error ? e.message : String(e),
          },
        })
      }
    }
    return out
  }
}

export async function hydrateListings(
  client: PublicClient,
  logs: FreshExpressLog[],
): Promise<IndexedListing[]> {
  if (logs.length === 0) return []

  const results = await runHydrateMulticall(client, logs)
  const out: IndexedListing[] = []

  for (let i = 0; i < logs.length; i++) {
    const base = i * STRIDE
    const L = logs[i]
    // ethUsdWad is optional (V1 listings revert) — exclude from required check
    const requiredLabels = HYDRATE_LABELS.slice(0, -1)
    const err = fieldError(results, base, [...requiredLabels])
    if (err) {
      out.push(unreadableCard(L, err))
      continue
    }

    const startMcap = results[base]!.result as bigint
    const totalSupply = results[base + 1]!.result as bigint
    const startPriceWad = results[base + 2]!.result as bigint
    const creatorReserve = results[base + 3]!.result as bigint
    const reserveState = results[base + 4]!.result as readonly [
      number,
      bigint,
      bigint,
      bigint,
      bigint,
      boolean,
    ]
    const liquidityLocked = results[base + 5]!.result as boolean
    const createSidePool = results[base + 6]!.result as boolean
    const sidePoolBps = results[base + 7]!.result as number
    const sidePoolDeployed = results[base + 8]!.result as boolean
    const mainKey = results[base + 9]!.result as {
      currency0: Address
      currency1: Address
      fee: number
      tickSpacing: number
      hooks: Address
    }
    const name = results[base + 10]!.result as string
    const symbol = results[base + 11]!.result as string
    const ethUsdWad =
      results[base + 12]?.status === 'success'
        ? (results[base + 12]!.result as bigint)
        : undefined

    out.push({
      v: 2,
      listing: L.listing,
      token: L.token,
      creator: L.creator,
      userSalt: L.userSalt,
      salt: L.salt,
      blockNumber: L.blockNumber.toString(),
      logIndex: L.logIndex,
      txHash: L.txHash,
      name,
      symbol,
      startMcap: startMcap.toString(),
      totalSupply: totalSupply.toString(),
      startPriceWad: startPriceWad.toString(),
      creatorReserve: creatorReserve.toString(),
      creatorReserveState: {
        mode: reserveState[0],
        vestDuration: reserveState[1].toString(),
        unlockedAt: reserveState[2].toString(),
        total: reserveState[3].toString(),
        claimed: reserveState[4].toString(),
        filed: reserveState[5],
      },
      liquidityLocked,
      createSidePool,
      sidePoolBps,
      mainPoolKey: {
        currency0: mainKey.currency0,
        currency1: mainKey.currency1,
        fee: mainKey.fee,
        tickSpacing: mainKey.tickSpacing,
        hooks: mainKey.hooks,
      },
      sidePoolDeployed,
      hydratedAt: Date.now(),
      ethUsdWad: ethUsdWad != null ? ethUsdWad.toString() : undefined,
    })
  }
  return out
}

/**
 * Hydrate a single listing by address when it is not yet in the local index.
 * Reads self-describing getters; token via token(). Returns null if no code or getters revert.
 */
export async function hydrateListingByAddress(
  client: PublicClient,
  listing: Address,
): Promise<IndexedListing | null> {
  const code = await client.getBytecode({ address: listing })
  if (!code || code === '0x') return null

  try {
    const token = await client.readContract({
      address: listing,
      abi: directListingAbi,
      functionName: 'token',
    })
    const fakeLog: FreshExpressLog = {
      listing,
      token,
      creator: ZERO_ADDR,
      userSalt: ('0x' + '00'.repeat(32)) as Hex,
      salt: ('0x' + '00'.repeat(32)) as Hex,
      blockNumber: 0n,
      logIndex: 0,
      txHash: ('0x' + '00'.repeat(32)) as Hex,
    }
    // Reuse batch path with creator override from chain
    const creator = await client.readContract({
      address: listing,
      abi: directListingAbi,
      functionName: 'creator',
    })
    fakeLog.creator = creator
    const [record] = await hydrateListings(client, [fakeLog])
    if (!record || record.hydrateError) return null
    return { ...record, notYetIndexed: true }
  } catch (err) {
    console.error(
      '[indexer] hydrateListingByAddress failed:',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

/** Refetch mutable fields only (sidePoolDeployed + creatorReserveState). */
export async function refreshMutable(
  client: PublicClient,
  listing: Address,
): Promise<{
  sidePoolDeployed: boolean
  creatorReserveState: IndexedListing['creatorReserveState']
} | null> {
  try {
    const results = await client.multicall({
      contracts: [
        {
          address: listing,
          abi: directListingAbi,
          functionName: 'sidePoolDeployed',
        },
        {
          address: listing,
          abi: directListingAbi,
          functionName: 'creatorReserveState',
        },
      ],
      allowFailure: true,
    })
    const sidePoolDeployed = results[0]?.result as boolean | undefined
    const reserveState = results[1]?.result as
      | readonly [number, bigint, bigint, bigint, bigint, boolean]
      | undefined
    if (sidePoolDeployed == null || reserveState == null) return null
    return {
      sidePoolDeployed,
      creatorReserveState: {
        mode: reserveState[0],
        vestDuration: reserveState[1].toString(),
        unlockedAt: reserveState[2].toString(),
        total: reserveState[3].toString(),
        claimed: reserveState[4].toString(),
        filed: reserveState[5],
      },
    }
  } catch (err) {
    console.error(
      '[indexer] refreshMutable failed:',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

/**
 * CreatorReserveLib.vestedAvailable — NOTES / recon-2 rules.
 * Instant: full total after unlockedAt. Vest: linear over vestDuration.
 */
export function vestedAvailable(
  state: IndexedListing['creatorReserveState'],
  nowTs: bigint,
): { vested: bigint; unvested: bigint; claimable: bigint } {
  const total = BigInt(state.total)
  const claimed = BigInt(state.claimed)
  const unlockedAt = BigInt(state.unlockedAt)
  const vestDuration = BigInt(state.vestDuration)
  if (total === 0n || unlockedAt === 0n) {
    return { vested: 0n, unvested: total, claimable: 0n }
  }
  if (state.mode === 0) {
    if (nowTs >= unlockedAt) {
      return { vested: total, unvested: 0n, claimable: total - claimed }
    }
    return { vested: 0n, unvested: total, claimable: 0n }
  }
  if (nowTs < unlockedAt) {
    return { vested: 0n, unvested: total, claimable: 0n }
  }
  const elapsed = nowTs - unlockedAt
  let accrued: bigint
  if (vestDuration === 0n || elapsed >= vestDuration) accrued = total
  else accrued = (total * elapsed) / vestDuration
  const claimable = accrued > claimed ? accrued - claimed : 0n
  return {
    vested: accrued,
    unvested: total > accrued ? total - accrued : 0n,
    claimable,
  }
}
