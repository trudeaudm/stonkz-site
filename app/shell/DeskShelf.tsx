import { useWindowManager, type WinId } from './windowManager'

function glyph(id: WinId): string {
  if (id === 'make_coin') return '📈'
  if (id === 'precheck') return '✅'
  if (id === 'my_stuff') return '🧍'
  if (id === 'forum') return '💬'
  if (id === 'account') return '👛'
  if (id === 'certificate') return '📜'
  if (id === 'activity_log') return '🖥'
  if (id.startsWith('token:')) return '📁'
  return '🗔'
}

function routeFor(id: WinId): string | null {
  if (id === 'make_coin' || id === 'precheck' || id === 'certificate') {
    return '#/make'
  }
  if (id === 'my_stuff') return '#/me'
  if (id === 'forum') return '#/forum'
  if (id.startsWith('token:')) {
    return `#/tok/${id.slice('token:'.length)}`
  }
  return null
}

export function DeskShelf() {
  const { iconizedList, restore, open } = useWindowManager()
  if (iconizedList.length === 0) return null

  return (
    <div className="deskshelf" aria-label="iconized windows">
      {iconizedList.map((w) => (
        <button
          key={w.id}
          type="button"
          className="deskicon"
          title={`restore ${w.title}`}
          onClick={() => {
            const route = routeFor(w.id)
            if (route && window.location.hash !== route) {
              window.location.hash = route
            }
            open(w.id, w.title)
            restore(w.id)
          }}
        >
          <div className="ig">{glyph(w.id)}</div>
          <div className="il">{w.title}</div>
        </button>
      ))}
    </div>
  )
}
