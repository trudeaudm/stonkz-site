import { useEffect, useMemo, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { v4AdapterAbi } from '../abi/v4Adapter'
import { env } from '../config/env'
import type { IndexedListing } from '../indexer/types'
import {
  ethPerTokenFromSlot0,
  ethPerTokenFromStartPriceWad,
  formatDeltaPct,
  formatUsdSpot,
  poolIdFromKey,
} from '../prices/spotMath'
import { useIndex } from '../shell/IndexProvider'

type TapeSpot = { usd: number; deltaPct: number }

function tierLabel(startMcap: string): string {
  try {
    const v = BigInt(startMcap)
    if (v === 4000n * 10n ** 18n) return '$4K'
    if (v === 8000n * 10n ** 18n) return '$8K'
  } catch {
    /* ignore */
  }
  return 'custom tier'
}

/** Batch-read spots for tape (shared interval). */
function useTapeSpots(listings: IndexedListing[]): Map<string, TapeSpot> {
  const client = usePublicClient()
  const [map, setMap] = useState<Map<string, TapeSpot>>(() => new Map())

  useEffect(() => {
    const adapter = env.addrV4Adapter
    if (!client || !adapter || listings.length === 0) {
      setMap(new Map())
      return
    }
    let cancelled = false
    const read = async () => {
      const next = new Map<string, TapeSpot>()
      await Promise.all(
        listings
          .filter((L) => !L.hydrateError)
          .map(async (L) => {
            try {
              let ethUsd =
                L.ethUsdWad != null && L.ethUsdWad !== '0'
                  ? BigInt(L.ethUsdWad)
                  : 0n
              if (ethUsd === 0n) {
                ethUsd = await client.readContract({
                  address: L.listing,
                  abi: [
                    {
                      type: 'function',
                      name: 'ethUsdWad',
                      stateMutability: 'view',
                      inputs: [],
                      outputs: [{ type: 'uint256' }],
                    },
                  ] as const,
                  functionName: 'ethUsdWad',
                })
              }
              if (ethUsd === 0n) return
              const [sqrt] = await client.readContract({
                address: adapter,
                abi: v4AdapterAbi,
                functionName: 'getSlot0',
                args: [poolIdFromKey(L.mainPoolKey)],
              })
              if (sqrt === 0n) return
              const ethPer = ethPerTokenFromSlot0(sqrt, L.mainPoolKey)
              const rate = Number(ethUsd) / 1e18
              const usd = ethPer * rate
              const startUsd =
                ethPerTokenFromStartPriceWad(L.startPriceWad) * rate
              const deltaPct =
                startUsd > 0 ? ((usd - startUsd) / startUsd) * 100 : 0
              if (Number.isFinite(usd) && usd > 0) {
                next.set(L.listing.toLowerCase(), { usd, deltaPct })
              }
            } catch (err) {
              console.error(
                '[tape spot]',
                L.listing,
                err instanceof Error ? err.message : err,
              )
            }
          }),
      )
      if (!cancelled) setMap(next)
    }
    void read()
    const id = window.setInterval(() => void read(), 15_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [client, listings])

  return map
}

export function TickerTape() {
  const { listings, progress } = useIndex()
  const spots = useTapeSpots(listings)

  const items = useMemo(() => {
    const status: { text: string; up?: boolean }[] = [
      { text: 'gate: closed — soft launch' },
      { text: `head: ${progress?.head?.toString() ?? '…'}` },
      { text: `launches indexed: ${listings.length}`, up: listings.length > 0 },
    ]
    if (progress?.status === 'scanning') {
      status.push({
        text: `scan: ${progress.percent.toFixed(1)}% · block ${progress.cursor.toString()}`,
      })
    }
    const ticks = listings.map((L) => {
      const s = spots.get(L.listing.toLowerCase())
      if (L.hydrateError) {
        return { text: `unreadable · block ${L.blockNumber}`, up: true as const }
      }
      if (s) {
        return {
          text: `$${L.symbol} ${formatUsdSpot(s.usd)} ${formatDeltaPct(s.deltaPct)}`,
          up: s.deltaPct >= 0,
        }
      }
      return {
        text: `$${L.symbol} · ${tierLabel(L.startMcap)} tier · block ${L.blockNumber}`,
        up: true as const,
      }
    })
    const out: { text: string; up?: boolean }[] = []
    const max = Math.max(status.length, ticks.length, 1)
    for (let i = 0; i < max; i++) {
      if (status[i % status.length]) out.push(status[i % status.length])
      if (ticks[i]) out.push(ticks[i])
    }
    return [...out, ...out]
  }, [listings, progress, spots])

  return (
    <div className="tape" aria-label="market ticker">
      <div className="tape-track">
        {items.map((t, i) => (
          <span
            key={`${t.text}-${i}`}
            className={`tape-item${t.up === false ? ' down' : t.up ? ' up' : ''}`}
          >
            {t.text}
          </span>
        ))}
      </div>
    </div>
  )
}
