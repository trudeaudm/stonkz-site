import { useCallback, useEffect, useState } from 'react'
import { getAddress, isAddress, type Address } from 'viem'
import { LaunchHost } from './express/LaunchForm'
import { TokenWindow } from './express/ListingDetail'
import { ChainGuard } from './gate/ChainGuard'
import { GateScreen } from './gate/GateScreen'
import { ActivityLogDock } from './market/ActivityLogDock'
import { HeroHeadline } from './market/HeroHeadline'
import { MarketGrid } from './market/MarketGrid'
import { MarketHeader } from './market/MarketHeader'
import { SonarQuiet } from './market/SonarQuiet'
import { TickerTape } from './market/TickerTape'
import { AccountWindow } from './shell/AccountWindow'
import { DeskShelf } from './shell/DeskShelf'
import { IndexProvider } from './shell/IndexProvider'
import { MyStuffWindow } from './shell/MyStuffWindow'
import { Scenery } from './shell/Scenery'
import { ToastProvider } from './shell/Toast'
import {
  WindowManagerProvider,
  useWindowManager,
  type WinId,
} from './shell/windowManager'

type Route =
  | { name: 'home' }
  | { name: 'make' }
  | { name: 'me' }
  | { name: 'detail'; listing: Address }

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const parts = raw.split('/').filter(Boolean)

  // Legacy redirects → canonical hashes
  if (parts[0] === 'launch') {
    window.history.replaceState(null, '', '#/make')
    return { name: 'make' }
  }
  if (parts[0] === 'listings') {
    window.history.replaceState(null, '', '#/')
    return { name: 'home' }
  }
  if (parts[0] === 'l' && parts[1] && isAddress(parts[1])) {
    const listing = getAddress(parts[1])
    window.history.replaceState(null, '', `#/tok/${listing}`)
    return { name: 'detail', listing }
  }

  if (parts[0] === 'make') return { name: 'make' }
  if (parts[0] === 'me') return { name: 'me' }
  if (parts[0] === 'tok' && parts[1] && isAddress(parts[1])) {
    return { name: 'detail', listing: getAddress(parts[1]) }
  }
  return { name: 'home' }
}

function navigate(route: Route) {
  if (route.name === 'home') window.location.hash = '#/'
  else if (route.name === 'make') window.location.hash = '#/make'
  else if (route.name === 'me') window.location.hash = '#/me'
  else window.location.hash = `#/tok/${route.listing}`
}

