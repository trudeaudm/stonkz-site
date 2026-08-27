/**
 * Period path → LadderGrid cells.
 *
 * N is 1000 and pathPrice/pathOffered/pathSold are one call each, so a naive full
 * read is 3000 eth_calls per auction per open. Two cheaper routes, in order of
 * preference:
 *
 *  1. EVENTS. `PeriodCleared(period, price, offered, sold, rung)` fires once per
 *     cleared period and `PeriodsIdleSkipped(from, to, price)` covers the O(1) jumps,
 *     so the whole history costs one getLogs per block chunk and is incrementally
 *     cacheable behind a cursor. This is the default. Caveat, and it is the reason
 *     the fallback still exists: an idle-skipped period's `offered` is derived from
 *     the shared weights store and is NOT in the log, so those cells report
 *     offered = 0 and render as untouched rather than as unsold supply.
 *
 *  2. PATH READS. pathX(p) is defined to return 0 for p > periodIndex, so a live
 *     book only needs `periodIndex` periods, not 1000 — at period 120 that is 360
 *     calls, batched into one multicall. Only a finished book pays for all 1000, and
 *     past MAX_PATH_CELLS we sample every `stride`-th period instead. A sampled cell
 *     shows that one period's values as the representative of its window; it is not
 *     an aggregate, because aggregating would require the reads we are avoiding.
 *
 * Periods are 1-indexed throughout, matching the contract: pathPrice(0) is 0 by
 * definition and the first cleared period is 1.
 */

import type { Abi, Address, Log, PublicClient } from 'viem'
import { getAbiItem, toEventSelector } from 'viem'
import {
  LADDER_PERIOD_CLEARED_TOPIC0,
  ladderAuctionAbi,
} from '../abi/ladderAuction'
import type { LadderPeriodCell } from '../components/LadderGrid'
import {
  LADDER_N,
  type IndexedAuction,
  type LadderPeriodPoint,
  type LadderPeriodStore,
} from '../indexer/ladderTypes'

const START_CHUNK = 10_000n
const MAX_CHUNK = 50_000n

/** Above this, the path fallback samples instead of reading every period. */
export const MAX_PATH_CELLS = 256

const periodClearedEvent = getAbiItem({
  abi: ladderAuctionAbi,
  name: 'PeriodCleared',
})
const periodsIdleSkippedEvent = getAbiItem({
  abi: ladderAuctionAbi,
  name: 'PeriodsIdleSkipped',
})

function assertPeriodClearedTopic0(): void {
  const computed = toEventSelector(periodClearedEvent)
  if (computed.toLowerCase() !== LADDER_PERIOD_CLEARED_TOPIC0.toLowerCase()) {
    throw new Error(
      `ladder period scan refused: PeriodCleared topic0 mismatch — abi=${computed} anchor=${LADDER_PERIOD_CLEARED_TOPIC0}`,
    )
  }
}

function isRangeError(err: unknown): boolean {
  const s = String(
    err && typeof err === 'object' && 'shortMessage' in err
      ? (err as { shortMessage?: string }).shortMessage
      : err instanceof Error
        ? err.message
        : err,
  ).toLowerCase()
  return (
    s.includes('block range') ||
    s.includes('query returned more than') ||
    s.includes('response size') ||
    s.includes('exceed') ||
    s.includes('limit') ||
    s.includes('too many') ||
    s.includes('timeout')
  )
}

type ClearedArgs = {
  period: number
  price: bigint
  offered: bigint
  sold: bigint
  rung: bigint
}

type IdleArgs = {
  fromPeriod: number
  toPeriod: number
  price: bigint
}

type ClearedLog = Log & { args?: Partial<ClearedArgs> }
type IdleLog = Log & { args?: Partial<IdleArgs> }

