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
  /** Iconized to deskshelf — not closed. */
  iconized: boolean
  z: number
  x: number
  y: number
  width: number
}

type WindowManagerValue = {
  windows: WinDef[]
  focused: WinId | null
  open: (id: WinId, title: string) => void
  close: (id: WinId) => void
  focus: (id: WinId) => void
  iconize: (id: WinId) => void
  restore: (id: WinId) => void
  move: (id: WinId, x: number, y: number) => void
  savePos: (id: WinId) => void
  isOpen: (id: WinId) => boolean
  isVisible: (id: WinId) => boolean
  isIconized: (id: WinId) => boolean
  iconizedList: WinDef[]
}

const Ctx = createContext<WindowManagerValue | null>(null)

const POS_PREFIX = 'stonkz:win:v1:'
const ICON_KEY = 'stonkz:icon:v1'
let zSeed = 0

function bucket(): 'wide' | 'narrow' {
  return window.matchMedia('(max-width: 839px)').matches ? 'narrow' : 'wide'
}

function posKey(id: string) {
  return `${POS_PREFIX}${id}:${bucket()}`
}

function loadPos(id: string): { x: number; y: number; width: number } | null {
  try {
    const raw = localStorage.getItem(posKey(id))
    if (!raw) return null
    const p = JSON.parse(raw) as { x: number; y: number; width: number }
    if (
      typeof p.x !== 'number' ||
      typeof p.y !== 'number' ||
      typeof p.width !== 'number'
    ) {
      return null
    }
    // Still ≥40px of title bar visible
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (p.x + p.width < 40 || p.x > vw - 40) return null
    if (p.y + 28 < 40 || p.y > vh - 40) return null
    return p
  } catch {
    return null
  }
}

function savePosRaw(id: string, x: number, y: number, width: number) {
  try {
    localStorage.setItem(posKey(id), JSON.stringify({ x, y, width }))
  } catch {
    /* ignore */
  }
}

