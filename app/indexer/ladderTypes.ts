import type { Address, Hex } from 'viem'

/** v1 — first ladder schema. Bump to orphan every cached ladder envelope. */
export const LADDER_CACHE_PREFIX = 'stonkz:ladder:v1:'
/**
 * Root prefix — GC drops any prior schema version under this.
 * Deliberately NOT under INDEX_CACHE_ROOT: gcStaleIndexKeys deletes everything
 * beneath `stonkz:index:` that is not the live express key, so a ladder envelope
 * parked there would be wiped by the next express scan.
 */
export const LADDER_CACHE_ROOT = 'stonkz:ladder:'

/** `N` is a contract constant. Periods are 1-indexed — pathPrice(0) returns 0 by definition. */
export const LADDER_N = 1000

/**
 * Derived, never stored on chain. Order of the checks matters: `done` wins over
 * `startTime`, because the owner-only test fast-forwards can finalise a book that
 * was never formally started.
 *
 *  - 'filed'                startTime === 0. Deployed and indexable but the clock has
 *                           never run. `start()` or the first `placeBid` stamps
 *                           startTime, so an auction can sit here indefinitely.
 *  - 'live'                 startTime > 0 && !done. periodIndex advances on any _sync().
 *  - 'failed'               done && !graduated. A gate (raise or lpHealth) failed at the
 *                           bell; bidders are owed their FULL committed back and there is
 *                           no token exit at all — settle() reverts NotGraduated.
 *  - 'ended_pending_settle' done && graduated && !settled. settle() is permissionless and
 *                           nobody has called it yet; tokens stay locked until they do.
 *  - 'graduated'            done && graduated && settled. LP is live, claimTokens is open.
 */
export type LadderStatus =
  | 'filed'
  | 'live'
  | 'ended_pending_settle'
  | 'graduated'
  | 'failed'

/**
 * Everything that can change between two blocks. Split out from the immutables so a
 * polling tick re-reads 16 slots instead of 42.
 */
export type LadderAuctionState = {
  /** Unix seconds. 0 until start()/first placeBid — see LadderStatus 'filed'. */
  startTime: string
  /** 1-indexed period last cleared. 0 before the first clear. */
  periodIndex: number
  rung: string
  /** Live clearing price — pair-wei per token, WAD. */
  price: string
  /** Pair currency, WAD (internally normalised — divide by pairScaleToWad for raw). */
  raised: string
  /** Launch token, 18dp. */
  soldTokens: string
  /** Pair currency, WAD. */
  committedTotal: string
  done: boolean
  graduated: boolean
  settled: boolean
  uniqueBidders: number
  /** WAD ratio; only computed at the bell, so 0 while live. */
  lpHealth: string
  /** liveBudget() — pair currency, WAD. */
  liveBudget: string
  /** currentMmax() — pair currency, WAD. */
  currentMmax: string
  /** raiseSplit() — RAW pair units, because these predict actual transfers. */
  raiseSplit: { toLP: string; toTreasury: string; toCreator: string }
  /** holdbackAmount() — launch token, 18dp. */
  holdbackAmount: string
  /** ms epoch of the read that produced this snapshot. */
  readAt: number
}

/**
 * Serializable hydrated auction — AuctionFiled stamps + chain immutables + a state snapshot.
 * Every bigint is a decimal string, exactly as IndexedListing does it.
 */
export type IndexedAuction = {
  v: 1
  auction: Address
  /** The launch token. The auction itself has no name/symbol — those live on token(). */
  token: Address
  creator: Address
  userSalt: Hex
  salt: Hex
  blockNumber: string
  logIndex: number
  txHash: Hex
  // token metadata
  name: string
  symbol: string
  decimals: number
  // immutables — read once at hydrate, never refetched
  /** address(0) = native ETH book. */
  pairToken: Address
  supply: string
  auctionSupply: string
  reserveTokens: string
  /** Pair currency, WAD. */
  floorMcap: string
  /** Pair-wei per token, WAD. */
  floorPrice: string
  /** Graduation gate on `raised` — pair currency, WAD. */
  threshold: string
  /** Seconds across all N periods. */
  duration: string
  rungStepWad: string
  /**
   * The $5 minimum ALREADY converted into this book's pair currency, WAD.
   * Validate a bid against this. NEVER against a hardcoded 5e18, which on a native
   * book means 5 ETH — that was a real shipped bug. See minBidRaw() for the value to
   * compare a raw `size` argument against.
   */
  minBidPair: string
  walletCapBps: number
  holdbackBps: number
  carveBps: number
  cashHoldbackBps: number
  sidePoolBps: number
  createSidePool: boolean
  liquidityLocked: boolean
  lpHealthTargetWad: string
  /** Constant 1000. Read anyway so a redeploy with a different N is visible. */
  n: number
  /**
   * Multiplier between RAW pair units and the WAD accounting: 1 for an 18dp/native
   * book, 1e12 for 6dp USDG. `placeBid(size)` takes RAW; `raised`/`committedTotal`/
   * `threshold`/`floorMcap`/`minBidPair` are WAD.
   */
  pairScaleToWad: string
  /** address(0) when never wired — settle() reverts SettlementUnset. */
  settlement: Address
  state: LadderAuctionState
  hydratedAt: number
  /** Set when hydrated by address outside the local index (pre-scan / deep link). */
  notYetIndexed?: boolean
  /**
   * Set when AuctionFiled was indexed but one or more getters failed.
   * Rendered as an error card — never silently dropped.
   */
  hydrateError?: string
}

