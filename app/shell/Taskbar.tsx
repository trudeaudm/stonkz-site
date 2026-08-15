import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { useWindowManager } from './windowManager'

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function pad(n: number) {
  return n < 10 ? `0${n}` : String(n)
}

export function Taskbar({
  startOpen,
  onToggleStart,
}: {
  startOpen: boolean
  onToggleStart: () => void
}) {
  const { windows, focused, restore, focus, open, close, isOpen } =
    useWindowManager()
  const { address, isConnected } = useAccount()
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const clock = `${pad(now.getHours())}:${pad(now.getMinutes())}`

  return (
    <div className="mw-taskbar">
      <button
        type="button"
        className={startOpen ? 'start-btn on' : 'start-btn'}
        onClick={onToggleStart}
      >
        ▲ START
      </button>
      <div className="tb-wins">
        {windows.map((w) => (
          <button
            key={w.id}
            type="button"
            className={
              focused === w.id && !w.iconized ? 'tb-win on' : 'tb-win'
            }
            onClick={() => (w.iconized ? restore(w.id) : focus(w.id))}
          >
            {w.title}
          </button>
        ))}
      </div>
      <div className="tb-tray">
        {isConnected && address ? (
          <button
            type="button"
            className="wallet-chip"
            onClick={() => {
              if (isOpen('account')) close('account')
              else open('account', 'account.exe')
            }}
          >
            {short(address)}
          </button>
        ) : (
          <span className="wallet-chip muted-chip">no wallet</span>
        )}
        <span className="tb-clock mono">{clock}</span>
      </div>
    </div>
  )
}

export function StartMenu({
  open,
  onClose,
  onOpenProgram,
}: {
  open: boolean
  onClose: () => void
  onOpenProgram: (id: 'make_coin' | 'the_market' | 'activity_log') => void
}) {
  if (!open) return null
  return (
    <div className="start-menu" role="menu">
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onOpenProgram('make_coin')
          onClose()
        }}
      >
        make_coin.exe
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onOpenProgram('the_market')
          onClose()
        }}
      >
        the_market.exe
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onOpenProgram('activity_log')
          onClose()
        }}
      >
        activity_log.exe
      </button>
    </div>
  )
}
