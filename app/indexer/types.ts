import type { Address, Hex } from 'viem'

export const INDEX_CACHE_PREFIX = 'stonkz:index:v1:'

export type CreatorReserveState = {
  mode: number
  vestDuration: string
  unlockedAt: string
  total: string
  claimed: string
  filed: boolean
}

export type MainPoolKey = {
  currency0: Address
  currency1: Address
  fee: number
  tickSpacing: number
  hooks: Address
}

/** Serializable hydrated listing — immutable stamps + mutable flags. */
export type IndexedListing = {
  v: 1
  listing: Address
  token: Address
  creator: Address
  userSalt: Hex
  salt: Hex
  blockNumber: string
  logIndex: number
  txHash: Hex
  // immutable (from chain at hydrate)
  name: string
  symbol: string
  startMcap: string
  totalSupply: string
  startPriceWad: string
  creatorReserve: string
  creatorReserveState: CreatorReserveState
  liquidityLocked: boolean
  createSidePool: boolean
  sidePoolBps: number
  mainPoolKey: MainPoolKey
  // mutable — refetch on detail open
  sidePoolDeployed: boolean
  hydratedAt: number
  /** Set when hydrated by address outside the local index (pre-scan). */
  notYetIndexed?: boolean
  /** Immutable ETH/USD stamp — V2 listings only; absent/0 on V1-era objects. */
  ethUsdWad?: string
}

export type IndexEnvelope = {
  v: 1
  chainId: number
  factory: Address
  cursor: string // next block to scan (inclusive)
  fromBlock: string
  listings: IndexedListing[]
  updatedAt: number
}

export type ScanProgress = {
  fromBlock: bigint
  cursor: bigint
  head: bigint
  percent: number
  chunkSize: number
  status: 'idle' | 'scanning' | 'done' | 'error'
  message: string
}

export function cacheKey(chainId: number, factory: Address): string {
  return `${INDEX_CACHE_PREFIX}${chainId}:${factory.toLowerCase()}`
}
