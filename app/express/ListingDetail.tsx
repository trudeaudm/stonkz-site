import { useCallback, useEffect, useState } from 'react'
import { formatEther, getAddress, type Address } from 'viem'
import { useBlock, usePublicClient } from 'wagmi'
import { env } from '../config/env'
import { refreshMutable, vestedAvailable } from '../indexer/hydrate'
import { loadEnvelope, saveEnvelope } from '../indexer/storage'
import type { IndexedListing } from '../indexer/types'

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function explorer(path: string) {
  return `${env.explorerUrl.replace(/\/$/, '')}/${path}`
}

function tierLabel(startMcap: string): string {
  const v = BigInt(startMcap)
  if (v === 4000n * 10n ** 18n) return '$4,000 (at launch)'
  if (v === 8000n * 10n ** 18n) return '$8,000 (at launch)'
  return `${formatEther(v)} (at launch)`
}

export function ListingDetail({
  listing,
  onBack,
}: {
  listing: Address
  onBack: () => void
}) {
  const client = usePublicClient()
  const factory = env.addrExpressFactory
  const [record, setRecord] = useState<IndexedListing | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const block = useBlock({ watch: true })

  useEffect(() => {
    if (!factory) return
    const envl = loadEnvelope(env.chainId, factory)
    const found = envl?.listings.find(
      (L) => L.listing.toLowerCase() === listing.toLowerCase(),
    )
    setRecord(found ?? null)
    if (!found) setErr('listing not in local index — scan listings first')
  }, [factory, listing])

  const refresh = useCallback(async () => {
    if (!client || !factory || !record) return
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
    const envl = loadEnvelope(env.chainId, factory)
    if (envl) {
      envl.listings = envl.listings.map((L) =>
        L.listing.toLowerCase() === next.listing.toLowerCase() ? next : L,
      )
      envl.updatedAt = Date.now()
      saveEnvelope(envl)
    }
  }, [client, factory, record])

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh on open only
  }, [listing])

  if (!record) {
    return (
      <div className="win">
        <div className="tb">stonkz_detail.exe</div>
        <div className="body95">
          <p className="check bad">{err ?? 'loading…'}</p>
          <button type="button" className="btn95" onClick={onBack}>
            back
          </button>
        </div>
      </div>
    )
  }

  const now = block.data?.timestamp ?? BigInt(Math.floor(Date.now() / 1000))
  const vest = vestedAvailable(record.creatorReserveState, now)
  const mode =
    !record.creatorReserveState.filed || BigInt(record.creatorReserve) === 0n
      ? 'none'
      : record.creatorReserveState.mode === 0
        ? 'INSTANT (10-min timelock)'
        : `VEST (${record.creatorReserveState.vestDuration}s)`

  const mk = record.mainPoolKey

  return (
    <div className="win receipt">
      <div className="tb">stonkz_detail.exe</div>
      <div className="body95">
        <p className="eyebrow">
          {record.symbol} — {record.name}
        </p>
        <p>
          token{' '}
          <a href={explorer(`address/${record.token}`)} target="_blank" rel="noreferrer">
            {record.token}
          </a>
        </p>
        <p>
          listing{' '}
          <a href={explorer(`address/${record.listing}`)} target="_blank" rel="noreferrer">
            {record.listing}
          </a>
        </p>
        <p>
          creator{' '}
          <a href={explorer(`address/${record.creator}`)} target="_blank" rel="noreferrer">
            {short(record.creator)}
          </a>
        </p>
        <div className="rule" />
        <p>start mcap {tierLabel(record.startMcap)}</p>
        <p>start price {record.startPriceWad} wad (at launch)</p>
        <p>total supply {record.totalSupply} raw</p>
        <div className="rule" />
        <p>
          creator reserve {record.creatorReserve} raw · delivery {mode}
        </p>
        {record.creatorReserveState.filed && BigInt(record.creatorReserve) > 0n && (
          <>
            <p className="hint">
              claimed {record.creatorReserveState.claimed} / vested{' '}
              {vest.vested.toString()} / unvested {vest.unvested.toString()} /
              claimable now {vest.claimable.toString()}
            </p>
            {record.creatorReserveState.mode === 0 && (
              <p className="hint">
                unlockedAt {record.creatorReserveState.unlockedAt} (unix) — 10-min
                INSTANT timelock
              </p>
            )}
          </>
        )}
        <p>
          side pool{' '}
          {!record.createSidePool
            ? 'off'
            : record.sidePoolDeployed
              ? `deployed (${record.sidePoolBps} bps)`
              : `pending (${record.sidePoolBps} bps) — deploySidePool is permissionless`}
        </p>
        <p>
          liquidity{' '}
          {record.liquidityLocked
            ? 'locked forever'
            : 'unlockable — creator may withdraw principal'}
        </p>
        <div className="rule" />
        <p className="hint">main pool key (at launch)</p>
        <p>
          pair {short(mk.currency0)} / {short(mk.currency1)} · fee {mk.fee} pips ·
          spacing {mk.tickSpacing}
        </p>
        <p>
          hook{' '}
          <a href={explorer(`address/${mk.hooks}`)} target="_blank" rel="noreferrer">
            {mk.hooks}
          </a>
        </p>
        <p className="hint">launch block {record.blockNumber}</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button type="button" className="btn95" onClick={onBack}>
            back
          </button>
          <button type="button" className="btn95" onClick={() => void refresh()}>
            refresh mutable
          </button>
        </div>
        {err && <p className="check bad">{err}</p>}
      </div>
    </div>
  )
}
