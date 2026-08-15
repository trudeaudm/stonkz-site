import { StaticWin } from '../shell/StaticWin'

/** Honest quiet sonar — no auction filed yet. */
export function SonarQuiet() {
  return (
    <StaticWin title="sonar.exe" titleTone="green" className="sonar-quiet">
      <div className="radar-cell">
        <div className="radar quiet" aria-hidden="true" />
        <div className="mono radar-cap">sonar.exe — quiet. nothing filed.</div>
      </div>
    </StaticWin>
  )
}
