import { Win95Window } from './Window'
import { useIndex } from './IndexProvider'

export function ActivityLogWindow({ onClose }: { onClose?: () => void }) {
  const { logLines, progress, error, factoryMissing } = useIndex()
  const empty =
    logLines.length === 0 &&
    progress?.status !== 'scanning' &&
    !error

  return (
    <Win95Window
      id="activity_log"
      title="activity_log.exe"
      titleTone="green"
      width={420}
      onClose={onClose}
    >
      <div className="crt-log">
        {factoryMissing && (
          <div className="crt-line bad">VITE_ADDR_EXPRESS_FACTORY unset</div>
        )}
        {error && <div className="crt-line bad">{error}</div>}
        {empty && (
          <div className="crt-line">log empty. gate is closed.</div>
        )}
        {logLines.map((l) => (
          <div key={l.id} className="crt-line">
            {l.text}
          </div>
        ))}
      </div>
    </Win95Window>
  )
}
