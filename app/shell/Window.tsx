import { useRef, type ReactNode } from 'react'
import { useWindowManager, type WinId } from './windowManager'

/** PROGRAM window — pointer-drag (mouse+touch), iconizable, position-persisted. */
export function Win95Window({
  id,
  title,
  titleTone,
  children,
  onClose: _onClose,
  width,
}: {
  id: WinId
  title: string
  titleTone?: 'green' | 'amber' | 'red' | 'navy'
  children: ReactNode
  onClose?: () => void
  width?: number
}) {
  void _onClose
  const { windows, focus, iconize, move, savePos } = useWindowManager()
  const win = windows.find((w) => w.id === id)
  const drag = useRef<{
    pointerId: number
    ox: number
    oy: number
    sx: number
    sy: number
  } | null>(null)

  if (!win || win.iconized) return null

  const w = width ?? win.width
  const narrow =
    typeof window !== 'undefined' &&
    window.matchMedia('(max-width: 839px)').matches

  return (
    <div
      className={`win mw-win program-win${narrow ? ' narrow-sheet' : ''}`}
      style={
        narrow
          ? { zIndex: win.z, width: '100%' }
          : {
              zIndex: win.z,
              left: win.x,
              top: win.y,
              width: w,
            }
      }
      onPointerDown={() => focus(id)}
    >
      <div
        className={`title${titleTone && titleTone !== 'navy' ? ` ${titleTone}` : ''}`}
        style={narrow ? undefined : { touchAction: 'none' }}
        onPointerDown={(e) => {
          if (narrow) return
          if ((e.target as HTMLElement).closest('button.x')) return
          drag.current = {
            pointerId: e.pointerId,
            ox: e.clientX,
            oy: e.clientY,
            sx: win.x,
            sy: win.y,
          }
          focus(id)
          try {
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          } catch {
            /* untrusted / synthetic events may not capture */
          }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d || d.pointerId !== e.pointerId) return
          move(id, d.sx + (e.clientX - d.ox), d.sy + (e.clientY - d.oy))
        }}
        onPointerUp={(e) => {
          if (!drag.current || drag.current.pointerId !== e.pointerId) return
          try {
            ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
          } catch {
            /* already released */
          }
          drag.current = null
          savePos(id)
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
      >
        <button
          type="button"
          className="title-drag"
          aria-label={`drag ${title}`}
          tabIndex={-1}
        >
          <span className="mw-title-text">{title}</span>
        </button>
        <span className="wbtns">
          <button
            type="button"
            className="x"
            title="iconize"
            onClick={(e) => {
              e.stopPropagation()
              iconize(id)
            }}
          >
            ×
          </button>
        </span>
      </div>
      <div className="body95">{children}</div>
    </div>
  )
}
