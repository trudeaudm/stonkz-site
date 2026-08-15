import { getAddress, type Address } from 'viem'
import type { IndexedListing } from '../indexer/types'
import { Sparkline } from '../prices/ChartSvg'
import { formatUsdSpot } from '../prices/spotMath'
import {
  useListingSpot,
  usePriceSeries,
} from '../prices/useMainPoolSpot'
import { Stamp } from '../shell/Stamp'
import { StaticWin } from '../shell/StaticWin'
import { useIndex } from '../shell/IndexProvider'

function tierLabel(startMcap: string): string {
  try {
    const v = BigInt(startMcap)
    if (v === 4000n * 10n ** 18n) return '$4K'
    if (v === 8000n * 10n ** 18n) return '$8K'
  } catch {
    /* unreadable */
  }
  return 'custom'
}

function factsLine(listing: IndexedListing): string {
  const tier = tierLabel(listing.startMcap)
  const lock = listing.liquidityLocked ? 'lock forever' : 'lock unlockable'
  const side = listing.createSidePool
    ? `side ${listing.sidePoolBps}bps`
    : 'side none'
  return `tier ${tier} · ${lock} · ${side}`
}

export function TokenCard({
  listing,
  onOpen,
}: {
  listing: IndexedListing
  onOpen: (listing: Address) => void
}) {
  const spot = useListingSpot(listing, !listing.hydrateError)
  const series = usePriceSeries(listing, spot?.liveEthUsd ?? null)

  if (listing.hydrateError) {
    return (
      <StaticWin
        title="📁 unreadable.exe — indexed but broken"
        className="token-card"
      >
        <p className="check bad">
          indexed but unreadable — {listing.hydrateError}
        </p>
        <p className="hint">
          listing {listing.listing.slice(0, 10)}… · block {listing.blockNumber}
        </p>
        <button
          type="button"
          className="btn95"
          onClick={() => onOpen(getAddress(listing.listing))}
        >
          open
        </button>
      </StaticWin>
    )
  }

  const sym = listing.symbol
  const initial = sym.slice(0, 1).toUpperCase() || '?'
  const tier = tierLabel(listing.startMcap)

  return (
    <StaticWin
      title={`📁 ${sym.toLowerCase()}.exe — on the market`}
      className="token-card"
    >
      <div className="coinrow">
        <div className="coinic">{initial}</div>
        <div className="grow">
          <div className="tk">
            ${sym}{' '}
            {spot ? (
              <Stamp variant={spot.deltaPct >= 0 ? 'stonkz' : 'not'}>
                {spot.deltaPct >= 0 ? 'STONKZ' : 'NOT STONKZ'}
              </Stamp>
            ) : null}{' '}
            <Stamp variant="insta">⚡ INSTANT</Stamp>
          </div>
          <div className="nm">{factsLine(listing)}</div>
        </div>
        {series.length >= 2 ? (
          <Sparkline series={series} />
        ) : (
          <div
            className="spark"
            aria-hidden
            title="spark wakes when trades index"
          />
        )}
        {spot && (
          <div>
            <div className="px">{formatUsdSpot(spot.usdPerToken)}</div>
          </div>
        )}
      </div>
      <div className="mono" style={{ fontSize: 11, marginTop: 8 }}>
        {spot ? formatUsdSpot(spot.usdPerToken) : 'spot —'} · {tier} · block{' '}
        {listing.blockNumber}
      </div>
      <button
        type="button"
        className="btn95"
        style={{ marginTop: 10 }}
        onClick={() => onOpen(getAddress(listing.listing))}
      >
        open
      </button>
    </StaticWin>
  )
}

export function MarketGrid({
  onOpen,
  filterCreator,
  emptyCopy,
}: {
  onOpen: (listing: Address) => void
  filterCreator?: string
  emptyCopy?: string
}) {
  const { listings } = useIndex()

  const rows = [...listings]
    .filter((L) =>
      filterCreator
        ? L.creator.toLowerCase() === filterCreator.toLowerCase()
        : true,
    )
    .sort((a, b) => {
      const d = BigInt(b.blockNumber) - BigInt(a.blockNumber)
      return d === 0n ? b.logIndex - a.logIndex : d > 0n ? 1 : -1
    })

  const showEmpty = rows.length === 0

  return (
    <section className="market-section">
      {!filterCreator && (
        <div className="caption section-caption">— LISTED —</div>
      )}
      <div className="grid">
        {rows.map((L) => (
          <TokenCard key={L.listing} listing={L} onOpen={onOpen} />
        ))}
        {showEmpty && (
          <StaticWin title="listed.exe" className="token-card empty-card">
            <p>
              {emptyCopy ??
                'no launches yet. the gate is closed — soft launch.'}
            </p>
          </StaticWin>
        )}
      </div>
    </section>
  )
}
