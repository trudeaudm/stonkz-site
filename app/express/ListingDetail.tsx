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
import { loadEnvelope, saveEnvelope } from '../indexer/storage'
import type { IndexedListing } from '../indexer/types'
import {
  formatEthUsdRate,
  formatStampedEthUsdLine,
  isV2UsdStamp,
} from './listingDisplay'
import { formatDeltaPct, formatUsdSpot } from '../prices/spotMath'
import { useMainPoolSpot } from '../prices/useMainPoolSpot'

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function explorer(path: string) {
  return `${env.explorerUrl.replace(/\/$/, '')}/${path}`
}

/** Optional Dexscreener base — never invent a chain-specific URL. */
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

  // Hooks before any early return — spot must stay ordered.
  const spot = useMainPoolSpot(record, Boolean(record) && !loading && !err)

  const { data: holderBal } = useReadContract({
    address: record?.token,
    abi: launchTokenAbi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: Boolean(record?.token && address),
    },
  })

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
  const dexUrl = dexscreenerTokenUrl(record.token)
  const sideLabel = !record.createSidePool
    ? 'off'
    : record.sidePoolDeployed
      ? `${record.sidePoolBps} bps · deployed`
      : `${record.sidePoolBps} bps · pending`

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
          spot wakes when the main pool answers.
        </div>
      )}

      {record.notYetIndexed && (
        <p className="hint">not yet indexed — reading directly from chain</p>
      )}

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
            <span>stamped $rate</span>
            <b>
              {!ethUsdResolved
                ? '…'
                : v2Usd && ethUsdWad != null
                  ? formatStampedEthUsdLine(ethUsdWad)
                  : 'no stamp (v1 / unread)'}
            </b>
          </div>
          {v2Usd && ethUsdWad != null && spot && (
            <div className="dr">
              <span>spot @ stamp</span>
              <b>
                {formatUsdSpot(spot.usdPerToken)} ($
                {formatEthUsdRate(ethUsdWad)}/ETH)
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
        <div className="body95">
          <p className="nm" style={{ margin: '0 0 8px' }}>
            trading happens on the dex for now. soon(tm).
          </p>
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
            {dexUrl && (
              <a
                className="btn95"
                href={dexUrl}
                target="_blank"
                rel="noreferrer"
              >
                dexscreener
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
              deltaPct={spot?.deltaPct ?? null}
              valueUsd={
                spot
                  ? Number(formatEther(holderBal)) * spot.usdPerToken
                  : null
              }
              coins={Number(formatEther(holderBal))}
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
