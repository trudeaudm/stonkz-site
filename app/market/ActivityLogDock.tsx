import { useState } from 'react'
import { useIndex } from '../shell/IndexProvider'
import { StaticWin } from '../shell/StaticWin'

export function ActivityLogDock() {
  const { logLines, progress } = useIndex()
  const [expanded, setExpanded] = useState(false)

  const latest =
    logLines.length > 0
      ? logLines[logLines.length - 1].text
      : progress?.status === 'scanning'
        ? `scan · block ${progress.cursor.toString()} / ${progress.head.toString()}`
        : null

  return (
    <div className="logrow">
      <StaticWin
        title="🖥 stonkz_activity.log"
        titleTone="green"
        className="activity-dock"
      >
        <button
          type="button"
          className="feed95-btn"
          onClick={() => setExpanded((e) => !e)}
        >
          <div className="feed95">
            {latest ?? 'log empty. gate is closed.'}
          </div>
        </button>
        {expanded && (
          <div className="crt-log dock-expand">
            {logLines.length === 0 && !latest && (
              <div className="crt-line">log empty. gate is closed.</div>
            )}
            {logLines.map((l) => (
              <div key={l.id} className="crt-line">
                {l.text}
              </div>
            ))}
          </div>
        )}
      </StaticWin>
    </div>
  )
}
