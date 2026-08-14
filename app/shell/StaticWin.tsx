import type { ReactNode } from 'react'

/** In-flow win95 chrome — not draggable, not in the window manager. */
export function StaticWin({
  title,
  titleTone = 'navy',
  children,
  className,
  onClose,
}: {
  title: string
  titleTone?: 'navy' | 'green' | 'amber' | 'red'
  children: ReactNode
  className?: string
  onClose?: () => void
}) {
  return (
    <div className={`static-win ${className ?? ''}`}>
      <div className={`mw-title tone-${titleTone}`}>
        <span className="mw-title-text">{title}</span>
        {onClose && (
          <span className="mw-wbtns">
            <button
              type="button"
              className="mw-tbtn"
              title="close"
              onClick={onClose}
            >
              ×
            </button>
          </span>
        )}
      </div>
      <div className="mw-body">{children}</div>
    </div>
  )
}
