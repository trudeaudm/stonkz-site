import { useMemo } from 'react'
import { useIndex } from '../shell/IndexProvider'

function tierLabel(startMcap: string): string {
  const v = BigInt(startMcap)
  if (v === 4000n * 10n ** 18n) return '$4K'
  if (v === 8000n * 10n ** 18n) return '$8K'
  return 'custom tier'
}

export function TickerTape() {
  const { listings, progress } = useIndex()

  const items = useMemo(() => {
    const status: string[] = [
      'gate: closed — soft launch',
      `head: ${progress?.head?.toString() ?? '…'}`,
      `launches indexed: ${listings.length}`,
    ]
    if (progress?.status === 'scanning') {
      status.push(
        `scan: ${progress.percent.toFixed(1)}% · block ${progress.cursor.toString()}`,
      )
    }
    const ticks = listings.map(
      (L) =>
        `$${L.symbol} · ${tierLabel(L.startMcap)} tier · block ${L.blockNumber}`,
    )
    // Interleave: status, tick, status, tick…
    const out: string[] = []
    const max = Math.max(status.length, ticks.length, 1)
    for (let i = 0; i < max; i++) {
      if (status[i % status.length]) out.push(status[i % status.length])
      if (ticks[i]) out.push(ticks[i])
    }
    // Duplicate for seamless marquee
    return [...out, ...out]
  }, [listings, progress])

  return (
    <div className="tape crt-tape" aria-label="market ticker">
      <div className="tape-track">
        {items.map((t, i) => (
          <span key={`${t}-${i}`} className="tape-item">
            {t}
          </span>
        ))}
      </div>
    </div>
  )
}
