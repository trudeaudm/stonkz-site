import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { usePublicClient } from 'wagmi'
import { env } from '../config/env'
import { scanExpressListings } from '../indexer/scanner'
import { loadEnvelope } from '../indexer/storage'
import type { IndexedListing, ScanProgress } from '../indexer/types'

export type LogLine = {
  id: string
  text: string
  at: number
}

type IndexValue = {
  listings: IndexedListing[]
  progress: ScanProgress | null
  error: string | null
  logLines: LogLine[]
  factoryMissing: boolean
}

const Ctx = createContext<IndexValue | null>(null)

const WELCOME_LINE: LogLine = {
  id: 'welcome',
  text: 'welcom to stonkz. the line await you.',
  at: 0,
}

function tierLabel(startMcap: string): string {
  try {
    const v = BigInt(startMcap)
    if (v === 4000n * 10n ** 18n) return '$4K'
    if (v === 8000n * 10n ** 18n) return '$8K'
  } catch {
    /* unreadable card */
  }
  return 'custom tier'
}

function withWelcome(lines: LogLine[]): LogLine[] {
  if (lines.some((l) => l.id === 'welcome')) return lines
  return [WELCOME_LINE, ...lines]
}

export function IndexProvider({ children }: { children: ReactNode }) {
  const client = usePublicClient()
  const factory = env.addrExpressFactory
  const [listings, setListings] = useState<IndexedListing[]>([])
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logLines, setLogLines] = useState<LogLine[]>([WELCOME_LINE])

  useEffect(() => {
    if (!factory || !client) return
    const cached = loadEnvelope(env.chainId, factory)
    if (cached) {
      setListings(cached.listings)
      if (cached.listings.length > 0) {
        setLogLines(
          withWelcome(
            cached.listings.map((L) => ({
              id: `${L.txHash}:${L.logIndex}`,
              text: L.hydrateError
                ? `ExpressListed ${L.listing.slice(0, 10)}… · indexed but unreadable — ${L.hydrateError}`
                : `$${L.symbol} listed · ${tierLabel(L.startMcap)} tier · block ${L.blockNumber}`,
              at: L.hydratedAt,
            })),
          ),
        )
      }
    }

    const ac = new AbortController()
    const seen = new Set(
      (cached?.listings ?? []).map((L) => `${L.txHash}:${L.logIndex}`),
    )

    void (async () => {
      try {
        const { envelope, progress: p } = await scanExpressListings(
          client,
          factory,
          {
            signal: ac.signal,
            onProgress: (pr) => {
              setProgress(pr)
              if (pr.status === 'scanning') {
                setLogLines((prev) => {
                  const text = `scan · block ${pr.cursor.toString()} / ${pr.head.toString()} (${pr.percent.toFixed(1)}%)`
                  const last = prev[prev.length - 1]
                  if (last?.text.startsWith('scan ·')) {
                    return [...prev.slice(0, -1), { id: `scan:${pr.cursor}`, text, at: Date.now() }]
                  }
                  return [...prev, { id: `scan:${pr.cursor}`, text, at: Date.now() }]
                })
              }
            },
          },
        )
        setListings(envelope.listings)
        setProgress(p)
        for (const L of envelope.listings) {
          const id = `${L.txHash}:${L.logIndex}`
          if (seen.has(id)) continue
          seen.add(id)
          setLogLines((prev) => [
            ...prev,
            {
              id,
              text: L.hydrateError
                ? `ExpressListed ${L.listing.slice(0, 10)}… · indexed but unreadable — ${L.hydrateError}`
                : `$${L.symbol} listed · ${tierLabel(L.startMcap)} tier · block ${L.blockNumber}`,
              at: Date.now(),
            },
          ])
        }
        if (p.status === 'done') {
          setLogLines((prev) => [
            ...prev.filter((l) => !l.text.startsWith('scan ·')),
            {
              id: `done:${p.head.toString()}`,
              text: `index idle · head ${p.head.toString()} · ${envelope.listings.length} listing(s)`,
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
  }, [client, factory])

  const value = useMemo(
    () => ({
      listings,
      progress,
      error,
      logLines,
      factoryMissing: !factory,
    }),
    [listings, progress, error, logLines, factory],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useIndex() {
  const v = useContext(Ctx)
  if (!v) throw new Error('IndexProvider missing')
  return v
}
