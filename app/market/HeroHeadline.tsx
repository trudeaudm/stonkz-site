export function HeroHeadline() {
  return (
    <div
      className="caption hero-caption"
      style={{
        fontSize: 'clamp(18px, 3.4vw, 28px)',
        textAlign: 'left',
        margin: '2px 0 12px',
      }}
    >
      EVRYTHING GETS A TICKER. THE LINE ONLY GO UP.*
      <br />
      <span
        className="hero-footnote"
        style={{ fontSize: 12, WebkitTextStroke: '.8px #000' }}
      >
        *line may also go down. this is the market. kalm.
      </span>
    </div>
  )
}
