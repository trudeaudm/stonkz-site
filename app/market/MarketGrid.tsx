import { getAddress, type Address } from 'viem'
import type { IndexedListing } from '../indexer/types'
import { Stamp } from '../shell/Stamp'
import { StaticWin } from '../shell/StaticWin'
import { useIndex } from '../shell/IndexProvider'

function tierLabel(startMcap: string): string {
  const v = BigInt(startMcap)
  if (v === 4000n * 10n ** 18n) return '$4K'
  if (v === 8000n * 10n ** 18n) return '$8K'
  return 'custom'
}

export function TokenCard({
  listing,
  onOpen,
}: {
  listing: IndexedListing
  onOpen: (listing: Address) => void
}) {
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
            <Stamp variant={listing.liquidityLocked ? 'stonkz' : 'not'}>
              {listing.liquidityLocked ? 'locked forever' : 'unlockable'}
            </Stamp>
          </div>
          <div className="nm">{listing.name}</div>
        </div>
      </div>
      <div className="drs">
        <div className="dr">
          <span>tier</span>
          <b>{tierLabel(listing.startMcap)}</b>
        </div>
        <div className="dr">
          <span>lock</span>
          <b>{listing.liquidityLocked ? 'forever' : 'unlockable'}</b>
        </div>
        <div className="dr">
          <span>side</span>
          <b>
            {listing.createSidePool
              ? listing.sidePoolDeployed
                ? `${listing.sidePoolBps}bps live`
                : `${listing.sidePoolBps}bps pending`
              : 'none'}
          </b>
        </div>
        <div className="dr">
          <span>block</span>
          <b>{listing.blockNumber}</b>
        </div>
      </div>
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
        <div className="caption section-caption">— ON THE MARKET —</div>
      )}
      <div className="grid">
        {rows.map((L) => (
          <TokenCard key={L.listing} listing={L} onOpen={onOpen} />
        ))}
        {showEmpty && (
          <StaticWin title="the_market.exe" className="token-card empty-card">
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
