import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useBetaGate } from '../gate/useBetaGate'

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function MarketHeader({
  onMakeCoin,
  onMyStuff,
  onAccount,
}: {
  onMakeCoin: () => void
  onMyStuff: () => void
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
    <header className="mkt-top">
      <a href="#/" className="logo-lockup">
        <div className="logo-impact">S T O N K Z</div>
      </a>
      <div className="logo-stickers">
        <div className="tagline">only go up ☝</div>
        <div className="tagline tagline-2">robinhood chain</div>
      </div>
      <div className="topnav">
        <button type="button" className="btn95 go" onClick={onMakeCoin}>
          ＋ make coin
        </button>
        <button type="button" className="btn95" onClick={onMyStuff}>
          🧍 my stuff
        </button>
        <button
          type="button"
          className="wallet-chip header-chip"
          onClick={() => void onWallet()}
          disabled={busy}
          title={address ? 'account' : 'connect'}
        >
          {chipLabel}
        </button>
      </div>
      {declined && !address && (
        <p className="hint header-hint">connection declined — retry</p>
      )}
    </header>
  )
}
