import type { Address, Hex, Log, PublicClient } from 'viem'
import { getAbiItem, toEventSelector } from 'viem'
import {
  LADDER_AUCTION_FILED_TOPIC0,
  ladderFactoryAbi,
} from '../abi/ladderFactory'
import { env } from '../config/env'
import { hydrateAuctions } from './ladderHydrate'
import { gcStaleLadderKeys, loadLadderEnvelope, saveLadderEnvelope } from './ladderStorage'
import type { IndexedAuction, LadderEnvelope } from './ladderTypes'
import type { ScanProgress } from './types'

const START_CHUNK = 10_000n
const MAX_CHUNK = 50_000n
const CONFIRM_BUFFER = 50n

const auctionFiledEvent = getAbiItem({
  abi: ladderFactoryAbi,
  name: 'AuctionFiled',
})

function assertAuctionFiledTopic0(): void {
  const computed = toEventSelector(auctionFiledEvent)
  if (computed.toLowerCase() !== LADDER_AUCTION_FILED_TOPIC0.toLowerCase()) {
    throw new Error(
      `ladder scanner refused: AuctionFiled topic0 mismatch — abi=${computed} anchor=${LADDER_AUCTION_FILED_TOPIC0}`,
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

/** getBlock, not getBlockNumber: only the former takes a blockTag. */
async function resolveHead(client: PublicClient): Promise<bigint> {
  try {
    const block = await client.getBlock({ blockTag: 'finalized' })
    if (block.number != null) return block.number
  } catch {
    /* chain has no finalized tag — fall through to the confirmation buffer */
  }
  const latest = await client.getBlockNumber()
  return latest > CONFIRM_BUFFER ? latest - CONFIRM_BUFFER : 0n
}

type AuctionFiledArgs = {
  auction: Address
  creator: Address
  holdbackBps: number
  carveBps: number
  userSalt: Hex
  salt: Hex
}

type AuctionFiledLog = Log & { args?: Partial<AuctionFiledArgs> }

function parseAuctionFiledLog(log: AuctionFiledLog): AuctionFiledArgs & {
  blockNumber: bigint
  logIndex: number
  txHash: Hex
} | null {
  if (!log.args || typeof log.args !== 'object') return null
  const a = log.args
  // bps fields are legitimately 0, so check presence rather than truthiness.
  if (!a.auction || !a.creator || !a.userSalt || !a.salt) return null
  if (a.holdbackBps == null || a.carveBps == null) return null
  if (log.blockNumber == null || log.transactionHash == null) return null
  return {
    auction: a.auction,
    creator: a.creator,
    holdbackBps: Number(a.holdbackBps),
    carveBps: Number(a.carveBps),
    userSalt: a.userSalt,
    salt: a.salt,
    blockNumber: log.blockNumber,
    logIndex: log.logIndex ?? 0,
    txHash: log.transactionHash,
  }
}

export type LadderScannerControls = {
  onProgress?: (p: ScanProgress) => void
  signal?: AbortSignal
}

/**
 * Chunked AuctionFiled walker with adaptive window size.
 * Zero auctions is a valid closed-gate outcome — filing is allowlisted.
 */
export async function scanLadderAuctions(
  client: PublicClient,
  factory: Address,
  controls?: LadderScannerControls,
): Promise<{ envelope: LadderEnvelope; progress: ScanProgress }> {
  assertAuctionFiledTopic0()
  const chainId = env.chainId
  gcStaleLadderKeys(chainId, factory)

  const floor = BigInt(env.indexFromBlock)
  let existing = loadLadderEnvelope(chainId, factory)
  if (!existing) {
    existing = {
      v: 1,
      chainId,
      factory,
      cursor: floor.toString(),
      fromBlock: floor.toString(),
      auctions: [],
      updatedAt: Date.now(),
    }
  }

  const byAuction = new Map<string, IndexedAuction>()
  for (const A of existing.auctions) byAuction.set(A.auction.toLowerCase(), A)

  let cursor = BigInt(existing.cursor)
  if (cursor < floor) cursor = floor
  const fromBlock = BigInt(existing.fromBlock)

  let chunk = START_CHUNK
  let cleanStreak = 0
  const head = await resolveHead(client)

  const emit = (
    partial: Partial<ScanProgress> & Pick<ScanProgress, 'status' | 'message'>,
  ) => {
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

  emit({ status: 'scanning', message: `scanning ladder from ${cursor}` })

  const freshLogs: NonNullable<ReturnType<typeof parseAuctionFiledLog>>[] = []

  while (cursor <= head) {
    if (controls?.signal?.aborted) throw new Error('ladder scan aborted')
    const to = cursor + chunk - 1n > head ? head : cursor + chunk - 1n
    try {
      const logs = await client.getLogs({
        address: factory,
        event: auctionFiledEvent,
        fromBlock: cursor,
        toBlock: to,
      })
      for (const log of logs) {
        const parsed = parseAuctionFiledLog(log as AuctionFiledLog)
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
      saveLadderEnvelope(existing)
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
      message: `hydrating ${freshLogs.length} new auction(s)`,
    })
    const hydrated = await hydrateAuctions(client, freshLogs)
    for (const A of hydrated) byAuction.set(A.auction.toLowerCase(), A)
  }

  const auctions = [...byAuction.values()].sort((a, b) => {
    const bn = BigInt(b.blockNumber) - BigInt(a.blockNumber)
    if (bn !== 0n) return bn > 0n ? 1 : -1
    return b.logIndex - a.logIndex
  })

  // Preserve period stores — an auction scan must not wipe indexed path history.
  const envelope: LadderEnvelope = {
    v: 1,
    chainId,
    factory,
    cursor: cursor.toString(),
    fromBlock: fromBlock.toString(),
    auctions,
    updatedAt: Date.now(),
    periods: existing.periods,
  }
  saveLadderEnvelope(envelope)

  const progress: ScanProgress = {
    fromBlock,
    cursor,
    head,
    percent: 100,
    chunkSize: Number(chunk),
    status: 'done',
    message:
      auctions.length === 0
        ? 'no auctions filed yet. the ladder is dark.'
        : `indexed ${auctions.length} auction(s)`,
  }
  controls?.onProgress?.(progress)
  return { envelope, progress }
}
