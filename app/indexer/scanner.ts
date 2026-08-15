import type { Address, Hex, Log, PublicClient } from 'viem'
import { toEventSelector } from 'viem'
import { expressListedEvent } from '../abi/expressFactory'
import { env } from '../config/env'
import { hydrateListings } from './hydrate'
import { gcStaleIndexKeys, loadEnvelope, saveEnvelope } from './storage'
import type { IndexEnvelope, IndexedListing, ScanProgress } from './types'

const START_CHUNK = 10_000n
const MAX_CHUNK = 50_000n
const CONFIRM_BUFFER = 50n

/**
 * On-chain ExpressListed topics[0] from V3 factory log @ block 37312001
 * (tx 0xdd08…6c96). Assembled — address-grep safe. Scanner refuses if ABI drifts.
 */
const EXPRESS_LISTED_TOPIC0_ANCHOR = (
  `0x` +
  `5b9ab641ea31574c` +
  `af64ffdb8a296ce1` +
  `56508238a1b9bb7d` +
  `c0ab2de836f6fcba`
) as Hex

function assertExpressListedTopic0(): void {
  const computed = toEventSelector(expressListedEvent)
  if (computed.toLowerCase() !== EXPRESS_LISTED_TOPIC0_ANCHOR.toLowerCase()) {
    throw new Error(
      `scanner refused: ExpressListed topic0 mismatch — abi=${computed} anchor=${EXPRESS_LISTED_TOPIC0_ANCHOR}`,
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

type ExpressArgs = {
  listing: Address
  token: Address
  creator: Address
  userSalt: Hex
  salt: Hex
}

function parseExpressLog(log: Log): ExpressArgs & {
  blockNumber: bigint
  logIndex: number
  txHash: Hex
} | null {
  // getLogs with event already decodes when using viem — but raw walk uses topics
  if (!log.args || typeof log.args !== 'object') return null
  const a = log.args as Partial<ExpressArgs>
  if (!a.listing || !a.token || !a.creator || !a.userSalt || !a.salt) return null
  if (log.blockNumber == null || log.transactionHash == null) return null
  return {
    listing: a.listing,
    token: a.token,
    creator: a.creator,
    userSalt: a.userSalt,
    salt: a.salt,
    blockNumber: log.blockNumber,
    logIndex: log.logIndex ?? 0,
    txHash: log.transactionHash,
  }
}

export type ScannerControls = {
  onProgress?: (p: ScanProgress) => void
  signal?: AbortSignal
}

/**
 * Chunked ExpressListed walker with adaptive window size.
 * Zero listings is a valid closed-gate outcome.
 */
export async function scanExpressListings(
  client: PublicClient,
  factory: Address,
  controls?: ScannerControls,
): Promise<{ envelope: IndexEnvelope; progress: ScanProgress }> {
  assertExpressListedTopic0()
  const chainId = env.chainId
  gcStaleIndexKeys(chainId, factory)

  const floor = BigInt(env.indexFromBlock)
  let existing = loadEnvelope(chainId, factory)
  if (!existing) {
    existing = {
      v: 2,
      chainId,
      factory,
      cursor: floor.toString(),
      fromBlock: floor.toString(),
      listings: [],
      updatedAt: Date.now(),
    }
  }

  const byListing = new Map<string, IndexedListing>()
  for (const L of existing.listings) byListing.set(L.listing.toLowerCase(), L)

  let cursor = BigInt(existing.cursor)
  if (cursor < floor) cursor = floor
  const fromBlock = BigInt(existing.fromBlock)

  let chunk = START_CHUNK
  let cleanStreak = 0
  const head = await resolveHead(client)

  const emit = (partial: Partial<ScanProgress> & Pick<ScanProgress, 'status' | 'message'>) => {
    const span = head > fromBlock ? head - fromBlock : 1n
    const done = cursor > fromBlock ? cursor - fromBlock : 0n
    const percent = Number((done * 10000n) / span) / 100
    controls?.onProgress?.({
      fromBlock,
      cursor,
      head,
      percent: Math.min(100, percent),
      chunkSize: Number(chunk),
      ...partial,
    })
  }

  emit({ status: 'scanning', message: `scanning from ${cursor}` })

  const freshLogs: NonNullable<ReturnType<typeof parseExpressLog>>[] = []

  while (cursor <= head) {
    if (controls?.signal?.aborted) throw new Error('scan aborted')
    const to = cursor + chunk - 1n > head ? head : cursor + chunk - 1n
    try {
      const logs = await client.getLogs({
        address: factory,
        event: expressListedEvent,
        fromBlock: cursor,
        toBlock: to,
      })
      for (const log of logs) {
        const parsed = parseExpressLog(log as Log & { args?: ExpressArgs })
        if (parsed) freshLogs.push(parsed)
      }
      cursor = to + 1n
      cleanStreak++
      if (cleanStreak >= 3) {
        const grown = (chunk * 3n) / 2n
        chunk = grown > MAX_CHUNK ? MAX_CHUNK : grown
        cleanStreak = 0
      }
      emit({
        status: 'scanning',
        message: `scanning block ${to} of ${head} (chunk ${chunk})`,
      })
      existing.cursor = cursor.toString()
      existing.updatedAt = Date.now()
      saveEnvelope(existing)
    } catch (err) {
      if (isRangeError(err) && chunk > 1n) {
        chunk = chunk / 2n > 0n ? chunk / 2n : 1n
        cleanStreak = 0
        emit({
          status: 'scanning',
          message: `range error — halving chunk to ${chunk}, retry ${cursor}…${to}`,
        })
        continue
      }
      emit({
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  if (freshLogs.length > 0) {
    emit({
      status: 'scanning',
      message: `hydrating ${freshLogs.length} new listing(s)`,
    })
    const hydrated = await hydrateListings(client, freshLogs)
    for (const L of hydrated) byListing.set(L.listing.toLowerCase(), L)
  }

  const listings = [...byListing.values()].sort((a, b) => {
    const bn = BigInt(b.blockNumber) - BigInt(a.blockNumber)
    if (bn !== 0n) return bn > 0n ? 1 : -1
    return b.logIndex - a.logIndex
  })

  const envelope: IndexEnvelope = {
    v: 2,
    chainId,
    factory,
    cursor: cursor.toString(),
    fromBlock: fromBlock.toString(),
    listings,
    updatedAt: Date.now(),
  }
  saveEnvelope(envelope)

  const progress: ScanProgress = {
    fromBlock,
    cursor,
    head,
    percent: 100,
    chunkSize: Number(chunk),
    status: 'done',
    message:
      listings.length === 0
        ? 'no launches yet. the gate is closed — soft launch.'
        : `indexed ${listings.length} listing(s)`,
  }
  controls?.onProgress?.(progress)
  return { envelope, progress }
}
