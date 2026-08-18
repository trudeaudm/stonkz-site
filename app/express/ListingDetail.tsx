import { useCallback, useEffect, useState } from 'react'
import { formatEther, getAddress, type Address } from 'viem'
import { useAccount, usePublicClient, useReadContract } from 'wagmi'
import { directListingAbi } from '../abi/directListing'
import { launchTokenAbi } from '../abi/launchToken'
import { env } from '../config/env'
import { FlexCard } from '../shell/FlexCard'
import { Stamp } from '../shell/Stamp'
import { Win95Window } from '../shell/Window'
import { useWindowManager } from '../shell/windowManager'
import { hydrateListingByAddress, refreshMutable } from '../indexer/hydrate'
import { effectiveVolumePairRaw } from '../indexer/swaps'
import { loadEnvelope, saveEnvelope } from '../indexer/storage'
import type { IndexedListing } from '../indexer/types'
import {
  formatEthUsdRate,
  formatStampedEthUsdLine,
  isV2UsdStamp,
} from './listingDisplay'
import { ZigChart } from '../prices/ChartSvg'
import { useCostBasis } from '../prices/useCostBasis'
import {
  formatDeltaPct,
  formatMcapUsd,
  formatPairVolumeLabel,
  formatTimeAgo,
  formatUsdSpot,
} from '../prices/spotMath'
import {
  lastSwapEvent,
  swapDirection,
  useActiveSwapStore,
  useListingSpot,
  usePriceSeries,
} from '../prices/useMainPoolSpot'
import { TradePanel } from '../trade/TradePanel'

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function explorer(path: string) {
  return `${env.explorerUrl.replace(/\/$/, '')}/${path}`
}

function dexscreenerTokenUrl(token: string): string | null {
  const base = import.meta.env.VITE_DEXSCREENER_URL
  if (base == null || String(base).trim() === '') return null
  const cleaned = String(base).replace(/\/$/, '')
  if (!cleaned.startsWith('https://')) return null
  return `${cleaned}/${token}`
}

function reserveModeLabel(record: IndexedListing): string {
  if (
    !record.creatorReserveState.filed ||
    BigInt(record.creatorReserve) === 0n
  ) {
    return 'none'
  }
  if (record.creatorReserveState.mode === 0) return 'INSTANT'
  return 'VEST'
}

function reserveBpsOrRaw(record: IndexedListing): string {
  const reserve = BigInt(record.creatorReserve)
  const supply = BigInt(record.totalSupply)
  if (reserve === 0n) return '0'
  if (supply > 0n) {
    const bps = Number((reserve * 10_000n) / supply)
    return `${bps} bps`
  }
  return `${reserve.toString()} raw`
}

