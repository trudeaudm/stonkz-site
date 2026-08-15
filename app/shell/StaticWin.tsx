import type { ReactNode } from 'react'

/** CARD window — in-flow, never draggable, no position state. */
export function StaticWin({
  title,
  titleTone = 'navy',
  children,
  className,
  onIconize,
}: {
  title: string
  titleTone?: 'navy' | 'green' | 'amber' | 'red'
  children: ReactNode
  className?: string
  /** When set, × iconizes rather than omitting. */
  onIconize?: () => void
}) {
  return (
    <div className={`win static-win ${className ?? ''}`}>
      <div className={`title ${titleTone === 'navy' ? '' : titleTone}`.trim()}>
        <span className="mw-title-text">{title}</span>
        {onIconize && (
          <span className="wbtns">
            <button
              type="button"
              className="x"
              title="iconize"
              onClick={onIconize}
            >
              ×
            </button>
          </span>
        )}
      </div>
      <div className="body95">{children}</div>
    </div>
  )
}
