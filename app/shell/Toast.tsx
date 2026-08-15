import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type ToastKind = 'info' | 'ok' | 'err'

type Toast = {
  id: number
  message: string
  kind: ToastKind
  show: boolean
}

type ToastApi = {
  push: (message: string, kind?: ToastKind) => void
}

const Ctx = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const push = useCallback((message: string, kind: ToastKind = 'info') => {
    setToasts((t) => {
      const id = (t[t.length - 1]?.id ?? 0) + 1
      window.setTimeout(() => {
        setToasts((cur) =>
          cur.map((x) => (x.id === id ? { ...x, show: false } : x)),
        )
      }, 2400)
      window.setTimeout(() => {
        setToasts((cur) => cur.filter((x) => x.id !== id))
      }, 2800)
      return [...t.slice(-2), { id, message, kind, show: true }]
    })
  }, [])

  const api = useMemo(() => ({ push }), [push])

  const top = toasts[toasts.length - 1]

  return (
    <Ctx.Provider value={api}>
      {children}
      <div
        className={`toast${top?.show ? ' show' : ''}${top ? ` toast-${top.kind}` : ''}`}
        aria-live="polite"
      >
        {top?.message ?? ''}
      </div>
    </Ctx.Provider>
  )
}

export function useToast() {
  const v = useContext(Ctx)
  if (!v) throw new Error('ToastProvider missing')
  return v
}
