/**
 * LadderGrid — auction period/tranche visual in the defrag/minesweeper family.
 * Renders when a real auction exists; data from auction path views or
 * indexed PeriodCleared.
 *
 * NOT mounted anywhere yet — no demo with invented fills.
 */

export type LadderPeriodCell = {
  period: number
  offered: bigint | number
  sold: bigint | number
  price: bigint | number
}

export type LadderCellState =
  | 'sold'
  | 'offered'
  | 'idle'
  | 'future'
  | 'current'

function cellState(
  cell: LadderPeriodCell,
  currentPeriod: number | undefined,
): LadderCellState {
  if (currentPeriod !== undefined && cell.period === currentPeriod) {
    return 'current'
  }
  const offered = BigInt(cell.offered)
  const sold = BigInt(cell.sold)
  if (offered === 0n && sold === 0n) return 'future'
  if (sold > 0n && sold >= offered) return 'sold'
  if (offered > 0n && sold === 0n) return 'offered'
  if (sold > 0n && sold < offered) return 'sold'
  return 'idle'
}

function soldShade(fillPct: number): string {
  // slight variance by fill ratio within #1DB954 family
  if (fillPct >= 90) return '#17A047'
  if (fillPct >= 60) return '#1DB954'
  if (fillPct >= 30) return '#22C55E'
  return '#2DD46A'
}

export function LadderGrid({
  periods,
  currentPeriod,
}: {
  periods: LadderPeriodCell[]
  currentPeriod?: number
}) {
  const sorted = [...periods].sort((a, b) => a.period - b.period)
  const n = sorted.length
  const narrow =
    typeof window !== 'undefined' &&
    window.matchMedia('(max-width: 839px)').matches
  // 1000 periods at ≥840px = 50×20 of ~10px; narrow = 40×25 of ~7px
  const cols = narrow ? 40 : n >= 1000 ? 50 : Math.max(10, Math.ceil(Math.sqrt(n)))
  const cellPx = narrow ? 7 : 10
  const rows = Math.max(1, Math.ceil(n / cols))

  return (
    <div
      className="ladder-grid zig"
      style={{
        gridTemplateColumns: `repeat(${cols}, ${cellPx}px)`,
        gridTemplateRows: `repeat(${rows}, ${cellPx}px)`,
      }}
      role="img"
      aria-label="ladder auction period grid"
    >
      {sorted.map((cell, i) => {
        const st = cellState(cell, currentPeriod)
        const offered = BigInt(cell.offered)
        const sold = BigInt(cell.sold)
        const fill =
          offered > 0n ? Number((sold * 100n) / offered) : 0
        const col = (i % cols) + 1
        // fill left→right, bottom→top
        const row = rows - Math.floor(i / cols)
        return (
          <div
            key={cell.period}
            className={`ladder-cell st-${st}`}
            style={{
              width: cellPx,
              height: cellPx,
              gridColumn: col,
              gridRow: row,
              ...(st === 'sold' || (st === 'current' && sold > 0n)
                ? { background: soldShade(fill) }
                : null),
            }}
            title={`period ${cell.period} · price ${cell.price.toString()} · sold ${sold.toString()}/${offered.toString()}`}
          />
        )
      })}
    </div>
  )
}