function applyCleared(byPeriod: Map<number, LadderPeriodPoint>, log: ClearedLog) {
  const a = log.args
  if (!a || a.period == null || a.price == null) return
  if (a.offered == null || a.sold == null) return
  byPeriod.set(Number(a.period), {
    period: Number(a.period),
    price: a.price.toString(),
    offered: a.offered.toString(),
    sold: a.sold.toString(),
  })
}

/**
 * An idle skip advances periodIndex without clearing, so nothing sold across the
 * whole window. `offered` is unknown from the log alone — see the header.
 */
function applyIdle(byPeriod: Map<number, LadderPeriodPoint>, log: IdleLog) {
  const a = log.args
  if (!a || a.fromPeriod == null || a.toPeriod == null || a.price == null) return
  const from = Number(a.fromPeriod)
  const to = Number(a.toPeriod)
  for (let p = from + 1; p <= to && p <= LADDER_N; p++) {
    if (byPeriod.has(p)) continue
    byPeriod.set(p, {
      period: p,
      price: a.price.toString(),
      offered: '0',
      sold: '0',
    })
  }
}

export type PeriodScanControls = {
  signal?: AbortSignal
  /** Head to scan to. Defaults to the current block number. */
  head?: bigint
}

/**
 * Walk PeriodCleared + PeriodsIdleSkipped for one auction, resuming from `prior`.
 * Returns a store whose cursor can be persisted with savePeriodStore.
 */
export async function scanPeriodEvents(
  client: PublicClient,
  auction: Address,
  fromBlock: bigint,
  prior: LadderPeriodStore | null,
  controls?: PeriodScanControls,
): Promise<LadderPeriodStore> {
  assertPeriodClearedTopic0()

  const byPeriod = new Map<number, LadderPeriodPoint>()
  // A strided path store cannot be resumed — it has holes an event walk would not fill.
  const resumable =
    prior && prior.source === 'events' && prior.stride === 1 ? prior : null
  if (resumable) for (const p of resumable.points) byPeriod.set(p.period, p)

  const floor = resumable ? BigInt(resumable.cursor) : fromBlock
  let cursor = floor < fromBlock ? fromBlock : floor
  const head = controls?.head ?? (await client.getBlockNumber())
  let chunk = START_CHUNK
  let cleanStreak = 0

  while (cursor <= head) {
    if (controls?.signal?.aborted) throw new Error('period scan aborted')
    const to = cursor + chunk - 1n > head ? head : cursor + chunk - 1n
    try {
      const [cleared, idle] = await Promise.all([
        client.getLogs({
          address: auction,
          event: periodClearedEvent,
          fromBlock: cursor,
          toBlock: to,
        }),
        client.getLogs({
          address: auction,
          event: periodsIdleSkippedEvent,
          fromBlock: cursor,
          toBlock: to,
        }),
      ])
      // Idle first: a real clear for the same period must win.
      for (const log of idle) applyIdle(byPeriod, log as IdleLog)
      for (const log of cleared) applyCleared(byPeriod, log as ClearedLog)
      cursor = to + 1n
      cleanStreak++
      if (cleanStreak >= 3) {
        const grown = (chunk * 3n) / 2n
        chunk = grown > MAX_CHUNK ? MAX_CHUNK : grown
        cleanStreak = 0
      }
    } catch (err) {
      if (isRangeError(err) && chunk > 1n) {
        chunk = chunk / 2n > 0n ? chunk / 2n : 1n
        cleanStreak = 0
        continue
      }
      throw err
    }
  }

  return {
    auction,
    cursor: cursor.toString(),
    fromBlock: (resumable ? BigInt(resumable.fromBlock) : fromBlock).toString(),
    points: [...byPeriod.values()].sort((a, b) => a.period - b.period),
    source: 'events',
    stride: 1,
    updatedAt: Date.now(),
  }
}