export function TokenWindow({
  listing,
  onClose,
}: {
  listing: Address
  onClose: () => void
}) {
  const client = usePublicClient()
  const { address } = useAccount()
  const { open } = useWindowManager()
  const factory = env.addrExpressFactory
  const [record, setRecord] = useState<IndexedListing | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [ethUsdWad, setEthUsdWad] = useState<bigint | null>(null)
  const [ethUsdResolved, setEthUsdResolved] = useState(false)
  const [lastTradeAgo, setLastTradeAgo] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setErr(null)
      setRecord(null)
      setEthUsdWad(null)
      setEthUsdResolved(false)

      if (factory) {
        const envl = loadEnvelope(env.chainId, factory)
        const found = envl?.listings.find(
          (L) => L.listing.toLowerCase() === listing.toLowerCase(),
        )
        if (found) {
          if (cancelled) return
          setRecord(found)
          if (found.ethUsdWad != null) {
            setEthUsdWad(BigInt(found.ethUsdWad))
            setEthUsdResolved(true)
          } else {
            setEthUsdWad(null)
            setEthUsdResolved(false)
          }
          setLoading(false)
          return
        }
      }

      if (!client) {
        if (!cancelled) {
          setErr('no rpc client')
          setLoading(false)
        }
        return
      }

      try {
        const hydrated = await hydrateListingByAddress(
          client,
          getAddress(listing),
        )
        if (cancelled) return
        if (!hydrated) {
          setErr(
            'not a listing contract — no code at address, or getters reverted',
          )
          setLoading(false)
          return
        }
        setRecord(hydrated)
        if (hydrated.ethUsdWad != null) {
          setEthUsdWad(BigInt(hydrated.ethUsdWad))
        } else {
          setEthUsdWad(null)
        }
        setEthUsdResolved(true)
        setLoading(false)
      } catch (e) {
        if (cancelled) return
        setErr(e instanceof Error ? e.message : String(e))
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [factory, listing, client])

  useEffect(() => {
    if (!record) return
    open(
      `token:${listing}` as `token:${string}`,
      `${record.symbol.toLowerCase()}.exe — on the market`,
    )
  }, [record, listing, open])

  const refresh = useCallback(async () => {
    if (!client || !record) return
    const mut = await refreshMutable(client, getAddress(record.listing))
    if (!mut) {
      setErr('mutable refresh failed')
      return
    }
    const next: IndexedListing = {
      ...record,
      sidePoolDeployed: mut.sidePoolDeployed,
      creatorReserveState: mut.creatorReserveState,
      hydratedAt: Date.now(),
    }
    setRecord(next)
    if (factory && !next.notYetIndexed) {
      const envl = loadEnvelope(env.chainId, factory)
      if (envl) {
        envl.listings = envl.listings.map((L) =>
          L.listing.toLowerCase() === next.listing.toLowerCase() ? next : L,
        )
        envl.updatedAt = Date.now()
        saveEnvelope(envl)
      }
    }
  }, [client, factory, record])

  useEffect(() => {
    if (!client || !record || ethUsdResolved) return
    let cancelled = false
    void (async () => {
      try {
        const wad = await client.readContract({
          address: getAddress(record.listing),
          abi: directListingAbi,
          functionName: 'ethUsdWad',
        })
        if (!cancelled) setEthUsdWad(wad)
      } catch {
        if (!cancelled) setEthUsdWad(null)
      } finally {
        if (!cancelled) setEthUsdResolved(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [client, record, ethUsdResolved])

  useEffect(() => {
    if (!record) return
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh on open only
  }, [listing, record?.listing])

  const spot = useListingSpot(record, Boolean(record) && !loading && !err)
  const series = usePriceSeries(record, spot?.liveEthUsd ?? null)
  const swapStore = useActiveSwapStore(record)
  const lastEv = lastSwapEvent(swapStore)

  useEffect(() => {
    if (!client || !lastEv) {
      setLastTradeAgo(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const block = await client.getBlock({
          blockNumber: BigInt(lastEv.blockNumber),
        })
        if (!cancelled) {
          setLastTradeAgo(formatTimeAgo(Number(block.timestamp)))
        }
      } catch (e) {
        console.error(
          '[token] last-trade timestamp',
          e instanceof Error ? e.message : e,
        )
        if (!cancelled) setLastTradeAgo(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [client, lastEv])

  const { data: holderBal } = useReadContract({
    address: record?.token,
    abi: launchTokenAbi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: Boolean(record?.token && address),
    },
  })

  const basis = useCostBasis(
    record,
    address,
    typeof holderBal === 'bigint' ? holderBal : undefined,
    spot?.liveEthUsd ?? null,
  )

  const title = record
    ? `${record.symbol.toLowerCase()}.exe — on the market`
    : 'token.exe — on the market'

  if (!record) {
    return (
      <Win95Window
        id={`token:${listing}`}
        title={title}
        width={520}
        onClose={onClose}
      >
        <a
          className="back btn95"
          href="#/"
          onClick={() => {
            onClose()
          }}
        >
          ← back to stonkz
        </a>
        <p className={err ? 'check bad' : 'hint'}>
          {err ?? (loading ? 'loading from chain…' : 'loading…')}
        </p>
      </Win95Window>
    )
  }

  const mode = reserveModeLabel(record)
  const v2Usd = isV2UsdStamp(ethUsdWad)
  const sideDexUrl = dexscreenerTokenUrl(record.token)
  const sideLabel = !record.createSidePool
    ? 'off'
    : record.sidePoolDeployed
      ? `${record.sidePoolBps} bps · deployed`
      : `${record.sidePoolBps} bps · pending`

  const volPairRaw =
    swapStore != null
      ? effectiveVolumePairRaw(swapStore, record.token)
      : '0'
  const volumeLabel =
    swapStore != null && swapStore.swapCount > 0
      ? formatPairVolumeLabel(
          volPairRaw,
          swapStore.kind,
          spot?.liveEthUsd ?? null,
        )
      : null
  const swapCount = swapStore?.swapCount ?? 0
  const lastDir =
    swapStore && lastEv
      ? swapDirection(swapStore, record.token, lastEv)
      : null
  const lastTradeLabel =
    swapStore && swapStore.lastSwapBlock !== '0'
      ? `block ${swapStore.lastSwapBlock}${lastTradeAgo ? ` · ${lastTradeAgo}` : ''}${lastDir ? ` · ${lastDir}` : ''}`
      : null
  const flexDelta =
    basis != null && spot
      ? ((spot.usdPerToken - basis.avgCostUsd) / basis.avgCostUsd) * 100
      : (spot?.deltaPct ?? null)
  const flexSubtitle =
    basis != null
      ? `got at ${formatUsdSpot(basis.avgCostUsd)} avg${basis.partial ? ' · partial — swaps only' : ''} · now ${formatUsdSpot(spot?.usdPerToken ?? 0)}`
      : undefined

  return (
    <Win95Window
      id={`token:${listing}`}
      title={title}
      width={520}
      onClose={onClose}
    >
      <a
        className="back btn95"
        href="#/"
        onClick={() => {
          onClose()
        }}
      >
        ← back to stonkz
      </a>

      <div className="coinrow" style={{ marginBottom: 8 }}>
        <div className="coinic">
          {record.symbol.slice(0, 1).toUpperCase() || '?'}
        </div>
        <div className="grow">
          <div className="tk">
            ${record.symbol}{' '}
            {spot ? (
              <Stamp variant={spot.deltaPct >= 0 ? 'stonkz' : 'not'}>
                {spot.deltaPct >= 0 ? 'STONKZ' : 'NOT STONKZ'}
              </Stamp>
            ) : (
              <Stamp variant={record.liquidityLocked ? 'stonkz' : 'not'}>
                {record.liquidityLocked
                  ? 'locked forever'
                  : 'creator can withdraw'}
              </Stamp>
            )}{' '}
            <Stamp variant="insta">⚡ INSTANT</Stamp>
          </div>
          <div className="nm">{record.name}</div>
        </div>
      </div>

      {spot ? (
        <div className="bigpx">
          {formatUsdSpot(spot.usdPerToken)}{' '}
          <span
            className={spot.deltaPct >= 0 ? 'up' : 'down'}
            style={{ fontSize: 15 }}
          >
            {formatDeltaPct(spot.deltaPct)}
          </span>
        </div>
      ) : (
        <div className="hint" style={{ marginBottom: 6 }}>
          spot wakes when the active pool answers.
        </div>
      )}

      {spot && (
        <div className="mono" style={{ fontSize: 12, marginBottom: 6 }}>
          mcap now {formatMcapUsd(spot.mcapNow)} · start tier{' '}
          {formatMcapUsd(Number(BigInt(record.startMcap)) / 1e18)} · via{' '}
          {spot.activePool} pool
          {spot.activePool === 'main' && spot.liveEthUsd != null
            ? ` @ live rate`
            : ''}
        </div>
      )}

      {record.notYetIndexed && (
        <p className="hint">not yet indexed — reading directly from chain</p>
      )}

      {swapCount === 0 ? (
        <div
          className="zig"
          style={{
            marginTop: 8,
            minHeight: 72,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 12,
          }}
        >
          <span className="hint" style={{ margin: 0 }}>
            chart wakes when trades index.
          </span>
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          <ZigChart
            series={
              series.length > 0
                ? series
                : spot && spot.usdPerToken > 0
                  ? [spot.usdPerToken]
                  : []
            }
            startUsd={spot?.startUsdPerToken ?? 0}
            height={140}
          />
          {swapCount > 0 && swapCount < 3 && (
            <p className="hint" style={{ marginTop: 6 }}>
              one trade so far. line needs more frens.
            </p>
          )}
        </div>
      )}

      <div className="win" style={{ marginTop: 12 }}>
        <div className="title">🔍 recon.exe — is coin ok?</div>
        <div className="body95">
          <div className="dr">
            <span>LP</span>
            <b className={record.liquidityLocked ? 'up' : 'down'}>
              {record.liquidityLocked
                ? 'locked forever ✓'
                : 'unlockable — creator can withdraw'}
            </b>
          </div>
          <div className="dr">
            <span>creator bags</span>
            <b>
              {reserveBpsOrRaw(record)} · {mode}
            </b>
          </div>
          <div className="dr">
            <span>side pool</span>
            <b>{sideLabel}</b>
          </div>
          <div className="dr">
            <span>mcap now</span>
            <b className="mono">
              {spot ? formatMcapUsd(spot.mcapNow) : '—'}
            </b>
          </div>
          <div className="dr">
            <span>volume</span>
            <b>{volumeLabel ?? '—'}</b>
          </div>
          <div className="dr">
            <span>last trade</span>
            <b>{lastTradeLabel ?? '—'}</b>
          </div>
          <div className="dr">
            <span>stamped $rate</span>
            <b>
              {!ethUsdResolved
                ? '…'
                : v2Usd && ethUsdWad != null
                  ? formatStampedEthUsdLine(ethUsdWad)
                  : 'no stamp (v1 / unread)'}
            </b>
          </div>
          {spot && spot.activePool === 'main' && spot.liveEthUsd != null && (
            <div className="dr">
              <span>spot @ live rate</span>
              <b>
                {formatUsdSpot(spot.usdPerToken)} ($
                {spot.liveEthUsd.toFixed(0)}/ETH)
              </b>
            </div>
          )}
          {v2Usd && ethUsdWad != null && spot && spot.activePool === 'side' && (
            <div className="dr">
              <span>filing stamp</span>
              <b>
                ${formatEthUsdRate(ethUsdWad)}/ETH (history — spot via USDG)
              </b>
            </div>
          )}
          <div className="dr">
            <span>launch block</span>
            <b>
              {record.notYetIndexed ? 'not indexed yet' : record.blockNumber}
            </b>
          </div>
          <div className="dr">
            <span>creator</span>
            <b>
              <a
                href={explorer(`address/${record.creator}`)}
                target="_blank"
                rel="noreferrer"
              >
                {short(record.creator)}
              </a>
            </b>
          </div>
        </div>
      </div>

      <div className="win" style={{ marginTop: 12 }}>
        <div className="title">💰 do trade</div>
        <TradePanel
          listing={record}
          spotEthPerToken={spot?.ethPerToken ?? null}
          liveEthUsd={spot?.liveEthUsd ?? null}
          onTraded={() => {
            void refresh()
          }}
        />
        <div className="body95" style={{ paddingTop: 0 }}>
          <div className="btn-row">
            <a
              className="btn95"
              href={explorer(`address/${record.token}`)}
              target="_blank"
              rel="noreferrer"
            >
              token on explorer
            </a>
            <a
              className="btn95"
              href={explorer(`address/${record.listing}`)}
              target="_blank"
              rel="noreferrer"
            >
              listing on explorer
            </a>
            {sideDexUrl && record.createSidePool && (
              <a
                className="btn95"
                href={sideDexUrl}
                target="_blank"
                rel="noreferrer"
              >
                side pool · dexscreener
              </a>
            )}
          </div>
        </div>
      </div>

      {typeof holderBal === 'bigint' && holderBal > 0n && (
        <div className="win" style={{ marginTop: 12 }}>
          <div className="title">📸 your bag flex</div>
          <div className="body95">
            <FlexCard
              symbol={record.symbol}
              deltaPct={flexDelta}
              valueUsd={
                spot
                  ? Number(formatEther(holderBal)) * spot.usdPerToken
                  : null
              }
              coins={Number(formatEther(holderBal))}
              subtitle={flexSubtitle}
            />
          </div>
        </div>
      )}

      <div className="btn-row" style={{ marginTop: 10 }}>
        <button type="button" className="btn95" onClick={() => void refresh()}>
          refresh mutable
        </button>
      </div>
      {err && <p className="check bad">{err}</p>}
    </Win95Window>
  )
}
