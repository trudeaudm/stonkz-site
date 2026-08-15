import { useIndex } from '../shell/IndexProvider'
import { StaticWin } from '../shell/StaticWin'
import { useWindowManager } from '../shell/windowManager'

export function ActivityLogDock() {
  const { logLines, progress } = useIndex()
  const { isIconized, open, iconize } = useWindowManager()

  if (isIconized('activity_log')) return null

  const latest =
    logLines.length > 0
      ? logLines[logLines.length - 1].text
      : progress?.status === 'scanning'
        ? `scan · block ${progress.cursor.toString()} / ${progress.head.toString()}`
        : null

  return (
    <div className="logrow">
      <div className="deskicon log-hint" aria-hidden="true">
        <div className="ig">🖥</div>
        <div className="il">
          activity_
          <br />
          log.exe
        </div>
      </div>
      <StaticWin
        title="🖥 stonkz_activity.log"
        titleTone="green"
        className="activity-dock"
        onIconize={() => {
          open('activity_log', 'stonkz_activity.log')
          iconize('activity_log')
        }}
      >
        <div className="feed95">
          <div key={latest ?? 'empty'}>
            {latest ?? 'log empty. gate is closed.'}
          </div>
        </div>
        {logLines.length > 1 && (
          <div className="crt-log dock-expand">
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
