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
import { scanListingSwaps } from '../indexer/swaps'
import { loadEnvelope } from '../indexer/storage'
import type {
  IndexEnvelope,
  IndexedListing,
  ScanProgress,
} from '../indexer/types'

export type LogLine = {
  id: string
  text: string
  at: number
}

type IndexValue = {
  listings: IndexedListing[]
  envelope: IndexEnvelope | null
  progress: ScanProgress | null
  swapProgress: ScanProgress | null
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
  const [envelope, setEnvelope] = useState<IndexEnvelope | null>(null)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [swapProgress, setSwapProgress] = useState<ScanProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logLines, setLogLines] = useState<LogLine[]>([WELCOME_LINE])

  useEffect(() => {
    if (!factory || !client) return
    const cached = loadEnvelope(env.chainId, factory)
    if (cached) {
      setEnvelope(cached)
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
        const { envelope: envl, progress: p } = await scanExpressListings(
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
                    return [
                      ...prev.slice(0, -1),
                      { id: `scan:${pr.cursor}`, text, at: Date.now() },
                    ]
                  }
                  return [
                    ...prev,
                    { id: `scan:${pr.cursor}`, text, at: Date.now() },
                  ]
                })
              }
            },
          },
        )
        setListings(envl.listings)
        setEnvelope(envl)
        setProgress(p)
        for (const L of envl.listings) {
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
              text: `index idle · head ${p.head.toString()} · ${envl.listings.length} listing(s)`,
              at: Date.now(),
            },
          ])
        }

        // Swap indexer — after listings; PoolManager via adapter.manager().
        if (envl.listings.some((L) => !L.hydrateError)) {
          try {
            const { envelope: withSwaps, progress: sp } = await scanListingSwaps(
              client,
              factory,
              {
                signal: ac.signal,
                onProgress: (pr) => {
                  setSwapProgress(pr)
                  if (pr.status === 'scanning') {
                    setLogLines((prev) => {
                      const text = pr.message
                      const last = prev[prev.length - 1]
                      if (last?.text.startsWith('swaps ·')) {
                        return [
                          ...prev.slice(0, -1),
                          { id: `swaps:${Date.now()}`, text, at: Date.now() },
                        ]
                      }
                      return [
                        ...prev,
                        { id: `swaps:${Date.now()}`, text, at: Date.now() },
                      ]
                    })
                  }
                },
                onErrorLine: (text) => {
                  setLogLines((prev) => [
                    ...prev,
                    { id: `swaps-err:${Date.now()}`, text, at: Date.now() },
                  ])
                },
              },
            )
            setEnvelope(withSwaps)
            setListings(withSwaps.listings)
            setSwapProgress(sp)
            if (sp.status === 'done') {
              setLogLines((prev) => [
                ...prev.filter((l) => !l.text.startsWith('swaps ·')),
                {
                  id: `swaps-done:${sp.head.toString()}`,
                  text: sp.message,
                  at: Date.now(),
                },
              ])
            }
          } catch (swapErr) {
            if (ac.signal.aborted) return
            const msg =
              swapErr instanceof Error ? swapErr.message : String(swapErr)
            console.error('[swaps] scan failed:', msg)
            setLogLines((prev) => [
              ...prev,
              {
                id: `swaps-err:${Date.now()}`,
                text: `swaps ERROR — ${msg}`,
                at: Date.now(),
              },
            ])
            // Keep listings; do not wipe envelope.
            setEnvelope(loadEnvelope(env.chainId, factory))
          }
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
      envelope,
      progress,
      swapProgress,
      error,
      logLines,
      factoryMissing: !factory,
    }),
    [listings, envelope, progress, swapProgress, error, logLines, factory],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useIndex() {
  const v = useContext(Ctx)
  if (!v) throw new Error('IndexProvider missing')
  return v
}
