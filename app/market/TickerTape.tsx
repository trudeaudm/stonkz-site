import { useMemo } from 'react'
import { useIndex } from '../shell/IndexProvider'

function tierLabel(startMcap: string): string {
  try {
    const v = BigInt(startMcap)
    if (v === 4000n * 10n ** 18n) return '$4K'
    if (v === 8000n * 10n ** 18n) return '$8K'
  } catch {
    /* ignore */
  }
  return 'custom tier'
}

export function TickerTape() {
  const { listings, progress } = useIndex()

  const items = useMemo(() => {
    const status: { text: string; up?: boolean }[] = [
      { text: 'gate: closed — soft launch' },
      { text: `head: ${progress?.head?.toString() ?? '…'}` },
      { text: `launches indexed: ${listings.length}`, up: listings.length > 0 },
    ]
    if (progress?.status === 'scanning') {
      status.push({
        text: `scan: ${progress.percent.toFixed(1)}% · block ${progress.cursor.toString()}`,
      })
    }
    const ticks = listings.map((L) => ({
      text: L.hydrateError
        ? `unreadable · block ${L.blockNumber}`
        : `$${L.symbol} · ${tierLabel(L.startMcap)} tier · block ${L.blockNumber}`,
      up: true as const,
    }))
    const out: { text: string; up?: boolean }[] = []
    const max = Math.max(status.length, ticks.length, 1)
    for (let i = 0; i < max; i++) {
      if (status[i % status.length]) out.push(status[i % status.length])
      if (ticks[i]) out.push(ticks[i])
    }
    return [...out, ...out]
  }, [listings, progress])

  return (
    <div className="tape" aria-label="market ticker">
      <div className="tape-track">
        {items.map((t, i) => (
          <span
            key={`${t.text}-${i}`}
            className={`tape-item${t.up ? ' up' : ''}`}
          >
            {t.text}
          </span>
        ))}
      </div>
    </div>
  )
}
