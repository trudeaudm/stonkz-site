import { StaticWin } from '../shell/StaticWin'

/** Honest season-0 teaser — no fake ranks. Links to my stuff. */
export function LeagueTeaser() {
  return (
    <StaticWin
      title="🏆 leage_of_underwriters.exe"
      titleTone="amber"
      className="league-teaser"
    >
      <p className="hint" style={{ textAlign: 'left', marginTop: 0 }}>
        season 0 has not begun. points may become airdrop. may. we not promis.
        kalm.
      </p>
      <a className="btn95" href="#/me">
        see my stuff →
      </a>
    </StaticWin>
  )
}
