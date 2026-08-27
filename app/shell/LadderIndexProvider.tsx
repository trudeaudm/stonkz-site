import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { usePublicClient } from 'wagmi'
import { env } from '../config/env'
import { refreshAuctionStates } from '../indexer/ladderHydrate'
import { scanLadderAuctions } from '../indexer/ladderScanner'
import { loadLadderEnvelope, saveLadderEnvelope } from '../indexer/ladderStorage'
import {
  deriveLadderStatus,
  isLadderActive,
  type IndexedAuction,
  type LadderEnvelope,
  type LadderStatus,
} from '../indexer/ladderTypes'
import type { ScanProgress } from '../indexer/types'
import type { LogLine } from './IndexProvider'

/**
 * A live book moves every block, but only the 16 mutable slots do. One tick is one
 * multicall across every not-done auction, so the cost is flat in auction count.
 * Auctions that are `done` are dropped from the tick permanently.
 */
const POLL_MS = 12_000

type LadderIndexValue = {
  auctions: IndexedAuction[]
  envelope: LadderEnvelope | null
  progress: ScanProgress | null
  error: string | null
  logLines: LogLine[]
  factoryMissing: boolean
  /** Re-run the full AuctionFiled scan (e.g. after filing from this tab). */
  refresh: () => void
}

const Ctx = createContext<LadderIndexValue | null>(null)

function statusLine(A: IndexedAuction): string {
  if (A.hydrateError) {
    return `AuctionFiled ${A.auction.slice(0, 10)}… · indexed but unreadable — ${A.hydrateError}`
  }
  const status: LadderStatus = deriveLadderStatus(A.state)
  const where =
    status === 'live'
      ? `period ${A.state.periodIndex}/${A.n}`
      : `block ${A.blockNumber}`
  return `$${A.symbol} ladder · ${status} · ${where}`
}

export function LadderIndexProvider({ children }: { children: ReactNode }) {
  const client = usePublicClient()
  const factory = env.addrLadderFactory
  const [auctions, setAuctions] = useState<IndexedAuction[]>([])
  const [envelope, setEnvelope] = useState<LadderEnvelope | null>(null)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logLines, setLogLines] = useState<LogLine[]>([])
  const [scanNonce, setScanNonce] = useState(0)

  // Latest rows, for the poll tick — it must not re-subscribe on every state change.
  const auctionsRef = useRef<IndexedAuction[]>([])
  auctionsRef.current = auctions

  useEffect(() => {
    if (!factory || !client) return
    const cached = loadLadderEnvelope(env.chainId, factory)
    if (cached) {
      setEnvelope(cached)
      setAuctions(cached.auctions)
      if (cached.auctions.length > 0) {
        setLogLines(
          cached.auctions.map((A) => ({
            id: `${A.txHash}:${A.logIndex}`,
            text: statusLine(A),
            at: A.hydratedAt,
          })),
        )
      }
    }

    const ac = new AbortController()
    const seen = new Set(
      (cached?.auctions ?? []).map((A) => `${A.txHash}:${A.logIndex}`),
    )

    void (async () => {
      try {
        const { envelope: envl, progress: p } = await scanLadderAuctions(
          client,
          factory,
          {
            signal: ac.signal,
            onProgress: (pr) => {
              setProgress(pr)
              if (pr.status === 'scanning') {
                setLogLines((prev) => {
                  const text = `ladder scan · block ${pr.cursor.toString()} / ${pr.head.toString()} (${pr.percent.toFixed(1)}%)`
                  const last = prev[prev.length - 1]
                  if (last?.text.startsWith('ladder scan ·')) {
                    return [
                      ...prev.slice(0, -1),
                      { id: `ladder:${pr.cursor}`, text, at: Date.now() },
                    ]
                  }
                  return [
                    ...prev,
                    { id: `ladder:${pr.cursor}`, text, at: Date.now() },
                  ]
                })
              }
            },
          },
        )
        setAuctions(envl.auctions)
        setEnvelope(envl)
        setProgress(p)
        for (const A of envl.auctions) {
          const id = `${A.txHash}:${A.logIndex}`
          if (seen.has(id)) continue
          seen.add(id)
          setLogLines((prev) => [
            ...prev,
            { id, text: statusLine(A), at: Date.now() },
          ])
        }
        if (p.status === 'done') {
          setLogLines((prev) => [
            ...prev.filter((l) => !l.text.startsWith('ladder scan ·')),
            {
              id: `ladder-done:${p.head.toString()}`,
              text: `ladder idle · head ${p.head.toString()} · ${envl.auctions.length} auction(s)`,
              at: Date.now(),
            },
          ])
        }
      } catch (err) {
        if (ac.signal.aborted) return
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => ac.abort()
  }, [client, factory, scanNonce])

  useEffect(() => {
    if (!factory || !client) return
    let stopped = false

    const tick = async () => {
      const live = auctionsRef.current.filter(
        (A) => !A.hydrateError && isLadderActive(A),
      )
      if (live.length === 0) return
      try {
        const states = await refreshAuctionStates(
          client,
          live.map((A) => A.auction),
        )
        if (stopped || states.size === 0) return
        const next = auctionsRef.current.map((A) => {
          const s = states.get(A.auction.toLowerCase())
          return s ? { ...A, state: s } : A
        })
        auctionsRef.current = next
        setAuctions(next)
        // Persist so a reload does not show a stale price before the first tick.
        const envl = loadLadderEnvelope(env.chainId, factory)
        if (envl) {
          const merged = { ...envl, auctions: next, updatedAt: Date.now() }
          saveLadderEnvelope(merged)
          setEnvelope(merged)
        }
      } catch (err) {
        // A dropped tick is not an index error — the next one recovers.
        console.error(
          '[ladder] state poll failed:',
          err instanceof Error ? err.message : err,
        )
      }
    }

    const id = setInterval(() => void tick(), POLL_MS)
    void tick()
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [client, factory])

  const refresh = useCallback(() => {
    setScanNonce((n) => n + 1)
  }, [])

  const value = useMemo(
    () => ({
      auctions,
      envelope,
      progress,
      error,
      logLines,
      factoryMissing: !factory,
      refresh,
    }),
    [auctions, envelope, progress, error, logLines, factory, refresh],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useLadderIndex() {
  const v = useContext(Ctx)
  if (!v) throw new Error('LadderIndexProvider missing')
  return v
}
