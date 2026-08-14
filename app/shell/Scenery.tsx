/** Floating sky scenery — bobbing arrow + head; respects reduced motion. */
export function Scenery() {
  return (
    <div className="scenery" aria-hidden="true">
      <svg className="bigarrow bob" viewBox="0 0 300 220" fill="none">
        <path
          d="M10 200 L70 160 L110 180 L180 110 L215 130 L275 45"
          stroke="#FF8A3C"
          strokeWidth="26"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M225 38 L282 40 L278 96"
          stroke="#FF8A3C"
          strokeWidth="26"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
      <svg className="head bob2" viewBox="0 0 200 240" fill="none">
        <ellipse cx="100" cy="110" rx="78" ry="92" fill="#E8E3DC" />
        <ellipse cx="100" cy="118" rx="78" ry="86" fill="#DDD6CC" />
        <ellipse cx="72" cy="96" rx="10" ry="13" fill="#2E4A9E" />
        <ellipse cx="128" cy="96" rx="10" ry="13" fill="#2E4A9E" />
        <ellipse cx="74" cy="93" rx="3.5" ry="4.5" fill="#fff" />
        <ellipse cx="130" cy="93" rx="3.5" ry="4.5" fill="#fff" />
        <path
          d="M70 150 Q100 172 130 150"
          stroke="#8F867A"
          strokeWidth="6"
          strokeLinecap="round"
          fill="none"
        />
        <path d="M40 210 L100 190 L160 210 L160 240 L40 240 Z" fill="#1B1F2E" />
        <rect x="92" y="192" width="16" height="30" fill="#fff" />
        <path d="M100 196 L92 210 L100 224 L108 210 Z" fill="#B3261E" />
      </svg>
    </div>
  )
}
