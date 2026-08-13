import { useAccount } from 'wagmi'
import { LaunchForm } from './express/LaunchForm'
import { ChainGuard, useOnCorrectChain } from './gate/ChainGuard'
import { GateScreen } from './gate/GateScreen'

function shortAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function AppShell() {
  const { address } = useAccount()
  const onCorrectChain = useOnCorrectChain()

  return (
    <>
      <div className="win">
        <div className="tb">stonkz_app.exe</div>
        <div className="body95">
          <p className={address && !onCorrectChain ? 'muted' : undefined}>
            {address
              ? `gated build — wallet ${shortAddress(address)} verified.`
              : 'gated build — nothing to see yet.'}
          </p>
        </div>
      </div>
      {address && <LaunchForm />}
    </>
  )
}

export function App() {
  return (
    <div className="app">
      <GateScreen>
        <ChainGuard>
          <AppShell />
        </ChainGuard>
      </GateScreen>
    </div>
  )
}
