import { formatUsdSpot } from '../prices/spotMath'

const FcArrow = (
  <svg
    className="fc-arrow"
    viewBox="0 0 300 220"
    fill="none"
    aria-hidden
  >
    <path
      d="M10 200 L110 180 L180 110 L275 45"
      stroke="#FF8A3C"
      strokeWidth="24"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M225 38 L282 40 L278 96"
      stroke="#FF8A3C"
      strokeWidth="24"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

function formatFlexDelta(deltaPct: number | null): string {
  if (deltaPct == null || !Number.isFinite(deltaPct)) return '—'
  const abs = Math.abs(deltaPct)
  const body = abs >= 10 ? abs.toFixed(0) : abs.toFixed(1)
  return `${deltaPct >= 0 ? '+' : '−'}${body}%`
}

export function FlexCard({
  symbol,
  deltaPct,
  valueUsd,
  coins,
  subtitle,
}: {
  symbol: string
  deltaPct: number | null
  valueUsd: number | null
  coins: number
  /** Optional got-at line; omit when cost basis unknown. */
  subtitle?: string
}) {
  const coinsLabel = coins.toLocaleString(undefined, {
    maximumFractionDigits: 4,
  })
  const valueLabel =
    valueUsd != null ? formatUsdSpot(valueUsd) : '—'

  // Honest: no invented cost basis. Subtitle = got-at when known;
  // otherwise value @ spot + Δ vs start (delta lives in fc-big).
  const line1 = subtitle?.trim()
    ? subtitle
    : `value @ spot ${valueLabel} · ${coinsLabel} coins · Δ vs start`

  return (
    <div className="flexcard">
      <div className="impact" style={{ fontSize: 18 }}>
        ${symbol} — BAG FLEX
      </div>
      <div className="fc-big">{formatFlexDelta(deltaPct)}</div>
      <div className="fc-s">
        {line1}
        <br />
        @you · certified fren · stonkz.green
      </div>
      {FcArrow}
    </div>
  )
}
