import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatEther, type Address } from 'viem'
import { useAccount, usePublicClient } from 'wagmi'
import { launchTokenAbi } from '../abi/launchToken'
import type { IndexedListing } from '../indexer/types'
import {
  formatDeltaPct,
  formatUsdSpot,
} from '../prices/spotMath'
import { useMainPoolSpot } from '../prices/useMainPoolSpot'
import { FlexCard } from './FlexCard'
import { useIndex } from './IndexProvider'
import { Stamp } from './Stamp'
import { useToast } from './Toast'
import { Win95Window } from './Window'

type BagMetric = {
  listing: Address
  symbol: string
  coins: number
  valueUsd: number | null
  deltaPct: number | null
  spotUsd: number | null
}

function BagRow({
  listing,
  balanceRaw,
  isCreator,
  onOpen,
}: {
  listing: IndexedListing
  balanceRaw: bigint
  isCreator: boolean
  onOpen: (listing: Address) => void
}) {
  const spot = useMainPoolSpot(listing, true)
  const human = Number(formatEther(balanceRaw))
  const valueUsd = spot ? human * spot.usdPerToken : null
  const stampUp = spot ? spot.deltaPct >= 0 : true

  return (
    <button
      type="button"
      className="win bag-row"
      style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}
      onClick={() => onOpen(listing.listing)}
    >
      <div className="title">
        💼 {listing.symbol.toLowerCase()}_bag.zip
      </div>
      <div className="body95">
        <div className="coinrow">
          <div className="coinic">
            {listing.symbol.slice(0, 1).toUpperCase()}
          </div>
          <div className="grow">
            <div className="tk">
              ${listing.symbol}{' '}
              <Stamp variant={stampUp ? 'stonkz' : 'not'}>
                {spot
                  ? spot.deltaPct >= 0
                    ? 'STONKZ'
                    : 'NOT STONKZ'
                  : 'STONKZ'}
              </Stamp>
              {isCreator && <span className="creator-tag">creator</span>}
            </div>
            <div className="nm">
              {human.toLocaleString(undefined, { maximumFractionDigits: 4 })}{' '}
              coins
              {valueUsd != null && (
                <>
                  {' '}
                  · {formatUsdSpot(valueUsd)} @ spot
                </>
              )}
            </div>
          </div>
          {spot && (
            <div>
              <div className="px">{formatUsdSpot(spot.usdPerToken)}</div>
              <div
                className={`px ${spot.deltaPct >= 0 ? 'up' : 'down'}`}
                style={{ fontSize: 11 }}
              >
                {formatDeltaPct(spot.deltaPct)}
              </div>
            </div>
          )}
        </div>
      </div>
    </button>
  )
}

/** Per-bag spot probe — reports valueUsd = balance * spot when available. */
function BagSpotProbe({
  listing,
  balanceRaw,
  onMetric,
}: {
  listing: IndexedListing
  balanceRaw: bigint
  onMetric: (m: BagMetric) => void
}) {
  const spot = useMainPoolSpot(listing, true)
  const coins = Number(formatEther(balanceRaw))
  const valueUsd = spot ? coins * spot.usdPerToken : null

  useEffect(() => {
    onMetric({
      listing: listing.listing,
      symbol: listing.symbol,
      coins,
      valueUsd,
      deltaPct: spot?.deltaPct ?? null,
      spotUsd: spot?.usdPerToken ?? null,
    })
  }, [
    coins,
    listing.listing,
    listing.symbol,
    onMetric,
    spot?.deltaPct,
    spot?.usdPerToken,
    valueUsd,
  ])

  return null
}

