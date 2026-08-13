import type { Address, Hex, PublicClient } from 'viem'
import { directListingAbi } from '../abi/directListing'
import { launchTokenAbi } from '../abi/launchToken'
import type { IndexedListing } from './types'

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

export async function hydrateListings(
  client: PublicClient,
  logs: FreshExpressLog[],
): Promise<IndexedListing[]> {
  if (logs.length === 0) return []

  const contracts = logs.flatMap((L) => [
    { address: L.listing, abi: directListingAbi, functionName: 'startMcap' as const },
    { address: L.listing, abi: directListingAbi, functionName: 'totalSupply' as const },
    { address: L.listing, abi: directListingAbi, functionName: 'startPriceWad' as const },
    { address: L.listing, abi: directListingAbi, functionName: 'creatorReserve' as const },
    { address: L.listing, abi: directListingAbi, functionName: 'creatorReserveState' as const },
    { address: L.listing, abi: directListingAbi, functionName: 'liquidityLocked' as const },
    { address: L.listing, abi: directListingAbi, functionName: 'createSidePool' as const },
    { address: L.listing, abi: directListingAbi, functionName: 'sidePoolBps' as const },
    { address: L.listing, abi: directListingAbi, functionName: 'sidePoolDeployed' as const },
    { address: L.listing, abi: directListingAbi, functionName: 'mainKey' as const },
    { address: L.token, abi: launchTokenAbi, functionName: 'name' as const },
    { address: L.token, abi: launchTokenAbi, functionName: 'symbol' as const },
  ])

  const results = await client.multicall({ contracts, allowFailure: true })
  const out: IndexedListing[] = []
  const stride = 12

  for (let i = 0; i < logs.length; i++) {
    const base = i * stride
    const L = logs[i]
    const startMcap = results[base]?.result as bigint | undefined
    const totalSupply = results[base + 1]?.result as bigint | undefined
    const startPriceWad = results[base + 2]?.result as bigint | undefined
    const creatorReserve = results[base + 3]?.result as bigint | undefined
    const reserveState = results[base + 4]?.result as
      | readonly [number, bigint, bigint, bigint, bigint, boolean]
      | undefined
    const liquidityLocked = results[base + 5]?.result as boolean | undefined
    const createSidePool = results[base + 6]?.result as boolean | undefined
    const sidePoolBps = results[base + 7]?.result as number | undefined
    const sidePoolDeployed = results[base + 8]?.result as boolean | undefined
    const mainKey = results[base + 9]?.result as
      | {
          currency0: Address
          currency1: Address
          fee: number
          tickSpacing: number
          hooks: Address
        }
      | undefined
    const name = results[base + 10]?.result as string | undefined
    const symbol = results[base + 11]?.result as string | undefined

    if (
      startMcap == null ||
      totalSupply == null ||
      startPriceWad == null ||
      creatorReserve == null ||
      reserveState == null ||
      liquidityLocked == null ||
      createSidePool == null ||
      sidePoolBps == null ||
      sidePoolDeployed == null ||
      mainKey == null ||
      name == null ||
      symbol == null
    ) {
      continue
    }

    out.push({
      v: 1,
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
    })
  }
  return out
}

/** Refetch mutable fields only (sidePoolDeployed + creatorReserveState). */
export async function refreshMutable(
  client: PublicClient,
  listing: Address,
): Promise<{
  sidePoolDeployed: boolean
  creatorReserveState: IndexedListing['creatorReserveState']
} | null> {
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
    // Instant
    if (nowTs >= unlockedAt) {
      return { vested: total, unvested: 0n, claimable: total - claimed }
    }
    return { vested: 0n, unvested: total, claimable: 0n }
  }
  // Vest
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