function loadIconMeta(): { id: WinId; title: string }[] {
  try {
    const raw = localStorage.getItem(ICON_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as { id: WinId; title: string }[]
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function saveIconMeta(list: { id: WinId; title: string }[]) {
  try {
    localStorage.setItem(ICON_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

function cascadeDefault(
  openCount: number,
  preferWidth = 480,
): { x: number; y: number; width: number } {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const width = Math.min(preferWidth, Math.max(280, vw - 24))
  const x = Math.max(12, vw - width - 24 - openCount * 28)
  const y = 56 + openCount * 28
  return { x, y, width }
}

function clampPos(x: number, y: number, width: number) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  // min 40px of title bar visible
  const nx = Math.min(Math.max(x, 40 - width), vw - 40)
  const ny = Math.min(Math.max(y, 0), vh - 40)
  return { x: nx, y: ny }
}

export function WindowManagerProvider({ children }: { children: ReactNode }) {
  const [windows, setWindows] = useState<WinDef[]>(() => {
    if (typeof window === 'undefined') return []
    const meta = loadIconMeta()
    zSeed = meta.length
    return meta.map((m, i) => {
      const pos = loadPos(m.id) ?? cascadeDefault(i)
      return {
        id: m.id,
        title: m.title,
        iconized: true,
        z: i + 1,
        x: pos.x,
        y: pos.y,
        width: pos.width,
      }
    })
  })
  const zRef = useRef(Math.max(20, zSeed + 1))
  const cascadeRef = useRef(0)

  const open = useCallback((id: WinId, title: string) => {
    setWindows((prev) => {
      const existing = prev.find((w) => w.id === id)
      zRef.current += 1
      if (existing) {
        // restore from iconized
        const nextMeta = loadIconMeta().filter((m) => m.id !== id)
        saveIconMeta(nextMeta)
        return prev.map((w) =>
          w.id === id
            ? { ...w, title, iconized: false, z: zRef.current }
            : w,
        )
      }

      let pos = loadPos(id)
      if (!pos) {
        if (id === 'precheck') {
          const coin = prev.find((w) => w.id === 'make_coin' && !w.iconized)
          const pw = 320
          if (coin && coin.x - pw - 12 >= 12) {
            pos = { x: coin.x - pw - 12, y: coin.y, width: pw }
          } else {
            pos = cascadeDefault(cascadeRef.current++, 320)
          }
        } else if (id === 'make_coin') {
          pos = cascadeDefault(cascadeRef.current++, 480)
          // if precheck already open, dock it left when possible
          const pre = prev.find((w) => w.id === 'precheck' && !w.iconized)
          if (pre) {
            const pw = pre.width || 320
            if (pos.x - pw - 12 >= 12) {
              /* leave make_coin; precheck repositioned below */
            }
          }
        } else {
          pos = cascadeDefault(cascadeRef.current++, 480)
        }
      }

      return [
        ...prev,
        {
          id,
          title,
          iconized: false,
          z: zRef.current,
          x: pos.x,
          y: pos.y,
          width: pos.width,
        },
      ]
    })
  }, [])

  const close = useCallback((id: WinId) => {
    setWindows((prev) => prev.filter((w) => w.id !== id))
    saveIconMeta(loadIconMeta().filter((m) => m.id !== id))
  }, [])

  const focus = useCallback((id: WinId) => {
    zRef.current += 1
    setWindows((prev) =>
      prev.map((w) =>
        w.id === id ? { ...w, z: zRef.current, iconized: false } : w,
      ),
    )
  }, [])

  const iconize = useCallback((id: WinId) => {
    setWindows((prev) => {
      const w = prev.find((x) => x.id === id)
      if (!w) return prev
      const meta = loadIconMeta().filter((m) => m.id !== id)
      meta.push({ id, title: w.title })
      saveIconMeta(meta)
      return prev.map((x) => (x.id === id ? { ...x, iconized: true } : x))
    })
  }, [])

  const restore = useCallback((id: WinId) => {
    zRef.current += 1
    setWindows((prev) => {
      saveIconMeta(loadIconMeta().filter((m) => m.id !== id))
      return prev.map((w) =>
        w.id === id
          ? { ...w, iconized: false, z: zRef.current }
          : w,
      )
    })
  }, [])

  const move = useCallback((id: WinId, x: number, y: number) => {
    setWindows((prev) =>
      prev.map((w) => {
        if (w.id !== id) return w
        const c = clampPos(x, y, w.width)
        return { ...w, x: c.x, y: c.y }
      }),
    )
  }, [])

  const savePos = useCallback((id: WinId) => {
    setWindows((prev) => {
      const w = prev.find((x) => x.id === id)
      if (w) savePosRaw(id, w.x, w.y, w.width)
      return prev
    })
  }, [])

  const isOpen = useCallback(
    (id: WinId) => windows.some((w) => w.id === id),
    [windows],
  )

  const isVisible = useCallback(
    (id: WinId) => windows.some((w) => w.id === id && !w.iconized),
    [windows],
  )

  const isIconized = useCallback(
    (id: WinId) => windows.some((w) => w.id === id && w.iconized),
    [windows],
  )

  const iconizedList = useMemo(
    () => windows.filter((w) => w.iconized),
    [windows],
  )

  const focused = useMemo(() => {
    const visible = windows.filter((w) => !w.iconized)
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
      iconize,
      restore,
      move,
      savePos,
      isOpen,
      isVisible,
      isIconized,
      iconizedList,
    }),
    [
      windows,
      focused,
      open,
      close,
      focus,
      iconize,
      restore,
      move,
      savePos,
      isOpen,
      isVisible,
      isIconized,
      iconizedList,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useWindowManager() {
  const v = useContext(Ctx)
  if (!v) throw new Error('WindowManagerProvider missing')
  return v
}
