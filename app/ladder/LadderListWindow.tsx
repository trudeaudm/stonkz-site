import { getAddress, type Address } from 'viem'
import { deriveLadderStatus, type IndexedAuction } from '../indexer/ladderTypes'
import { HelthBar } from '../shell/HelthBar'
import { Stamp } from '../shell/Stamp'
import { StaticWin } from '../shell/StaticWin'
import { useLadderIndex } from '../shell/LadderIndexProvider'
import { Win95Window } from '../shell/Window'
import { useNowSeconds, usePairSymbol } from './ladderHooks'
import {
  LADDER_STATUS_LABEL,
  LADDER_STATUS_LONG,
  LADDER_STATUS_STAMP,
  formatClock,
  formatPairWad,
  formatPct,
  formatPriceWad,
  pairLabel,
  ratioOf,
} from './ladderFormat'

/** live first, then books that have not started, then everything finished. */
const RANK: Record<string, number> = {
  live: 0,
  filed: 1,
  ended_pending_settle: 2,
  graduated: 3,
  failed: 4,
}

function AuctionCard({
  auction,
  nowSec,
  onOpen,
}: {
  auction: IndexedAuction
  nowSec: number
  onOpen: (auction: Address) => void
}) {
  const pairSymbol = usePairSymbol(auction.pairToken)

  if (auction.hydrateError) {
    return (
      <StaticWin
        title="📁 unreadable.exe — filed but broken"
        className="token-card"
      >
        <p className="check bad">
          AuctionFiled indexed but the getters would not answer —{' '}
          {auction.hydrateError}
        </p>
        <p className="hint">
          auction {auction.auction.slice(0, 10)}… · block {auction.blockNumber}
        </p>
      </StaticWin>
    )
  }

  const status = deriveLadderStatus(auction.state)
  const raiseFrac = ratioOf(auction.state.raised, auction.threshold)
  const unit = pairLabel(auction, pairSymbol)
  // See the detail window: committed budget is not yet `raised`, and the gate reads `raised`. A card at 0%
  // with real money in the book reads as broken, so surface the queued amount here too.
  const queuedWad = (() => {
    const committed = BigInt(auction.state.committedTotal)
    const raised = BigInt(auction.state.raised)
    return committed > raised ? committed - raised : 0n
  })()

  return (
    <StaticWin
      title={`🪜 ${auction.symbol.toLowerCase()}.ipo — ${LADDER_STATUS_LABEL[status].toLowerCase()}`}
      className="token-card"
    >
      <div className="coinrow">
        <div className="coinic">
          {auction.symbol.slice(0, 1).toUpperCase() || '?'}
        </div>
        <div className="grow">
          <div className="tk">
            ${auction.symbol}{' '}
            <Stamp variant={LADDER_STATUS_STAMP[status]}>
              {LADDER_STATUS_LABEL[status]}
            </Stamp>
          </div>
          <div className="nm">{auction.name}</div>
        </div>
        <div>
          <div className="px">{formatPriceWad(auction.state.price)}</div>
          <div className="nm" style={{ textAlign: 'right' }}>
            {unit}/token
          </div>
        </div>
      </div>

      <HelthBar
        ratio={raiseFrac}
        labelLeft={`RAISED ${formatPairWad(auction.state.raised)} ${unit}`}
        labelRight={`GATE ${formatPairWad(auction.threshold)} · ${formatPct(raiseFrac)}`}
      />

      <div className="mono" style={{ fontSize: 11 }}>
        {LADDER_STATUS_LONG[status]} · {formatClock(auction, nowSec)} · period{' '}
        {auction.state.periodIndex}/{auction.n || 1000}
      </div>

      {queuedWad > 0n && (
        <div className="mono" style={{ fontSize: 11 }}>
          + {formatPairWad(queuedWad.toString())} {unit} committed, not yet converted
        </div>
      )}

      <button
        type="button"
        className="btn95"
        style={{ marginTop: 10 }}
        onClick={() => onOpen(getAddress(auction.auction))}
      >
        open the book
      </button>
    </StaticWin>
  )
}

export function LadderListWindow({
  onOpen,
  onClose,
}: {
  onOpen: (auction: Address) => void
  onClose: () => void
}) {
  const { auctions, progress, error, factoryMissing } = useLadderIndex()
  const anyLive = auctions.some((A) => !A.state.done)
  const nowSec = useNowSeconds(anyLive)

  const rows = [...auctions].sort((a, b) => {
    const ra = RANK[deriveLadderStatus(a.state)] ?? 9
    const rb = RANK[deriveLadderStatus(b.state)] ?? 9
    if (ra !== rb) return ra - rb
    const d = BigInt(b.blockNumber) - BigInt(a.blockNumber)
    return d === 0n ? b.logIndex - a.logIndex : d > 0n ? 1 : -1
  })

  return (
    <Win95Window
      id="ladder_list"
      title="🪜 ipo_desk.exe — bookbuild auctions"
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

      <p className="hint" style={{ textAlign: 'left' }}>
        a ladder auction does not have a price. it has a ladder. you post a
        budget and a ceiling, the book walks up its rungs one period at a time,
        and whatever your budget converted into at those prices is what you own.
        it graduates only if the raise clears the gate.
      </p>

      {factoryMissing ? (
        <div className="win" style={{ marginTop: 8 }}>
          <div className="title red">⚠ no factory</div>
          <div className="body95">
            <p className="check bad">
              VITE_ADDR_LADDER_FACTORY is not set in this build.
            </p>
            <p className="hint" style={{ textAlign: 'left' }}>
              nothing to read, so nothing is shown. this is not an outage — the
              ipo desk simply has no address to point at yet. it lights up on
              the next deploy.
            </p>
          </div>
        </div>
      ) : (
        <>
          {error && (
            <p className="check bad">ladder scan failed — {error}</p>
          )}
          {progress?.status === 'scanning' && (
            <p className="hint">
              scanning for filed books · block {progress.cursor.toString()} /{' '}
              {progress.head.toString()} ({progress.percent.toFixed(1)}%)
            </p>
          )}

          <div className="grid" style={{ marginTop: 8 }}>
            {rows.map((A) => (
              <AuctionCard
                key={A.auction}
                auction={A}
                nowSec={nowSec}
                onOpen={onOpen}
              />
            ))}
            {rows.length === 0 && progress?.status !== 'scanning' && (
              <StaticWin title="ipo_desk.exe" className="token-card empty-card">
                <p>
                  no books on the desk. nobody has filed one yet, so there is
                  nothing to bid into — which is exactly what an empty order
                  book looks like, fren.
                </p>
              </StaticWin>
            )}
          </div>

          <p className="hint" style={{ textAlign: 'left' }}>
            filing a ladder auction is invite-only for now — the factory only
            takes an allowlisted deployer. you can bid into any book you see
            here.
          </p>
        </>
      )}
    </Win95Window>
  )
}
