import { useCallback, useEffect, useRef, useState } from 'react'
import { getAddress, isAddress, type Address } from 'viem'
import { ForumList, ForumThread } from './forum/ForumView'
import { LaunchHost } from './express/LaunchForm'
import { TokenWindow } from './express/ListingDetail'
import { ChainGuard } from './gate/ChainGuard'
import { GateScreen } from './gate/GateScreen'
import { LadderDetailWindow } from './ladder/LadderDetailWindow'
import { LadderFileForm } from './ladder/LadderFileForm'
import { LadderListWindow } from './ladder/LadderListWindow'
import { ActivityLogDock } from './market/ActivityLogDock'
import { HeroHeadline } from './market/HeroHeadline'
import { LeagueTeaser } from './market/LeagueTeaser'
import { MarketGrid } from './market/MarketGrid'
import { MarketHeader } from './market/MarketHeader'
import { SonarQuiet } from './market/SonarQuiet'
import { TickerTape } from './market/TickerTape'
import { AccountWindow } from './shell/AccountWindow'
import { DeskShelf } from './shell/DeskShelf'
import { IndexProvider } from './shell/IndexProvider'
import { LadderIndexProvider } from './shell/LadderIndexProvider'
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
  | { name: 'forum' }
  | { name: 'thread'; id: string }
  | { name: 'detail'; listing: Address }
  | { name: 'ladder' }
  | { name: 'ladderFile' }
  | { name: 'auction'; auction: Address }

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
  if (parts[0] === 'forum') return { name: 'forum' }
  if (parts[0] === 'thread' && parts[1]) {
    return { name: 'thread', id: parts[1] }
  }
  if (parts[0] === 'tok' && parts[1] && isAddress(parts[1])) {
    return { name: 'detail', listing: getAddress(parts[1]) }
  }
  if (parts[0] === 'ladder') {
    if (parts[1] === 'file') return { name: 'ladderFile' }
    if (parts[1] && isAddress(parts[1])) {
      return { name: 'auction', auction: getAddress(parts[1]) }
    }
    return { name: 'ladder' }
  }
  return { name: 'home' }
}

function navigate(route: Route) {
  if (route.name === 'home') window.location.hash = '#/'
  else if (route.name === 'make') window.location.hash = '#/make'
  else if (route.name === 'me') window.location.hash = '#/me'
  else if (route.name === 'forum') window.location.hash = '#/forum'
  else if (route.name === 'thread') window.location.hash = `#/thread/${route.id}`
  else if (route.name === 'ladder') window.location.hash = '#/ladder'
  else if (route.name === 'ladderFile') window.location.hash = '#/ladder/file'
  else if (route.name === 'auction') {
    window.location.hash = `#/ladder/${route.auction}`
  } else window.location.hash = `#/tok/${route.listing}`
}

