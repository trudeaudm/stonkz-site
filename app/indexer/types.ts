import type { Address, Hex } from 'viem'

/** v2 — clears stale v1 envelopes that advanced cursor past filings after hydrate threw. */
export const INDEX_CACHE_PREFIX = 'stonkz:index:v2:'
/** Root prefix — GC drops any prior schema version under this. */
export const INDEX_CACHE_ROOT = 'stonkz:index:'

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
  v: 2
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
  /** Present when createSidePool and sideKey() answered. */
  sidePoolKey?: MainPoolKey
  // mutable — refetch on detail open
  sidePoolDeployed: boolean
  hydratedAt: number
  /** Set when hydrated by address outside the local index (pre-scan). */
  notYetIndexed?: boolean
  /** Immutable ETH/USD stamp — V2+ listings; absent/0 on V1-era objects. */
  ethUsdWad?: string
  /**
   * Set when ExpressListed was indexed but one or more getters failed.
   * Rendered as an error card — never silently dropped.
   */
  hydrateError?: string
}

/** One decoded PoolManager Swap (serializable). */
export type IndexedSwap = {
  blockNumber: string
  logIndex: number
  txHash: Hex
  sender: Address
  amount0: string
  amount1: string
  sqrtPriceX96: string
  liquidity: string
  tick: number
  fee: number
  /** Lazy-filled for cost-basis (tx.from). */
  txFrom?: Address
}

/**
 * Cap stored raw events per pool: keep all if under RAW_SWAP_SOFT_CAP;
 * else keep bucketed series + trailing RAW_SWAP_TRAIL raw.
 * (see applySwapCap in swaps.ts)
 */
export const RAW_SWAP_SOFT_CAP = 5000
export const RAW_SWAP_TRAIL = 500

export type SwapPriceBucket = {
  block: string
  sqrtPriceX96: string
}

export type PoolSwapStore = {
  poolId: Hex
  listing: Address
  kind: 'main' | 'side'
  key: MainPoolKey
  /** Next block to scan (inclusive). Advances ONLY after decode+persist. */
  cursor: string
  fromBlock: string
  events: IndexedSwap[]
  /** Populated when raw events were capped past RAW_SWAP_SOFT_CAP. */
  buckets?: SwapPriceBucket[]
  lastSwapBlock: string
  lastSqrtPriceX96: string
  swapCount: number
  /** Gross |token-side| volume in raw token units. */
  volumeTokenRaw: string
  /** Gross |pair-side| volume in raw pair units (ETH wei or USDG base units). */
  volumePairRaw: string
}

export type ListingSwapMeta = {
  listing: Address
  mainPoolId: Hex
  sidePoolId?: Hex
  /** Pool with higher lastSwapBlock; main if neither has swapped. */
  activePool: 'main' | 'side'
}

export type IndexEnvelope = {
  v: 2
  chainId: number
  factory: Address
  cursor: string // next block to scan (inclusive)
  fromBlock: string
  listings: IndexedListing[]
  updatedAt: number
  /** swaps:<poolId> — keyed by lowercase poolId hex. */
  swaps?: Record<string, PoolSwapStore>
  /** listing → pool association + activePool. */
  listingSwapMeta?: Record<string, ListingSwapMeta>
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