function FlexCardMaker({
  bags,
  balances,
}: {
  bags: IndexedListing[]
  balances: Map<string, bigint>
}) {
  const toast = useToast()
  const [metrics, setMetrics] = useState<Map<string, BagMetric>>(() => new Map())

  const onMetric = useCallback((m: BagMetric) => {
    setMetrics((prev) => {
      const key = m.listing.toLowerCase()
      const cur = prev.get(key)
      if (
        cur &&
        cur.valueUsd === m.valueUsd &&
        cur.deltaPct === m.deltaPct &&
        cur.coins === m.coins
      ) {
        return prev
      }
      const next = new Map(prev)
      next.set(key, m)
      return next
    })
  }, [])

  const best = useMemo(() => {
    let top: BagMetric | null = null
    for (const m of metrics.values()) {
      if (m.valueUsd == null) continue
      if (!top || (top.valueUsd ?? -1) < m.valueUsd) top = m
    }
    // If no priced bags yet, fall back to first bag by coin count so flex still shows.
    if (!top && bags.length > 0) {
      const L = bags[0]
      const key = L.listing.toLowerCase()
      return (
        metrics.get(key) ?? {
          listing: L.listing,
          symbol: L.symbol,
          coins: Number(formatEther(balances.get(key) ?? 0n)),
          valueUsd: null,
          deltaPct: null,
          spotUsd: null,
        }
      )
    }
    return top
  }, [bags, balances, metrics])

  const copyFlex = async () => {
    if (!best) return
    const delta =
      best.deltaPct != null && Number.isFinite(best.deltaPct)
        ? `${best.deltaPct >= 0 ? '+' : ''}${best.deltaPct.toFixed(0)}%`
        : 'Δ vs start'
    const val =
      best.valueUsd != null ? formatUsdSpot(best.valueUsd) : 'spot waking'
    const text = `$${best.symbol} BAG FLEX ${delta} · ${val} · ${best.coins.toLocaleString(undefined, { maximumFractionDigits: 2 })} coins · @you · stonkz.green`
    try {
      await navigator.clipboard.writeText(text)
      toast.push('flex copyed ✓', 'ok')
    } catch {
      toast.push('clipboard say no — copy fail', 'err')
    }
  }

  return (
    <div className="win" style={{ marginTop: 12 }}>
      <div className="title">📸 flex_card_maker.exe</div>
      <div className="body95">
        {bags.map((L) => (
          <BagSpotProbe
            key={L.listing}
            listing={L}
            balanceRaw={balances.get(L.listing.toLowerCase())!}
            onMetric={onMetric}
          />
        ))}
        {bags.length === 0 || !best ? (
          <div className="hint" style={{ textAlign: 'left', marginTop: 0 }}>
            no bag to flex yet. buy first, then flex.
          </div>
        ) : (
          <>
            <FlexCard
              symbol={best.symbol}
              deltaPct={best.deltaPct}
              valueUsd={best.valueUsd}
              coins={best.coins}
            />
            <button
              type="button"
              className="btn95 big gold"
              style={{ marginTop: 10 }}
              onClick={() => void copyFlex()}
            >
              📸 copy the flex
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function LeaguePanel({
  bags,
  balances,
}: {
  bags: IndexedListing[]
  balances: Map<string, bigint>
}) {
  const { address } = useAccount()
  const [metrics, setMetrics] = useState<Map<string, BagMetric>>(() => new Map())

  const onMetric = useCallback((m: BagMetric) => {
    setMetrics((prev) => {
      const key = m.listing.toLowerCase()
      const next = new Map(prev)
      next.set(key, m)
      return next
    })
  }, [])

  const totalUsd = useMemo(() => {
    let sum = 0
    let any = false
    for (const m of metrics.values()) {
      if (m.valueUsd == null) continue
      sum += m.valueUsd
      any = true
    }
    return any ? sum : null
  }, [metrics])

  return (
    <div className="win">
      <div
        className="title amber"
        style={{ background: 'linear-gradient(90deg,#7A4E00,#E8B54A)' }}
      >
        🏆 leage_of_underwriters.exe — season 0
      </div>
      <div className="body95">
        {bags.map((L) => (
          <BagSpotProbe
            key={`lg-${L.listing}`}
            listing={L}
            balanceRaw={balances.get(L.listing.toLowerCase())!}
            onMetric={onMetric}
          />
        ))}
        {address && totalUsd != null && (
          <div className="dr">
            <span>your bags</span>
            <b>{formatUsdSpot(totalUsd)}</b>
          </div>
        )}
        <div className="hint">
          season 0 has not begun. points may become airdrop. may. we not promis.
          kalm.
        </div>
      </div>
    </div>
  )
}

export function MyStuffWindow({
  onOpen,
  onClose,
}: {
  onOpen: (listing: Address) => void
  onClose: () => void
}) {
  const { address } = useAccount()
  const client = usePublicClient()
  const { listings } = useIndex()
  const [balances, setBalances] = useState<Map<string, bigint>>(() => new Map())

  const readable = useMemo(
    () => listings.filter((L) => !L.hydrateError),
    [listings],
  )

  useEffect(() => {
    if (!address || !client || readable.length === 0) {
      setBalances(new Map())
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const results = await client.multicall({
          contracts: readable.map((L) => ({
            address: L.token,
            abi: launchTokenAbi,
            functionName: 'balanceOf' as const,
            args: [address] as const,
          })),
          allowFailure: true,
        })
        if (cancelled) return
        const next = new Map<string, bigint>()
        results.forEach((r, i) => {
          if (r.status === 'success' && typeof r.result === 'bigint' && r.result > 0n) {
            next.set(readable[i].listing.toLowerCase(), r.result)
          }
        })
        setBalances(next)
      } catch (err) {
        console.error(
          '[my stuff] balanceOf multicall failed',
          err instanceof Error ? err.message : err,
        )
        if (!cancelled) setBalances(new Map())
      }
    })()
    return () => {
      cancelled = true
    }
  }, [address, client, readable])

  const bags = readable.filter((L) =>
    balances.has(L.listing.toLowerCase()),
  )

  return (
    <Win95Window
      id="my_stuff"
      title="my_stuff.exe"
      width={780}
      onClose={onClose}
    >
      <div className="me-page">
        <a
          className="back btn95"
          href="#/"
          onClick={() => {
            onClose()
          }}
        >
          ← back to stonkz
        </a>
        <div className="me-caption">MY STUFF. THE BAGS. THE GLORY.</div>
        <div className="grid2">
          <div>
            <div className="me-section-cap">— live bids —</div>
            <div className="win">
              <div className="body95 nm">
                no bids yet. the book is waiting for you, fren.
              </div>
            </div>

            <div className="me-section-cap">— the bags —</div>
            {!address ? (
              <div className="win">
                <div className="body95 hint">connect a wallet to see bags.</div>
              </div>
            ) : bags.length === 0 ? (
              <div className="win">
                <div className="body95 nm">no bags yet.</div>
              </div>
            ) : (
              bags.map((L) => (
                <BagRow
                  key={L.listing}
                  listing={L}
                  balanceRaw={balances.get(L.listing.toLowerCase())!}
                  isCreator={
                    !!address &&
                    L.creator.toLowerCase() === address.toLowerCase()
                  }
                  onOpen={onOpen}
                />
              ))
            )}
          </div>
          <div>
            <LeaguePanel bags={bags} balances={balances} />
            <FlexCardMaker bags={bags} balances={balances} />
          </div>
        </div>
      </div>
    </Win95Window>
  )
}
