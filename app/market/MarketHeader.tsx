import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useBetaGate } from '../gate/useBetaGate'

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function MarketHeader({
  onMakeCoin,
  onLadder,
  onMyStuff,
  onForum,
  onAccount,
}: {
  onMakeCoin: () => void
  onLadder: () => void
  onMyStuff: () => void
  onForum: () => void
  onAccount: () => void
}) {
  const { address, isConnected } = useAccount()
  const { state, connect, declined } = useBetaGate()
  const [busy, setBusy] = useState(false)

  const onWallet = async () => {
    if (isConnected && address) {
      onAccount()
      return
    }
    setBusy(true)
    try {
      await connect()
    } finally {
      setBusy(false)
    }
  }

  const chipLabel = (() => {
    if (busy || state.phase === 'connecting' || state.phase === 'checking') {
      return 'verifying…'
    }
    if (address) return short(address)
    return 'connect'
  })()

  return (
    <header className="top">
      <a href="#/" className="logo-lockup">
        <div className="logo-impact">S T O N K Z</div>
      </a>
      <div className="logo-stickers">
        <div className="tagline">only go up ☝</div>
        <div className="tagline tagline-2">robinhood chain</div>
      </div>
      <nav className="topnav">
        <button type="button" className="btn95 go" onClick={onMakeCoin}>
          ＋ make coin
        </button>
        <button
          type="button"
          className="btn95"
          onClick={onLadder}
          title="ladder auctions — the market sets the price"
        >
          🪜 ipo desk
        </button>
        <button type="button" className="btn95" onClick={onMyStuff}>
          🧍 my stuff
        </button>
        <button type="button" className="btn95" onClick={onForum}>
          💬 forum
        </button>
        <button
          type="button"
          className="btn95"
          onClick={() => void onWallet()}
          disabled={busy}
          title={address ? 'account' : 'connect'}
        >
          {chipLabel}
        </button>
      </nav>
      {declined && !address && (
        <p className="hint header-hint">connection declined — retry</p>
      )}
    </header>
  )
}
