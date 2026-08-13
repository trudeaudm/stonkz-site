import { useCallback, useEffect, useState } from 'react'
import { getAddress, isAddress, type Address } from 'viem'
import { useAccount } from 'wagmi'
import { LaunchForm } from './express/LaunchForm'
import { ListingDetail } from './express/ListingDetail'
import { Listings } from './express/Listings'
import { ChainGuard, useOnCorrectChain } from './gate/ChainGuard'
import { GateScreen } from './gate/GateScreen'

type Route =
  | { name: 'launch' }
  | { name: 'listings' }
  | { name: 'detail'; listing: Address }

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const parts = raw.split('/').filter(Boolean)
  if (parts[0] === 'listings') return { name: 'listings' }
  if (parts[0] === 'l' && parts[1] && isAddress(parts[1])) {
    return { name: 'detail', listing: getAddress(parts[1]) }
  }
  return { name: 'launch' }
}

function navigate(route: Route) {
  if (route.name === 'launch') window.location.hash = '#/launch'
  else if (route.name === 'listings') window.location.hash = '#/listings'
  else window.location.hash = `#/l/${route.listing}`
}

function shortAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function Taskbar({
  route,
  go,
}: {
  route: Route
  go: (r: Route) => void
}) {
  return (
    <div className="taskbar">
      <button
        type="button"
        className={route.name === 'launch' ? 'tb-btn on' : 'tb-btn'}
        onClick={() => go({ name: 'launch' })}
      >
        launch
      </button>
      <button
        type="button"
        className={route.name === 'listings' || route.name === 'detail' ? 'tb-btn on' : 'tb-btn'}
        onClick={() => go({ name: 'listings' })}
      >
        listings
      </button>
    </div>
  )
}

function AppShell() {
  const { address } = useAccount()
  const onCorrectChain = useOnCorrectChain()
  const [route, setRoute] = useState<Route>(() =>
    typeof window === 'undefined' ? { name: 'launch' } : parseHash(),
  )

  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    if (!window.location.hash) navigate({ name: 'launch' })
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = useCallback((r: Route) => {
    navigate(r)
    setRoute(r)
  }, [])

  return (
    <>
      <Taskbar route={route} go={go} />
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
      {address && route.name === 'launch' && <LaunchForm />}
      {address && route.name === 'listings' && (
        <Listings onOpen={(listing) => go({ name: 'detail', listing })} />
      )}
      {address && route.name === 'detail' && (
        <ListingDetail
          listing={route.listing}
          onBack={() => go({ name: 'listings' })}
        />
      )}
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
