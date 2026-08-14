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
        setToasts((cur) => cur.filter((x) => x.id !== id))
      }, 3200)
      return [...t.slice(-4), { id, message, kind }]
    })
  }, [])

  const api = useMemo(() => ({ push }), [push])

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast95 toast-${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast() {
  const v = useContext(Ctx)
  if (!v) throw new Error('ToastProvider missing')
  return v
}
