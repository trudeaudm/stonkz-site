import { useRef } from 'react'

export function DeskIcon({
  label,
  glyph,
  onOpen,
}: {
  label: string
  glyph: string
  onOpen: () => void
}) {
  const last = useRef(0)

  const activate = () => {
    const now = Date.now()
    // Desktop: double-click. Narrow / touch: single tap opens.
    const narrow =
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 840px), (pointer: coarse)').matches
    if (narrow) {
      onOpen()
      return
    }
    if (now - last.current < 450) {
      onOpen()
      last.current = 0
    } else {
      last.current = now
    }
  }

  return (
    <button type="button" className="deskicon" onClick={activate} title={label}>
      <div className="ig">{glyph}</div>
      <div className="il">{label}</div>
    </button>
  )
}