function MarketPage() {
  const { open, close, isOpen, isVisible, windows } = useWindowManager()
  const [route, setRoute] = useState<Route>(() =>
    typeof window === 'undefined' ? { name: 'home' } : parseHash(),
  )
  const [tokenListing, setTokenListing] = useState<Address | null>(null)

  const syncFromRoute = useCallback(
    (r: Route) => {
      if (r.name !== 'make') {
        close('make_coin')
        close('precheck')
      }
      if (r.name !== 'me') close('my_stuff')

      if (r.name === 'make') {
        open('make_coin', 'make_coin.exe')
        open('precheck', 'precheck.exe')
        setTokenListing((prev) => {
          if (prev) close(`token:${prev}` as WinId)
          return null
        })
      } else if (r.name === 'me') {
        open('my_stuff', 'my_stuff.exe')
        setTokenListing((prev) => {
          if (prev) close(`token:${prev}` as WinId)
          return null
        })
      } else if (r.name === 'detail') {
        setTokenListing(r.listing)
        open(`token:${r.listing}` as WinId, 'token.exe')
      } else {
        setTokenListing((prev) => {
          if (prev) close(`token:${prev}` as WinId)
          return null
        })
      }
    },
    [open, close],
  )

  useEffect(() => {
    const onHash = () => {
      const r = parseHash()
      setRoute(r)
      syncFromRoute(r)
    }
    window.addEventListener('hashchange', onHash)
    if (!window.location.hash || window.location.hash === '#') {
      navigate({ name: 'home' })
    } else {
      syncFromRoute(parseHash())
    }
    return () => window.removeEventListener('hashchange', onHash)
  }, [syncFromRoute])

  useEffect(() => {
    if (route.name === 'make' && !isOpen('make_coin') && !isOpen('precheck') && !isOpen('certificate')) {
      if (window.location.hash.startsWith('#/make')) {
        navigate({ name: 'home' })
        setRoute({ name: 'home' })
      }
    }
    if (route.name === 'me' && !isOpen('my_stuff')) {
      if (window.location.hash.startsWith('#/me')) {
        navigate({ name: 'home' })
        setRoute({ name: 'home' })
      }
    }
    if (route.name === 'detail' && tokenListing) {
      const id = `token:${tokenListing}` as WinId
      if (!isOpen(id) && window.location.hash.startsWith('#/tok/')) {
        navigate({ name: 'home' })
        setRoute({ name: 'home' })
        setTokenListing(null)
      }
    }
  }, [windows, route, isOpen, tokenListing])

  const goMake = useCallback(() => {
    open('make_coin', 'make_coin.exe')
    open('precheck', 'precheck.exe')
    navigate({ name: 'make' })
    setRoute({ name: 'make' })
  }, [open])

  const goMe = useCallback(() => {
    open('my_stuff', 'my_stuff.exe')
    navigate({ name: 'me' })
    setRoute({ name: 'me' })
  }, [open])

  const openToken = useCallback(
    (listing: Address) => {
      setTokenListing(listing)
      open(`token:${listing}` as WinId, 'token.exe')
      navigate({ name: 'detail', listing })
      setRoute({ name: 'detail', listing })
    },
    [open],
  )

  return (
    <div className="market-page">
      <Scenery />
      <div className="wrap">
        <MarketHeader
          onMakeCoin={goMake}
          onMyStuff={goMe}
          onAccount={() => {
            if (isOpen('account')) close('account')
            else open('account', 'account.exe')
          }}
        />
        <TickerTape />
        <HeroHeadline />
        <ActivityLogDock />
        <DeskShelf />
        <div className="grid2">
          <MarketGrid onOpen={openToken} />
          <SonarQuiet />
        </div>
        <footer>
          S T O N K Z · stonkz.green · gated build · every number on this page
          is read from chain
          <br />
          not affiliated with robinhood markets · this is not financal advice
          becuase we cannot spell financal · never trade money you cannot lose,
          fren
          <span className="foot-sticker tagline">number go up responsibly</span>
        </footer>
      </div>

      <div className="overlay-stage">
        <ChainGuard>
          {(isOpen('make_coin') || isOpen('precheck') || isOpen('certificate')) && (
            <LaunchHost
              formOpen={isVisible('make_coin')}
              precheckOpen={isVisible('precheck')}
              onCloseForm={() => {
                close('make_coin')
                if (!isOpen('precheck') && !isOpen('certificate')) {
                  navigate({ name: 'home' })
                  setRoute({ name: 'home' })
                }
              }}
              onClosePrecheck={() => close('precheck')}
              onReceiptOpen={() => open('certificate', 'certificate.exe')}
              onCloseCertificate={() => {
                close('certificate')
                navigate({ name: 'home' })
                setRoute({ name: 'home' })
              }}
            />
          )}
          {tokenListing && isOpen(`token:${tokenListing}` as WinId) && (
            <TokenWindow
              listing={tokenListing}
              onClose={() => {
                close(`token:${tokenListing}` as WinId)
                setTokenListing(null)
                navigate({ name: 'home' })
                setRoute({ name: 'home' })
              }}
            />
          )}
          {isOpen('my_stuff') && (
            <MyStuffWindow
              onOpen={openToken}
              onClose={() => {
                close('my_stuff')
                navigate({ name: 'home' })
                setRoute({ name: 'home' })
              }}
            />
          )}
          {isOpen('account') && (
            <AccountWindow onClose={() => close('account')} />
          )}
        </ChainGuard>
      </div>
    </div>
  )
}

export function App() {
  return (
    <ToastProvider>
      <WindowManagerProvider>
        <div className="app mw-app">
          <GateScreen>
            <IndexProvider>
              <MarketPage />
            </IndexProvider>
          </GateScreen>
        </div>
      </WindowManagerProvider>
    </ToastProvider>
  )
}
