import { useEffect, useMemo, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { expressFactoryAbi } from '../abi/expressFactory'
import { v4AdapterAbi } from '../abi/v4Adapter'
import { env } from '../config/env'
import type { IndexedListing } from '../indexer/types'
import {
  ethPerTokenFromSlot0,
  formatUsdSpot,
  poolIdFromKey,
  startUsdPerTokenFromMcap,
  usdPerTokenFromSideSlot0,
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

/** Batch-read spots for tape from each listing's ACTIVE pool. */
function useTapeSpots(listings: IndexedListing[]): Map<string, TapeSpot> {
  const client = usePublicClient()
  const { envelope } = useIndex()
  const [map, setMap] = useState<Map<string, TapeSpot>>(() => new Map())

  useEffect(() => {
    const adapter = env.addrV4Adapter
    const factory = env.addrExpressFactory
    if (!client || !adapter || listings.length === 0) {
      setMap(new Map())
      return
    }
    let cancelled = false
    const read = async () => {
      let liveEth = 0n
      if (factory) {
        try {
          liveEth = await client.readContract({
            address: factory,
            abi: expressFactoryAbi,
            functionName: 'currentEthUsdWad',
          })
        } catch (err) {
          console.error(
            '[tape] currentEthUsdWad',
            err instanceof Error ? err.message : err,
          )
        }
      }
      const liveRate = Number(liveEth) / 1e18
      const next = new Map<string, TapeSpot>()
      await Promise.all(
        listings
          .filter((L) => !L.hydrateError)
          .map(async (L) => {
            try {
              const meta = envelope?.listingSwapMeta?.[L.listing.toLowerCase()]
              const active = meta?.activePool ?? 'main'
              const key =
                active === 'side' && L.sidePoolKey
                  ? L.sidePoolKey
                  : L.mainPoolKey
              if (active === 'side' && !L.sidePoolKey) return

              const [sqrt] = await client.readContract({
                address: adapter,
                abi: v4AdapterAbi,
                functionName: 'getSlot0',
                args: [poolIdFromKey(key)],
              })
              if (sqrt === 0n) return

              let usd: number
              if (active === 'side') {
                usd = usdPerTokenFromSideSlot0(sqrt, key, L.token)
              } else {
                if (liveRate <= 0) return
                usd = ethPerTokenFromSlot0(sqrt, key) * liveRate
              }
              const startUsd = startUsdPerTokenFromMcap(
                L.startMcap,
                L.totalSupply,
              )
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
  }, [client, envelope, listings])

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
        const verdict = s.deltaPct >= 0 ? '☝ STONKZ' : '👇 NOT STONKZ'
        return {
          text: `$${L.symbol} ${formatUsdSpot(s.usd)} ${verdict}`,
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
