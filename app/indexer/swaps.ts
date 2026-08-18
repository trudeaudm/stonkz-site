import type { Address, Hex, Log, PublicClient } from 'viem'
import { toEventSelector, zeroAddress } from 'viem'
import { directListingAbi } from '../abi/directListing'
import { expressFactoryAbi } from '../abi/expressFactory'
import { POOL_SWAP_TOPIC0, poolManagerSwapAbi } from '../abi/poolManager'
import { v4AdapterAbi } from '../abi/v4Adapter'
import { env } from '../config/env'
import { poolIdFromKey } from '../prices/spotMath'
import { loadEnvelope, saveEnvelope } from './storage'
import type {
  IndexEnvelope,
  IndexedListing,
  IndexedSwap,
  ListingSwapMeta,
  PoolSwapStore,
  ScanProgress,
  SwapPriceBucket,
} from './types'
import {
  RAW_SWAP_SOFT_CAP,
  RAW_SWAP_TRAIL,
} from './types'

const START_CHUNK = 10_000n
const MAX_CHUNK = 50_000n
const CONFIRM_BUFFER = 50n

function assertSwapTopic0(): void {
  const computed = toEventSelector(poolManagerSwapAbi[0])
  if (computed.toLowerCase() !== POOL_SWAP_TOPIC0.toLowerCase()) {
    throw new Error(
      `swap scanner refused: Swap topic0 mismatch — abi=${computed} anchor=${POOL_SWAP_TOPIC0}`,
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

async function resolveHead(client: PublicClient): Promise<bigint> {
  try {
    return await client.getBlockNumber({ blockTag: 'finalized' })
  } catch {
    const latest = await client.getBlockNumber()
    return latest > CONFIRM_BUFFER ? latest - CONFIRM_BUFFER : 0n
  }
}

type SwapArgs = {
  id: Hex
  sender: Address
  amount0: bigint
  amount1: bigint
  sqrtPriceX96: bigint
  liquidity: bigint
  tick: number
  fee: number
}

function parseSwapLog(log: Log): IndexedSwap | null {
  if (!log.args || typeof log.args !== 'object') return null
  const a = log.args as Partial<SwapArgs>
  if (
    a.sender == null ||
    a.amount0 == null ||
    a.amount1 == null ||
    a.sqrtPriceX96 == null ||
    a.liquidity == null ||
    a.tick == null ||
    a.fee == null
  ) {
    return null
  }
  if (log.blockNumber == null || log.transactionHash == null) return null
  return {
    blockNumber: log.blockNumber.toString(),
    logIndex: log.logIndex ?? 0,
    txHash: log.transactionHash,
    sender: a.sender,
    amount0: a.amount0.toString(),
    amount1: a.amount1.toString(),
    sqrtPriceX96: a.sqrtPriceX96.toString(),
    liquidity: a.liquidity.toString(),
    tick: Number(a.tick),
    fee: Number(a.fee),
  }
}

function tokenIsCurrency0(
  key: PoolSwapStore['key'],
  token: Address,
): boolean {
  return key.currency0.toLowerCase() === token.toLowerCase()
}

function accumulateVolumes(
  store: PoolSwapStore,
  ev: IndexedSwap,
  token: Address,
): void {
  const a0 = BigInt(ev.amount0)
  const a1 = BigInt(ev.amount1)
  const abs0 = a0 < 0n ? -a0 : a0
  const abs1 = a1 < 0n ? -a1 : a1
  const tok0 = tokenIsCurrency0(store.key, token)
  const volTok = BigInt(store.volumeTokenRaw) + (tok0 ? abs0 : abs1)
  const volPair = BigInt(store.volumePairRaw) + (tok0 ? abs1 : abs0)
  store.volumeTokenRaw = volTok.toString()
  store.volumePairRaw = volPair.toString()
}

function rebuildDerived(store: PoolSwapStore): void {
  // Prefer last event in raw trail; else last bucket.
  if (store.events.length > 0) {
    const last = store.events[store.events.length - 1]!
    store.lastSwapBlock = last.blockNumber
    store.lastSqrtPriceX96 = last.sqrtPriceX96
  } else if (store.buckets && store.buckets.length > 0) {
    const last = store.buckets[store.buckets.length - 1]!
    store.lastSwapBlock = last.block
    store.lastSqrtPriceX96 = last.sqrtPriceX96
  }
}

/**
 * Cap: keep all raw if under soft cap; else fold older into buckets and
 * keep trailing RAW_SWAP_TRAIL raw events.
 */
export function applySwapCap(store: PoolSwapStore): void {
  if (store.events.length < RAW_SWAP_SOFT_CAP) return
  const keep = store.events.slice(-RAW_SWAP_TRAIL)
  const drop = store.events.slice(0, store.events.length - RAW_SWAP_TRAIL)
  const buckets: SwapPriceBucket[] = [...(store.buckets ?? [])]
  for (const ev of drop) {
    buckets.push({
      block: ev.blockNumber,
      sqrtPriceX96: ev.sqrtPriceX96,
    })
  }
  // Collapse buckets to ~120 by block span if huge
  store.buckets = collapseBuckets(buckets, 120)
  store.events = keep
}

function collapseBuckets(
  buckets: SwapPriceBucket[],
  maxPoints: number,
): SwapPriceBucket[] {
  if (buckets.length <= maxPoints) return buckets
  const first = BigInt(buckets[0]!.block)
  const last = BigInt(buckets[buckets.length - 1]!.block)
  const span = last > first ? last - first : 1n
  const size = span / BigInt(maxPoints) + 1n
  const map = new Map<string, SwapPriceBucket>()
  for (const b of buckets) {
    const idx = (BigInt(b.block) - first) / size
    map.set(idx.toString(), b)
  }
  return [...map.entries()]
    .sort((a, b) => (BigInt(a[0]) > BigInt(b[0]) ? 1 : -1))
    .map(([, v]) => v)
}

function emptyStore(
  listing: IndexedListing,
  kind: 'main' | 'side',
  key: PoolSwapStore['key'],
): PoolSwapStore {
  const floor = listing.blockNumber === '0' ? '0' : listing.blockNumber
  return {
    poolId: poolIdFromKey(key),
    listing: listing.listing,
    kind,
    key,
    cursor: floor,
    fromBlock: floor,
    events: [],
    lastSwapBlock: '0',
    lastSqrtPriceX96: '0',
    swapCount: 0,
    volumeTokenRaw: '0',
    volumePairRaw: '0',
  }
}

function deriveActive(
  main: PoolSwapStore | undefined,
  side: PoolSwapStore | undefined,
): 'main' | 'side' {
  const m = main ? BigInt(main.lastSwapBlock) : 0n
  const s = side ? BigInt(side.lastSwapBlock) : 0n
  if (m === 0n && s === 0n) return 'main'
  return s > m ? 'side' : 'main'
}

export type SwapScanControls = {
  onProgress?: (p: ScanProgress) => void
  onErrorLine?: (text: string) => void
  signal?: AbortSignal
  /**
   * Dev/cursor-discipline test: throw after decoding the first non-empty
   * chunk BEFORE persist — cursor must remain unchanged.
   */
  injectDecodeThrowOnce?: boolean
}

function ensureStores(
  envelope: IndexEnvelope,
  listing: IndexedListing,
): { main: PoolSwapStore; side?: PoolSwapStore } {
  if (!envelope.swaps) envelope.swaps = {}
  const mainId = poolIdFromKey(listing.mainPoolKey)
  const mainKey = mainId.toLowerCase()
  let main = envelope.swaps[mainKey]
  if (!main) {
    main = emptyStore(listing, 'main', listing.mainPoolKey)
    envelope.swaps[mainKey] = main
  }
  let side: PoolSwapStore | undefined
  if (listing.sidePoolKey && listing.sidePoolDeployed) {
    const sideId = poolIdFromKey(listing.sidePoolKey)
    const sk = sideId.toLowerCase()
    side = envelope.swaps[sk]
    if (!side) {
      side = emptyStore(listing, 'side', listing.sidePoolKey)
      envelope.swaps[sk] = side
    }
  }
  return { main, side }
}

/** Backfill sidePoolKey on cached listings that predate the field. */
async function backfillSideKeys(
  client: PublicClient,
  listings: IndexedListing[],
): Promise<boolean> {
  let changed = false
  for (const L of listings) {
    if (L.hydrateError || !L.createSidePool || L.sidePoolKey) continue
    try {
      const sideKey = await client.readContract({
        address: L.listing,
        abi: directListingAbi,
        functionName: 'sideKey',
      })
      L.sidePoolKey = {
        currency0: sideKey.currency0,
        currency1: sideKey.currency1,
        fee: sideKey.fee,
        tickSpacing: sideKey.tickSpacing,
        hooks: sideKey.hooks,
      }
      changed = true
    } catch (err) {
      console.error(
        '[swaps] sideKey backfill failed',
        L.listing,
        err instanceof Error ? err.message : err,
      )
    }
  }
  return changed
}

function persistListingMeta(
  envelope: IndexEnvelope,
  listing: IndexedListing,
  main: PoolSwapStore,
  side?: PoolSwapStore,
): void {
  if (!envelope.listingSwapMeta) envelope.listingSwapMeta = {}
  const meta: ListingSwapMeta = {
    listing: listing.listing,
    mainPoolId: main.poolId,
    sidePoolId: side?.poolId,
    activePool: deriveActive(main, side),
  }
  envelope.listingSwapMeta[listing.listing.toLowerCase()] = meta
}

/**
 * Resolve the Uniswap v4 PoolManager that emits Swap logs.
 *
 * Prefer VITE_ADDR_POOL_MANAGER when baked. Otherwise:
 *   factory.poolManager() → V4Adapter, then adapter.manager() → PoolManager.
 * (factory.poolManager is the adapter, not the log address — verified live.)
 * Falls back to env.addrV4Adapter.manager() when factory hop fails.
 */
export async function resolvePoolManager(
  client: PublicClient,
  factory: Address,
): Promise<Address> {
  if (env.addrPoolManager) return env.addrPoolManager

  let adapter: Address | undefined
  try {
    const fromFactory = await client.readContract({
      address: factory,
      abi: expressFactoryAbi,
      functionName: 'poolManager',
    })
    if (fromFactory && fromFactory.toLowerCase() !== zeroAddress) {
      adapter = fromFactory
    }
  } catch {
    /* try env adapter */
  }
  if (!adapter) adapter = env.addrV4Adapter
  if (!adapter) {
    throw new Error(
      'cannot resolve PoolManager — set VITE_ADDR_POOL_MANAGER or VITE_ADDR_V4_ADAPTER / Express factory',
    )
  }

  const pm = await client.readContract({
    address: adapter,
    abi: v4AdapterAbi,
    functionName: 'manager',
  })
  if (!pm || pm.toLowerCase() === zeroAddress) {
    throw new Error(`adapter.manager() returned empty — adapter=${adapter}`)
  }
  return pm
}

/**
 * Scan PoolManager Swap logs for each listing's main (+ side) pool.
 * Cursor advances ONLY after a chunk is decoded AND persisted (e2848d4 lesson).
 */
export async function scanListingSwaps(
  client: PublicClient,
  factory: Address,
  controls?: SwapScanControls,
): Promise<{ envelope: IndexEnvelope; progress: ScanProgress }> {
  assertSwapTopic0()
  const pm = await resolvePoolManager(client, factory)

  let envelope = loadEnvelope(env.chainId, factory)
  if (!envelope) {
    throw new Error('swap scan refused: listings envelope missing — run listing scan first')
  }

  const head = await resolveHead(client)
  if (await backfillSideKeys(client, envelope.listings)) {
    envelope.updatedAt = Date.now()
    saveEnvelope(envelope)
  }
  const listings = envelope.listings.filter((L) => !L.hydrateError)
  let injectThrow = Boolean(controls?.injectDecodeThrowOnce)

  const emit = (
    partial: Partial<ScanProgress> & Pick<ScanProgress, 'status' | 'message'>,
  ) => {
    controls?.onProgress?.({
      fromBlock: 0n,
      cursor: 0n,
      head,
      percent: 0,
      chunkSize: Number(START_CHUNK),
      ...partial,
    })
  }

  emit({ status: 'scanning', message: `swap scan · ${listings.length} listing(s)` })

  for (const listing of listings) {
    if (controls?.signal?.aborted) throw new Error('swap scan aborted')
    const { main, side } = ensureStores(envelope, listing)
    const stores = side ? [main, side] : [main]

    for (const store of stores) {
      let cursor = BigInt(store.cursor)
      const floor = BigInt(store.fromBlock)
      if (cursor < floor) cursor = floor
      let chunk = START_CHUNK
      let cleanStreak = 0

      while (cursor <= head) {
        if (controls?.signal?.aborted) throw new Error('swap scan aborted')
        const to = cursor + chunk - 1n > head ? head : cursor + chunk - 1n
        try {
          const logs = await client.getLogs({
            address: pm,
            event: poolManagerSwapAbi[0],
            args: { id: store.poolId },
            fromBlock: cursor,
            toBlock: to,
          })

          const decoded: IndexedSwap[] = []
          for (const log of logs) {
            const parsed = parseSwapLog(log as Log & { args?: SwapArgs })
            if (!parsed) {
              throw new Error(
                `swap decode failed pool=${store.poolId} block=${log.blockNumber?.toString() ?? '?'}`,
              )
            }
            decoded.push(parsed)
          }

          if (injectThrow && decoded.length > 0) {
            injectThrow = false
            throw new Error(
              'injectDecodeThrowOnce: forced decode throw (cursor must not advance)',
            )
          }

          // Persist BEFORE advancing cursor (e2848d4 discipline).
          for (const ev of decoded) {
            store.events.push(ev)
            store.swapCount += 1
            accumulateVolumes(store, ev, listing.token)
          }
          if (decoded.length > 0) {
            applySwapCap(store)
            rebuildDerived(store)
          }

          const nextCursor = to + 1n
          store.cursor = nextCursor.toString()
          persistListingMeta(envelope, listing, main, side)
          envelope.updatedAt = Date.now()
          saveEnvelope(envelope)

          cursor = nextCursor
          cleanStreak++
          if (cleanStreak >= 3) {
            const grown = (chunk * 3n) / 2n
            chunk = grown > MAX_CHUNK ? MAX_CHUNK : grown
            cleanStreak = 0
          }
          emit({
            status: 'scanning',
            message: `swaps · $${listing.symbol} ${store.kind} · block ${to} / ${head}`,
            cursor: to,
            chunkSize: Number(chunk),
          })
        } catch (err) {
          if (isRangeError(err) && chunk > 1n) {
            chunk = chunk / 2n > 0n ? chunk / 2n : 1n
            cleanStreak = 0
            emit({
              status: 'scanning',
              message: `swaps range error — halving chunk to ${chunk}`,
            })
            continue
          }
          const msg = err instanceof Error ? err.message : String(err)
          console.error(
            `[swaps] chunk failed listing=${listing.listing} pool=${store.poolId} cursor=${cursor}…${to}:`,
            msg,
          )
          controls?.onErrorLine?.(
            `swaps ERROR · $${listing.symbol} ${store.kind} @ ${cursor} — ${msg}`,
          )
          emit({ status: 'error', message: msg })
          // Cursor NOT advanced — only the success path writes a new cursor.
          throw err
        }
      }
    }
    persistListingMeta(envelope, listing, main, side)
  }

  envelope.updatedAt = Date.now()
  saveEnvelope(envelope)

  const progress: ScanProgress = {
    fromBlock: 0n,
    cursor: head,
    head,
    percent: 100,
    chunkSize: Number(START_CHUNK),
    status: 'done',
    message: `swaps idle · head ${head.toString()}`,
  }
  controls?.onProgress?.(progress)
  return { envelope, progress }
}

/** Build a ~<=120-point USD price series for a pool (carry-forward gaps). */
export function priceSeriesForPool(
  store: PoolSwapStore,
  head: bigint,
  usdFromSqrt: (sqrt: bigint) => number,
  maxPoints = 120,
): number[] {
  const from = BigInt(store.fromBlock)
  const span = head > from ? head - from : 1n
  const bucketSize = span / BigInt(maxPoints) + 1n

  type Pt = { idx: bigint; usd: number }
  const lastInBucket = new Map<string, Pt>()

  const ingest = (block: bigint, sqrt: bigint) => {
    const usd = usdFromSqrt(sqrt)
    if (!Number.isFinite(usd) || usd <= 0) return
    const idx = (block - from) / bucketSize
    lastInBucket.set(idx.toString(), { idx, usd })
  }

  for (const b of store.buckets ?? []) {
    ingest(BigInt(b.block), BigInt(b.sqrtPriceX96))
  }
  for (const ev of store.events) {
    ingest(BigInt(ev.blockNumber), BigInt(ev.sqrtPriceX96))
  }

  if (lastInBucket.size === 0) return []

  const maxIdx = (head - from) / bucketSize
  const out: number[] = []
  let carry = 0
  for (let i = 0n; i <= maxIdx; i++) {
    const hit = lastInBucket.get(i.toString())
    if (hit) carry = hit.usd
    if (carry > 0) out.push(carry)
  }
  // Trim leading empties already skipped; ensure <= maxPoints
  if (out.length > maxPoints) return out.slice(out.length - maxPoints)
  return out
}

/** One USD point per indexed swap (no carry-forward) — sparse charts. */
export function tradePricePoints(
  store: PoolSwapStore,
  usdFromSqrt: (sqrt: bigint) => number,
): number[] {
  const out: number[] = []
  for (const b of store.buckets ?? []) {
    const usd = usdFromSqrt(BigInt(b.sqrtPriceX96))
    if (usd > 0) out.push(usd)
  }
  for (const ev of store.events) {
    const usd = usdFromSqrt(BigInt(ev.sqrtPriceX96))
    if (usd > 0) out.push(usd)
  }
  return out
}

export function activeStoreForListing(
  envelope: IndexEnvelope,
  listing: Address,
): PoolSwapStore | null {
  const meta = envelope.listingSwapMeta?.[listing.toLowerCase()]
  if (!meta) return null
  const id =
    meta.activePool === 'side' && meta.sidePoolId
      ? meta.sidePoolId
      : meta.mainPoolId
  return envelope.swaps?.[id.toLowerCase()] ?? null
}

/**
 * Gross pair-side raw volume for a store. Prefer persisted volumePairRaw;
 * if zero despite events (stale envelope), re-sum from events.
 */
export function effectiveVolumePairRaw(
  store: PoolSwapStore,
  token: Address,
): string {
  if (BigInt(store.volumePairRaw) > 0n) return store.volumePairRaw
  if (store.events.length === 0) return store.volumePairRaw
  let vol = 0n
  const tok0 = store.key.currency0.toLowerCase() === token.toLowerCase()
  for (const ev of store.events) {
    const a0 = BigInt(ev.amount0)
    const a1 = BigInt(ev.amount1)
    const abs0 = a0 < 0n ? -a0 : a0
    const abs1 = a1 < 0n ? -a1 : a1
    vol += tok0 ? abs1 : abs0
  }
  return vol.toString()
}