function MarketPage() {
  const { open, close, isOpen, isVisible } = useWindowManager()
  const [route, setRoute] = useState<Route>(() =>
    typeof window === 'undefined' ? { name: 'home' } : parseHash(),
  )
  const [tokenListing, setTokenListing] = useState<Address | null>(null)
  const [auctionAddr, setAuctionAddr] = useState<Address | null>(null)
  // Mirrors of the two above, updated in lockstep by the setters below. syncFromRoute needs to know which
  // window is currently open in order to close it, but it must not read that from a setState updater (an
  // updater has to be pure) nor take it as a dep (that would rebuild the callback and re-run the hashchange
  // effect on every navigation). Always go through setToken/setAuction so the two never diverge.
  const tokenRef = useRef<Address | null>(null)
  const auctionRef = useRef<Address | null>(null)
  const setToken = useCallback((v: Address | null) => {
    tokenRef.current = v
    setTokenListing(v)
  }, [])
  const setAuction = useCallback((v: Address | null) => {
    auctionRef.current = v
    setAuctionAddr(v)
  }, [])

  const syncFromRoute = useCallback(
    (r: Route) => {
      // Read the open window from a ref, NOT from a setState updater. An updater must be pure: React may
      // run it during the render phase, and `close` sets state on WindowManagerProvider — which is exactly
      // the "Cannot update a component while rendering a different component" warning this used to emit.
      const dropToken = () => {
        const prev = tokenRef.current
        if (prev) close(`token:${prev}` as WinId)
        setToken(null)
      }
      const dropAuction = () => {
        const prev = auctionRef.current
        if (prev) close(`ladder:${prev}` as WinId)
        setAuction(null)
      }

      if (r.name !== 'make') {
        close('make_coin')
        close('precheck')
      }
      if (r.name !== 'me') close('my_stuff')
      if (r.name !== 'forum' && r.name !== 'thread') close('forum')
      if (r.name !== 'ladder' && r.name !== 'auction' && r.name !== 'ladderFile') {
        close('ladder_list')
      }
      if (r.name !== 'ladderFile') close('ladder_file')
      if (r.name !== 'detail') dropToken()
      if (r.name !== 'auction') dropAuction()

      if (r.name === 'make') {
        open('make_coin', 'make_coin.exe')
        open('precheck', 'precheck.exe')
      } else if (r.name === 'me') {
        open('my_stuff', 'my_stuff.exe')
      } else if (r.name === 'forum' || r.name === 'thread') {
        open('forum', 'stonkz_forum.exe')
      } else if (r.name === 'detail') {
        setToken(r.listing)
        open(`token:${r.listing}` as WinId, 'token.exe')
      } else if (r.name === 'ladder') {
        open('ladder_list', 'ipo_desk.exe')
      } else if (r.name === 'ladderFile') {
        open('ladder_file', 'file_book.exe')
      } else if (r.name === 'auction') {
        setAuction(r.auction)
        open(`ladder:${r.auction}` as WinId, 'ipo.exe')
      }
    },
    [open, close, setToken, setAuction],
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

  // Window × handlers navigate home; do not race-redirect when open() is mid-flight.

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

  const goForum = useCallback(() => {
    open('forum', 'stonkz_forum.exe')
    navigate({ name: 'forum' })
    setRoute({ name: 'forum' })
  }, [open])

  const goLadder = useCallback(() => {
    open('ladder_list', 'ipo_desk.exe')
    navigate({ name: 'ladder' })
    setRoute({ name: 'ladder' })
  }, [open])

  const goLadderFile = useCallback(() => {
    open('ladder_file', 'file_book.exe')
    navigate({ name: 'ladderFile' })
    setRoute({ name: 'ladderFile' })
  }, [open])

  const openAuction = useCallback(
    (auction: Address) => {
      setAuction(auction)
      open(`ladder:${auction}` as WinId, 'ipo.exe')
      navigate({ name: 'auction', auction })
      setRoute({ name: 'auction', auction })
    },
    [open],
  )

  const openToken = useCallback(
    (listing: Address) => {
      setToken(listing)
      open(`token:${listing}` as WinId, 'token.exe')
      navigate({ name: 'detail', listing })
      setRoute({ name: 'detail', listing })
    },
    [open],
  )

  const closeForum = useCallback(() => {
    close('forum')
    navigate({ name: 'home' })
    setRoute({ name: 'home' })
  }, [close])

  return (
    <div className="market-page">
      <Scenery />
      <div className="wrap">
        <MarketHeader
          onMakeCoin={goMake}
          onLadder={goLadder}
          onMyStuff={goMe}
          onForum={goForum}
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
          <div>
            <SonarQuiet />
            <div style={{ marginTop: 12 }}>
              <LeagueTeaser />
            </div>
          </div>
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
                setToken(null)
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
          {isOpen('forum') && route.name === 'thread' && (
            <ForumThread id={route.id} onClose={closeForum} />
          )}
          {isOpen('forum') && route.name === 'forum' && (
            <ForumList onClose={closeForum} />
          )}
          {isOpen('ladder_list') && (
            <LadderListWindow
              onOpen={openAuction}
              onFile={goLadderFile}
              onClose={() => {
                close('ladder_list')
                navigate({ name: 'home' })
                setRoute({ name: 'home' })
              }}
            />
          )}
          {isOpen('ladder_file') && (
            <LadderFileForm
              onOpen={openAuction}
              onClose={() => {
                close('ladder_file')
                navigate({ name: 'ladder' })
                setRoute({ name: 'ladder' })
              }}
            />
          )}
          {auctionAddr && isOpen(`ladder:${auctionAddr}` as WinId) && (
            <LadderDetailWindow
              auction={auctionAddr}
              onClose={() => {
                close(`ladder:${auctionAddr}` as WinId)
                setAuction(null)
                navigate({ name: 'ladder' })
                setRoute({ name: 'ladder' })
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
              <LadderIndexProvider>
                <MarketPage />
              </LadderIndexProvider>
            </IndexProvider>
          </GateScreen>
        </div>
      </WindowManagerProvider>
    </ToastProvider>
  )
}