/** One period of the ladder path. `period` is 1-indexed to match pathPrice(p). */
export type LadderPeriodPoint = {
  period: number
  /** Pair-wei per token, WAD. */
  price: string
  /** Launch token, 18dp. */
  offered: string
  sold: string
}

/**
 * Cached period path for one auction. Sparse — a period with no entry has never
 * cleared and renders as an untouched cell.
 */
export type LadderPeriodStore = {
  auction: Address
  /** Next block to scan (inclusive). Advances ONLY after decode+persist. */
  cursor: string
  fromBlock: string
  points: LadderPeriodPoint[]
  /**
   * 'events' — exact per-period reconstruction from PeriodCleared.
   * 'path'   — pathPrice/pathOffered/pathSold multicall, possibly strided.
   */
  source: 'events' | 'path'
  /** 1 = every period present. >1 = `points` is a stride sample of the true path. */
  stride: number
  updatedAt: number
}

export type LadderEnvelope = {
  v: 1
  chainId: number
  factory: Address
  cursor: string // next block to scan (inclusive)
  fromBlock: string
  auctions: IndexedAuction[]
  updatedAt: number
  /** periods:<auction> — keyed by lowercase auction address. */
  periods?: Record<string, LadderPeriodStore>
}

/**
 * Per-wallet position. The two halves disagree on units on purpose: `fillOf` is RAW
 * because it previews what claimRefund will actually pay, while the `wallets` struct
 * exposes the contract's internal WAD accounting.
 */
export type LadderWalletFill = {
  wallet: Address
  /** fillOf() — RAW pair units. */
  committed: string
  spent: string
  refund: string
  /** Launch token, 18dp. */
  tokens: string
  /** wallets() — pair currency, WAD. */
  committedWad: string
  spentWad: string
  refundClaimableWad: string
  /** The wallet's standing limit — pair-wei per token, WAD. */
  maxPrice: string
  exists: boolean
  refundClaimed: boolean
  tokensClaimed: boolean
  readAt: number
}

export function ladderCacheKey(chainId: number, factory: Address): string {
  return `${LADDER_CACHE_PREFIX}${chainId}:${factory.toLowerCase()}`
}

export function deriveLadderStatus(
  state: Pick<LadderAuctionState, 'startTime' | 'done' | 'graduated' | 'settled'>,
): LadderStatus {
  if (state.done) {
    if (!state.graduated) return 'failed'
    return state.settled ? 'graduated' : 'ended_pending_settle'
  }
  return state.startTime === '0' ? 'filed' : 'live'
}

/** True while the auction can still change — the polling loop's stop condition. */
export function isLadderActive(a: IndexedAuction): boolean {
  return !a.state.done
}

/** 18dp/native → 18, USDG → 6. Recovered from pairScaleToWad = 10 ** (18 - decimals). */
export function pairDecimals(pairScaleToWad: string): number {
  let scale = BigInt(pairScaleToWad)
  let decimals = 18
  while (scale > 1n && decimals > 0) {
    scale /= 10n
    decimals--
  }
  return decimals
}

/** RAW pair units → the WAD accounting the auction reports. Exact: it is a multiply. */
export function pairRawToWad(raw: bigint, pairScaleToWad: string): bigint {
  return raw * BigInt(pairScaleToWad)
}

/** WAD → RAW pair units. Floors, matching the contract's own out-edges. */
export function pairWadToRaw(wad: bigint, pairScaleToWad: string): bigint {
  return wad / BigInt(pairScaleToWad)
}

/**
 * The smallest `size` (RAW pair units) that clears MinBid on this book.
 * Rounds UP: placeBid checks `size * pairScaleToWad >= minBidPair`, so a floored
 * conversion lands one unit short and reverts.
 */
export function minBidRaw(a: IndexedAuction): bigint {
  const scale = BigInt(a.pairScaleToWad)
  const min = BigInt(a.minBidPair)
  return (min + scale - 1n) / scale
}
