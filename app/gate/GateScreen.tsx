import { useEffect, useState, type ReactNode } from 'react'
import { useBetaGate } from './useBetaGate'

const MARKETING_URL = 'https://stonkz.green'

function redirectHome() {
  // Unapproved wallets redirect to stonkz.green after the countdown.
  window.location.replace(MARKETING_URL)
}

export function GateScreen({ children }: { children: ReactNode }) {
  // The gate is frontend-only UX gating; the real protection is the on-chain DeployControls allowlist.
  const { state, declined, connect } = useBetaGate()
  const [seconds, setSeconds] = useState(5)

  useEffect(() => {
    if (state.phase !== 'denied') {
      setSeconds(5)
      return
    }
    const id = window.setInterval(() => {
      setSeconds((n) => {
        if (n <= 1) {
          window.clearInterval(id)
          redirectHome()
          return 0
        }
        return n - 1
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [state.phase])

  if (state.phase === 'off' || state.phase === 'approved') {
    return <>{children}</>
  }

  if (state.phase === 'denied') {
    return (
      <div className="win">
        <div className="tb">stonkz_beta.exe</div>
        <div className="body95">
          <p>
            this wallet is not on the beta list. redirecting to stonkz.green in{' '}
            {seconds}…
          </p>
          <button type="button" className="btn95" onClick={redirectHome}>
            go now
          </button>
        </div>
      </div>
    )
  }

  const busy = state.phase === 'connecting' || state.phase === 'checking'

  return (
    <div className="win">
      <div className="tb">stonkz_beta.exe</div>
      <div className="body95">
        <p>closed beta. connect to verify access.</p>
        <button
          type="button"
          className="btn95"
          disabled={busy}
          onClick={() => void connect()}
        >
          connect wallet
        </button>
        {busy && <p className="status">verifying…</p>}
        {state.phase === 'disconnected' && declined && (
          <p className="hint">connection declined — retry</p>
        )}
      </div>
    </div>
  )
}
