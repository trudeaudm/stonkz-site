/**
 * Ladder display + unit helpers.
 *
 * Two pair-currency unit families sit next to each other on IndexedAuction and
 * must never be mixed:
 *  - WAD — `raised`, `threshold`, `committedTotal`, `floorMcap`, `minBidPair`,
 *    `price`, `floorPrice`. The auction's internal accounting.
 *  - RAW — `placeBid(size)`, `fillOf`, `raiseSplit`. What actually moves on
 *    chain: wei on a native book, 6dp on a USDG book.
 *
 * Everything here takes the auction so the raw side can be scaled correctly.
 * Nothing here hardcodes a $5 minimum: the min bid is `minBidRaw(auction)`.
 */
import { formatEther, formatUnits, zeroAddress } from 'viem'
import {
  minBidRaw,
  pairDecimals,
  pairRawToWad,
  type IndexedAuction,
  type LadderStatus,
} from '../indexer/ladderTypes'

/** Bidder ceiling for "no limit" — any live price clears it. */
export const NO_LIMIT_MAX_PRICE = (1n << 256n) - 1n

export const LADDER_STATUS_LABEL: Record<LadderStatus, string> = {
  filed: 'FILED',
  live: 'LIVE',
  ended_pending_settle: 'BELL RANG',
  graduated: 'GRADUATED',
  failed: 'FAILED',
}

export const LADDER_STATUS_LONG: Record<LadderStatus, string> = {
  filed: 'filed · clock has not started',
  live: 'live · book is open',
  ended_pending_settle: 'bell rang · waiting on settle',
  graduated: 'graduated · lp is live',
  failed: 'failed at the bell · refunds open',
}

type StampVariant = 'stonkz' | 'not' | 'gen' | 'insta' | 'gone'

export const LADDER_STATUS_STAMP: Record<LadderStatus, StampVariant> = {
  filed: 'gen',
  live: 'stonkz',
  ended_pending_settle: 'insta',
  graduated: 'stonkz',
  failed: 'not',
}

export const LADDER_STATUS_TONE: Record<
  LadderStatus,
  'green' | 'amber' | 'red' | 'navy'
> = {
  filed: 'navy',
  live: 'green',
  ended_pending_settle: 'amber',
  graduated: 'green',
  failed: 'red',
}

export function isNativeBook(a: IndexedAuction): boolean {
  return a.pairToken === zeroAddress
}

/** Label for the pair currency. `symbol` comes from a live read when ERC20. */
export function pairLabel(a: IndexedAuction, symbol?: string | null): string {
  if (isNativeBook(a)) return 'ETH'
  return symbol && symbol.length > 0 ? symbol : 'pair'
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

function compact(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0'
  const abs = Math.abs(n)
  if (abs >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (abs >= 1) return trimZeros(n.toPrecision(5))
  if (abs >= 0.0001) return trimZeros(n.toFixed(7))
  return n.toExponential(3)
}

/** WAD pair amount → human. Same scale on every book by construction. */
export function formatPairWad(wad: bigint | string): string {
  const v = typeof wad === 'string' ? BigInt(wad) : wad
  return compact(Number(formatEther(v)))
}

/** RAW pair amount → human. Exact: RAW→WAD is a multiply. */
export function formatPairRaw(raw: bigint | string, a: IndexedAuction): string {
  const v = typeof raw === 'string' ? BigInt(raw) : raw
  return formatPairWad(pairRawToWad(v, a.pairScaleToWad))
}

/** Pair-wei per token, WAD → human. Launch prices are usually 1e-5 territory. */
export function formatPriceWad(wad: bigint | string): string {
  const v = typeof wad === 'string' ? BigInt(wad) : wad
  if (v === 0n) return '0'
  const n = Number(formatEther(v))
  if (!Number.isFinite(n)) return '—'
  return n >= 0.001 ? trimZeros(n.toPrecision(5)) : n.toExponential(3)
}

/** A WAD ratio (lpHealth, lpHealthTargetWad) as a percentage. Can exceed 100%. */
export function formatRatioWad(wad: bigint | string): string {
  const v = typeof wad === 'string' ? BigInt(wad) : wad
  return `${(Number(formatEther(v)) * 100).toFixed(1)}%`
}

/** Launch token, 18dp. */
export function formatTokens(raw: bigint | string): string {
  const v = typeof raw === 'string' ? BigInt(raw) : raw
  return compact(Number(formatEther(v)))
}

/** The min bid in this book's own currency, never a 5e18 assumption. */
export function formatMinBid(a: IndexedAuction): string {
  return formatUnits(minBidRaw(a), pairDecimals(a.pairScaleToWad))
}

export function formatBps(bps: number): string {
  return `${trimZeros((bps / 100).toFixed(2))}%`
}

/** 0..1, clamped, and 0 when the denominator is unreadable. */
export function ratioOf(numer: bigint | string, denom: bigint | string): number {
  const n = typeof numer === 'string' ? BigInt(numer) : numer
  const d = typeof denom === 'string' ? BigInt(denom) : denom
  if (d <= 0n) return 0
  const bps = Number((n * 10_000n) / d)
  return Math.max(0, Math.min(1, bps / 10_000))
}

export function formatPct(frac: number): string {
  return `${(frac * 100).toFixed(1)}%`
}

/** Unix seconds of the bell, or null while the clock has never run. */
export function auctionEndsAt(a: IndexedAuction): number | null {
  const start = BigInt(a.state.startTime)
  if (start === 0n) return null
  return Number(start + BigInt(a.duration))
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0s'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (d > 0) return `${d}d ${String(h).padStart(2, '0')}h`
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

/** Copy for the clock, in the auction's own terms. */
export function formatClock(a: IndexedAuction, nowSec: number): string {
  if (a.state.done) return 'bell rang'
  const end = auctionEndsAt(a)
  if (end == null) return 'clock not started'
  const left = end - nowSec
  return left <= 0 ? 'time is up — needs a poke' : `${formatDuration(left)} left`
}

/** Per-wallet token ceiling — bps of TOTAL supply. 0 bps means uncapped. */
export function walletCapTokens(a: IndexedAuction): bigint {
  if (a.walletCapBps <= 0) return 0n
  return (BigInt(a.supply) * BigInt(a.walletCapBps)) / 10_000n
}

/**
 * The raise gate as a share of the floor mcap the book was filed at. Derived,
 * not asserted: it is whatever the contract's own threshold/floorMcap say.
 */
export function thresholdShareOfFloor(a: IndexedAuction): number | null {
  if (BigInt(a.floorMcap) <= 0n) return null
  return ratioOf(a.threshold, a.floorMcap)
}

export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}
