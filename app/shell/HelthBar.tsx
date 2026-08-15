/** Striped HELTH bar — only for real ratios from chain state. */
export function HelthBar({
  ratio,
  labelLeft,
  labelRight,
}: {
  ratio: number
  labelLeft: string
  labelRight: string
}) {
  const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)))
  return (
    <div className="helth-wrap">
      <div className="helth">
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="helthlab">
        <span>{labelLeft}</span>
        <span>{labelRight}</span>
      </div>
    </div>
  )
}
