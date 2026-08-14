import { useMemo, useState } from 'react'
import { formatEther, getAddress, type Address } from 'viem'
import { useIndex } from '../shell/IndexProvider'
import { Win95Window } from '../shell/Window'

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function tierLabel(startMcap: string): string {
  const v = BigInt(startMcap)
  if (v === 4000n * 10n ** 18n) return '$4K'
  if (v === 8000n * 10n ** 18n) return '$8K'
  return `${formatEther(v)} mcap`
}

export function MarketWindow({
  onOpen,
  onClose,
}: {
  onOpen: (listing: Address) => void
  onClose?: () => void
}) {
  const { listings, progress, error, factoryMissing } = useIndex()
  const [view, setView] = useState<'list' | 'icons'>('list')

  const rows = useMemo(
    () =>
      [...listings].sort((a, b) => {
        const d = BigInt(b.blockNumber) - BigInt(a.blockNumber)
        return d === 0n ? b.logIndex - a.logIndex : d > 0n ? 1 : -1
      }),
    [listings],
  )

  return (
    <Win95Window
      id="the_market"
      title="the_market.exe"
      width={720}
      onClose={onClose}
    >
      <div className="market-toolbar">
        <button type="button" className="xbtn" onClick={() => setView('list')}>
          ≡
        </button>
        <button type="button" className="xbtn" onClick={() => setView('icons')}>
          ▦
        </button>
      </div>
      {progress && (
        <p className="status">
          {progress.status === 'scanning'
            ? `scanning block ${progress.cursor.toString()} of ${progress.head.toString()} (${progress.percent.toFixed(1)}%, chunk ${progress.chunkSize})`
            : progress.message}
        </p>
      )}
      {error && <p className="check bad">{error}</p>}
      {factoryMissing && (
        <p className="check bad">VITE_ADDR_EXPRESS_FACTORY unset</p>
      )}

      {progress?.status === 'done' && rows.length === 0 && (
        <div className="empty-market">
          <p>no launches yet.</p>
          <p className="hint">the gate is closed — soft launch.</p>
        </div>
      )}

      {view === 'list' ? (
        <table className="file-table">
          <thead>
            <tr>
              <th>token</th>
              <th>creator</th>
              <th>tier</th>
              <th>lock</th>
              <th>side</th>
              <th>block</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((L) => (
              <tr
                key={L.listing}
                onClick={() => onOpen(getAddress(L.listing))}
              >
                <td>
                  {L.symbol} <span className="hint">{L.name}</span>
                </td>
                <td>{short(L.creator)}</td>
                <td>
                  <span className="badge">{tierLabel(L.startMcap)}</span>
                </td>
                <td>
                  <span className="badge">
                    {L.liquidityLocked ? 'locked forever' : 'unlockable'}
                  </span>
                </td>
                <td>
                  <span className="badge">
                    {L.createSidePool
                      ? L.sidePoolDeployed
                        ? `side ${L.sidePoolBps}bps`
                        : `side pending ${L.sidePoolBps}bps`
                      : 'no side'}
                  </span>
                </td>
                <td>{L.blockNumber}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="icon-grid">
          {rows.map((L) => (
            <button
              key={L.listing}
              type="button"
              className="icon-tile"
              onClick={() => onOpen(getAddress(L.listing))}
            >
              <div className="icon-face">{L.symbol.slice(0, 4)}</div>
              <div>{L.symbol}</div>
              <div className="hint">{tierLabel(L.startMcap)}</div>
            </button>
          ))}
        </div>
      )}
    </Win95Window>
  )
}
