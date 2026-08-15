import { useEffect, useMemo, useState } from 'react'
import { formatEther, type Address } from 'viem'
import { useAccount, usePublicClient } from 'wagmi'
import { launchTokenAbi } from '../abi/launchToken'
import type { IndexedListing } from '../indexer/types'
import {
  formatDeltaPct,
  formatUsdSpot,
} from '../prices/spotMath'
import { useMainPoolSpot } from '../prices/useMainPoolSpot'
import { useIndex } from './IndexProvider'
import { Stamp } from './Stamp'
import { Win95Window } from './Window'

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
      width={720}
      onClose={onClose}
    >
      <div className="me-page">
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
            {/* League + flex_card deferred — layout spacer matches dummy grid. */}
            <div className="win" style={{ minHeight: 120 }}>
              <div className="body95 hint">
                underwriters league + flex cards — not built yet. bags live on
                the left.
              </div>
            </div>
          </div>
        </div>
      </div>
    </Win95Window>
  )
}
