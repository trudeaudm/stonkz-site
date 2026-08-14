import { useCallback, useEffect, useState } from 'react'
import { getAddress, isAddress, type Address } from 'viem'
import { useAccount } from 'wagmi'
import { LaunchHost } from './express/LaunchForm'
import { MarketWindow } from './express/Listings'
import { TokenWindow } from './express/ListingDetail'
import { ChainGuard } from './gate/ChainGuard'
import { GateScreen } from './gate/GateScreen'
import { AccountWindow } from './shell/AccountWindow'
import { ActivityLogWindow } from './shell/ActivityLog'
import { DeskIcon } from './shell/DeskIcon'
import { IndexProvider } from './shell/IndexProvider'
import { Scenery } from './shell/Scenery'
import { StartMenu, Taskbar } from './shell/Taskbar'
import { ToastProvider } from './shell/Toast'
import {
  WindowManagerProvider,
  useWindowManager,
  type WinId,
} from './shell/windowManager'

type Route =
  | { name: 'home' }
  | { name: 'launch' }
  | { name: 'listings' }
  | { name: 'detail'; listing: Address }

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const parts = raw.split('/').filter(Boolean)
  if (parts[0] === 'launch') return { name: 'launch' }
  if (parts[0] === 'listings') return { name: 'listings' }
  if (parts[0] === 'l' && parts[1] && isAddress(parts[1])) {
    return { name: 'detail', listing: getAddress(parts[1]) }
  }
  return { name: 'home' }
}

function navigate(route: Route) {
  if (route.name === 'home') window.location.hash = '#/'
  else if (route.name === 'launch') window.location.hash = '#/launch'
  else if (route.name === 'listings') window.location.hash = '#/listings'
  else window.location.hash = `#/l/${route.listing}`
}

function DesktopShell() {
  const { address } = useAccount()
  const { open, close, isOpen, windows } = useWindowManager()
  const [route, setRoute] = useState<Route>(() =>
    typeof window === 'undefined' ? { name: 'home' } : parseHash(),
  )
  const [startOpen, setStartOpen] = useState(false)
  const [tokenListing, setTokenListing] = useState<Address | null>(null)

  const syncFromRoute = useCallback(
    (r: Route) => {
      if (r.name === 'launch') {
        open('make_coin', 'make_coin.exe')
        open('precheck', 'precheck.exe')
      } else if (r.name === 'listings') {
        open('the_market', 'the_market.exe')
      } else if (r.name === 'detail') {
        setTokenListing(r.listing)
        open(
          `token:${r.listing}` as WinId,
          'token.exe',
        )
      }
    },
    [open],
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

  // Close hash-backed window → #/
  useEffect(() => {
    if (route.name === 'launch' && !isOpen('make_coin') && !isOpen('precheck')) {
      if (window.location.hash !== '#/' && window.location.hash !== '') {
        navigate({ name: 'home' })
        setRoute({ name: 'home' })
      }
    }
    if (route.name === 'listings' && !isOpen('the_market')) {
      if (window.location.hash.startsWith('#/listings')) {
        navigate({ name: 'home' })
        setRoute({ name: 'home' })
      }
    }
    if (route.name === 'detail' && tokenListing) {
      const id = `token:${tokenListing}` as WinId
      if (!isOpen(id) && window.location.hash.startsWith('#/l/')) {
        navigate({ name: 'home' })
        setRoute({ name: 'home' })
        setTokenListing(null)
      }
    }
  }, [windows, route, isOpen, tokenListing])

  const openProgram = useCallback(
    (id: 'make_coin' | 'the_market' | 'activity_log') => {
      if (id === 'make_coin') {
        open('make_coin', 'make_coin.exe')
        open('precheck', 'precheck.exe')
        navigate({ name: 'launch' })
        setRoute({ name: 'launch' })
      } else if (id === 'the_market') {
        open('the_market', 'the_market.exe')
        navigate({ name: 'listings' })
        setRoute({ name: 'listings' })
      } else {
        open('activity_log', 'activity_log.exe')
      }
    },
    [open],
  )

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
    <div className="mw-desktop">
      <Scenery />
      <div className="desk-icons">
        <DeskIcon
          label={'make_coin.exe'}
          glyph="▲"
          onOpen={() => openProgram('make_coin')}
        />
        <DeskIcon
          label={'the_market.exe'}
          glyph="≡"
          onOpen={() => openProgram('the_market')}
        />
        <DeskIcon
          label={'activity_log.exe'}
          glyph="🖥"
          onOpen={() => openProgram('activity_log')}
        />
      </div>

      <div className="mw-stage">
        <ChainGuard>
          {address && (isOpen('make_coin') || isOpen('precheck') || isOpen('certificate')) && (
            <LaunchHost
              formOpen={isOpen('make_coin')}
              precheckOpen={isOpen('precheck')}
              onCloseForm={() => {
                close('make_coin')
                if (!isOpen('precheck')) {
                  navigate({ name: 'home' })
                  setRoute({ name: 'home' })
                }
              }}
              onClosePrecheck={() => close('precheck')}
              onReceiptOpen={() => open('certificate', 'certificate.exe')}
              onCloseCertificate={() => close('certificate')}
            />
          )}
          {address && isOpen('the_market') && (
            <MarketWindow
              onOpen={openToken}
              onClose={() => {
                close('the_market')
                navigate({ name: 'home' })
                setRoute({ name: 'home' })
              }}
            />
          )}
          {address && tokenListing && isOpen(`token:${tokenListing}` as WinId) && (
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
          {isOpen('activity_log') && (
            <ActivityLogWindow onClose={() => close('activity_log')} />
          )}
          {isOpen('account') && (
            <AccountWindow onClose={() => close('account')} />
          )}
        </ChainGuard>
      </div>

      <StartMenu
        open={startOpen}
        onClose={() => setStartOpen(false)}
        onOpenProgram={openProgram}
      />
      <Taskbar
        startOpen={startOpen}
        onToggleStart={() => setStartOpen((s) => !s)}
      />
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
              <DesktopShell />
            </IndexProvider>
          </GateScreen>
        </div>
      </WindowManagerProvider>
    </ToastProvider>
  )
}
