import { useEffect, useRef, type ReactNode } from 'react'
import { useWindowManager, type WinId } from './windowManager'

export function Win95Window({
  id,
  title,
  titleTone,
  children,
  onClose,
  width,
}: {
  id: WinId
  title: string
  titleTone?: 'green' | 'amber' | 'red' | 'navy'
  children: ReactNode
  onClose?: () => void
  width?: number
}) {
  const { windows, focus, minimize, close, move } = useWindowManager()
  const win = windows.find((w) => w.id === id)
  const drag = useRef<{ ox: number; oy: number; sx: number; sy: number } | null>(
    null,
  )

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!drag.current || !win) return
      const nx = drag.current.sx + (e.clientX - drag.current.ox)
      const ny = drag.current.sy + (e.clientY - drag.current.oy)
      move(id, Math.max(0, nx), Math.max(0, ny))
    }
    const onUp = () => {
      drag.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [id, move, win])

  if (!win || win.minimized) return null

  const handleClose = () => {
    close(id)
    onClose?.()
  }

  return (
    <div
      className="mw-win"
      style={{
        zIndex: win.z,
        left: win.x,
        top: win.y,
        width: width ?? undefined,
      }}
      onMouseDown={() => focus(id)}
    >
      <div
        className={`mw-title tone-${titleTone ?? 'navy'}`}
        onPointerDown={(e) => {
          if (window.matchMedia('(max-width: 840px)').matches) return
          focus(id)
          drag.current = {
            ox: e.clientX,
            oy: e.clientY,
            sx: win.x,
            sy: win.y,
          }
        }}
      >
        <span className="mw-title-text">{title}</span>
        <span className="mw-wbtns">
          <button
            type="button"
            className="mw-tbtn"
            title="minimize"
            onClick={(e) => {
              e.stopPropagation()
              minimize(id)
            }}
          >
            _
          </button>
          <button
            type="button"
            className="mw-tbtn"
            title="close"
            onClick={(e) => {
              e.stopPropagation()
              handleClose()
            }}
          >
            ×
          </button>
        </span>
      </div>
      <div className="mw-body">{children}</div>
    </div>
  )
}
