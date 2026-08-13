import { useAccount } from 'wagmi'
import { ChainGuard, useOnCorrectChain } from './gate/ChainGuard'
import { GateScreen } from './gate/GateScreen'

function shortAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function AppWindow() {
  const { address } = useAccount()
  const onCorrectChain = useOnCorrectChain()
  const body = address
    ? `gated build — wallet ${shortAddress(address)} verified.`
    : 'gated build — nothing to see yet.'

  return (
    <div className="win">
      <div className="tb">stonkz_app.exe</div>
      <div className="body95">
        <p className={address && !onCorrectChain ? 'muted' : undefined}>{body}</p>
      </div>
    </div>
  )
}

export function App() {
  return (
    <div className="app">
      <GateScreen>
        <ChainGuard>
          <AppWindow />
        </ChainGuard>
      </GateScreen>
    </div>
  )
}
