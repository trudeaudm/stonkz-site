import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export type WinId =
  | 'make_coin'
  | 'precheck'
  | 'the_market'
  | 'activity_log'
  | 'certificate'
  | 'account'
  | 'my_stuff'
  | `token:${string}`

export type WinDef = {
  id: WinId
  title: string
  minimized: boolean
  z: number
  x: number
  y: number
}

type WindowManagerValue = {
  windows: WinDef[]
  focused: WinId | null
  open: (id: WinId, title: string) => void
  close: (id: WinId) => void
  focus: (id: WinId) => void
  minimize: (id: WinId) => void
  restore: (id: WinId) => void
  move: (id: WinId, x: number, y: number) => void
  isOpen: (id: WinId) => boolean
}

const Ctx = createContext<WindowManagerValue | null>(null)

const DEFAULT_POS: Record<string, { x: number; y: number }> = {
  make_coin: { x: 48, y: 72 },
  precheck: { x: 540, y: 88 },
  the_market: { x: 60, y: 40 },
  activity_log: { x: 80, y: 280 },
  certificate: { x: 160, y: 80 },
  account: { x: 280, y: 100 },
  my_stuff: { x: 100, y: 80 },
}

export function WindowManagerProvider({ children }: { children: ReactNode }) {
  const [windows, setWindows] = useState<WinDef[]>([])
  const zRef = useRef(10)

  const open = useCallback((id: WinId, title: string) => {
    setWindows((prev) => {
      const existing = prev.find((w) => w.id === id)
      zRef.current += 1
      if (existing) {
        return prev.map((w) =>
          w.id === id
            ? { ...w, title, minimized: false, z: zRef.current }
            : w,
        )
      }
      const base = DEFAULT_POS[id] ?? { x: 48 + (prev.length % 5) * 24, y: 40 + (prev.length % 5) * 20 }
      return [
        ...prev,
        {
          id,
          title,
          minimized: false,
          z: zRef.current,
          x: base.x,
          y: base.y,
        },
      ]
    })
  }, [])

  const close = useCallback((id: WinId) => {
    setWindows((prev) => prev.filter((w) => w.id !== id))
  }, [])

  const focus = useCallback((id: WinId) => {
    zRef.current += 1
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, z: zRef.current, minimized: false } : w)),
    )
  }, [])

  const minimize = useCallback((id: WinId) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, minimized: true } : w)),
    )
  }, [])

  const restore = useCallback((id: WinId) => {
    zRef.current += 1
    setWindows((prev) =>
      prev.map((w) =>
        w.id === id ? { ...w, minimized: false, z: zRef.current } : w,
      ),
    )
  }, [])

  const move = useCallback((id: WinId, x: number, y: number) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, x, y } : w)),
    )
  }, [])

  const isOpen = useCallback(
    (id: WinId) => windows.some((w) => w.id === id),
    [windows],
  )

  const focused = useMemo(() => {
    const visible = windows.filter((w) => !w.minimized)
    if (visible.length === 0) return null
    return visible.reduce((a, b) => (a.z >= b.z ? a : b)).id
  }, [windows])

  const value = useMemo(
    () => ({
      windows,
      focused,
      open,
      close,
      focus,
      minimize,
      restore,
      move,
      isOpen,
    }),
    [windows, focused, open, close, focus, minimize, restore, move, isOpen],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useWindowManager() {
  const v = useContext(Ctx)
  if (!v) throw new Error('WindowManagerProvider missing')
  return v
}
