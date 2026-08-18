/** Chart / sparkline SVG — file styling (green stroke, dashed floor). */

const GREEN = '#1DB954'

export function ZigChart({
  series,
  startUsd,
  height = 140,
}: {
  series: number[]
  startUsd: number
  height?: number
}) {
  const w = 320
  const p = 10
  if (series.length === 0) return null
  const mx = Math.max(...series, startUsd > 0 ? startUsd : series[0]!)
  const mn = Math.min(...series, startUsd > 0 ? startUsd : series[0]!)
  const span = mx - mn || 1
  const pts = series.map((v, i) => {
    const x = (i / Math.max(1, series.length - 1)) * (w - 2 * p) + p
    const y = height - p - ((v - mn) / span) * (height - 2 * p)
    return { x, y }
  })
  const last = pts[pts.length - 1]!
  const floorY =
    startUsd > 0
      ? height - p - ((startUsd - mn) / span) * (height - 2 * p)
      : null
  const poly = pts.map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ')

  return (
    <svg
      className="zig"
      style={{ height }}
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      {floorY != null && (
        <line
          x1={p}
          x2={w - p}
          y1={floorY}
          y2={floorY}
          stroke="#999"
          strokeWidth={1.5}
          strokeDasharray="6 4"
        />
      )}
      {series.length === 1 ? (
        <circle
          cx={last.x}
          cy={last.y}
          r={8}
          fill={GREEN}
          stroke="#000"
          strokeWidth={2}
        />
      ) : (
        <>
          <polyline
            points={poly}
            stroke={GREEN}
            strokeWidth={7}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={`M${last.x - 16} ${last.y - 2} L${last.x + 2} ${last.y} L${last.x - 3} ${last.y + 15}`}
            stroke={GREEN}
            strokeWidth={7}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </svg>
  )
}

export function Sparkline({ series }: { series: number[] }) {
  const w = 70
  const h = 26
  const s = series.slice(-24)
  if (s.length === 0) {
    return <div className="spark" aria-hidden />
  }
  if (s.length === 1) {
    const y = h / 2
    return (
      <svg
        className="spark"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        <circle cx={w - 6} cy={y} r={3} fill={GREEN} />
      </svg>
    )
  }
  const mx = Math.max(...s)
  const mn = Math.min(...s)
  const span = mx - mn || 1
  const pts = s.map((v, i) => {
    const x = (i / Math.max(1, s.length - 1)) * (w - 4) + 2
    const y = h - 3 - ((v - mn) / span) * (h - 6)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return (
    <svg
      className="spark"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <polyline
        points={pts.join(' ')}
        stroke={GREEN}
        strokeWidth={2.5}
        fill="none"
      />
    </svg>
  )
}