/** Every `stride`-th period in [1, last], always including `last`. */
function sampledPeriods(last: number, maxCells: number): number[] {
  if (last <= 0) return []
  const stride = Math.max(1, Math.ceil(last / maxCells))
  const out: number[] = []
  for (let p = 1; p <= last; p += stride) out.push(p)
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

/**
 * Fallback path read. Only periods up to `periodIndex` exist; beyond that the
 * contract returns 0, so reading them is pure waste.
 */
export async function readPeriodPath(
  client: PublicClient,
  auction: Address,
  periodIndex: number,
  maxCells = MAX_PATH_CELLS,
): Promise<LadderPeriodStore> {
  const last = Math.min(periodIndex, LADDER_N)
  const periods = sampledPeriods(last, maxCells)
  const stride = periods.length > 1 ? periods[1]! - periods[0]! : 1

  const contracts = periods.flatMap((p) => [
    {
      address: auction,
      abi: ladderAuctionAbi as Abi,
      functionName: 'pathPrice',
      args: [p] as readonly unknown[],
    },
    {
      address: auction,
      abi: ladderAuctionAbi as Abi,
      functionName: 'pathOffered',
      args: [p] as readonly unknown[],
    },
    {
      address: auction,
      abi: ladderAuctionAbi as Abi,
      functionName: 'pathSold',
      args: [p] as readonly unknown[],
    },
  ])

  const results =
    contracts.length === 0
      ? []
      : ((await client.multicall({ contracts, allowFailure: true })) as {
          status: 'success' | 'failure'
          result?: unknown
        }[])

  const points: LadderPeriodPoint[] = []
  for (let i = 0; i < periods.length; i++) {
    const base = i * 3
    const price = results[base]
    const offered = results[base + 1]
    const sold = results[base + 2]
    if (!price || price.status !== 'success') continue
    points.push({
      period: periods[i]!,
      price: (price.result as bigint).toString(),
      offered:
        offered?.status === 'success'
          ? (offered.result as bigint).toString()
          : '0',
      sold: sold?.status === 'success' ? (sold.result as bigint).toString() : '0',
    })
  }

  return {
    auction,
    // No cursor semantics for a path read — a later events scan starts from scratch.
    cursor: '0',
    fromBlock: '0',
    points,
    source: 'path',
    stride,
    updatedAt: Date.now(),
  }
}

/**
 * Events first, path reads if the log walk fails (pruned RPC, provider limits).
 * `auction` supplies both the filing block (scan floor) and periodIndex.
 */
export async function loadPeriodPath(
  client: PublicClient,
  auction: IndexedAuction,
  prior: LadderPeriodStore | null,
  controls?: PeriodScanControls,
): Promise<LadderPeriodStore> {
  try {
    return await scanPeriodEvents(
      client,
      auction.auction,
      BigInt(auction.blockNumber),
      prior,
      controls,
    )
  } catch (err) {
    if (controls?.signal?.aborted) throw err
    console.error(
      '[ladder] period event scan failed — falling back to path reads:',
      err instanceof Error ? err.message : err,
    )
    return readPeriodPath(client, auction.auction, auction.state.periodIndex)
  }
}

/**
 * Store → LadderGrid props. Sparse stores are padded to `total` cells so the grid
 * keeps its 50×20 shape and uncleared periods render as future. A strided store is
 * NOT padded: its cells already stand for windows, and inflating them back to 1000
 * would invent per-period detail that was never read.
 */
export function toLadderPeriodCells(
  store: LadderPeriodStore | null,
  total = LADDER_N,
): LadderPeriodCell[] {
  const cells: LadderPeriodCell[] = []
  if (!store) return cells

  if (store.stride > 1) {
    return store.points.map((p) => ({
      period: p.period,
      price: BigInt(p.price),
      offered: BigInt(p.offered),
      sold: BigInt(p.sold),
    }))
  }

  const byPeriod = new Map(store.points.map((p) => [p.period, p]))
  for (let period = 1; period <= total; period++) {
    const p = byPeriod.get(period)
    cells.push({
      period,
      price: p ? BigInt(p.price) : 0n,
      offered: p ? BigInt(p.offered) : 0n,
      sold: p ? BigInt(p.sold) : 0n,
    })
  }
  return cells
}
