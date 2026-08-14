import { Stamp } from '../shell/Stamp'
import { StaticWin } from '../shell/StaticWin'

export function GenesisSlot() {
  return (
    <StaticWin
      title="⭐ genesis_auction.exe — the first coin is the site itself"
      titleTone="amber"
      className="genesis-slot"
    >
      <div className="coinrow">
        <div className="coinic">★</div>
        <div className="grow">
          <div className="tk">
            genesis <Stamp variant="genesis">GENESIS</Stamp>
          </div>
          <div className="nm">the coin of the site. much protocol.</div>
        </div>
      </div>
      <p className="hint genesis-status">
        not yet filed. no token exists yet — anyone selling you a presale is
        lying.
      </p>
    </StaticWin>
  )
}
