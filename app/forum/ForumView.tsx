import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { useAccount } from 'wagmi'
import { useToast } from '../shell/Toast'
import { Win95Window } from '../shell/Window'
import {
  addReply,
  addThread,
  loadThreads,
  upvote,
} from './storage'
import type { Thread } from './types'

function shortAuthor(addr: string | undefined): string {
  if (!addr) return 'anon'
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function relativeTime(at: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - at) / 1000))
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 48) return `${hr}h ago`
  return new Date(at).toLocaleDateString()
}

function ForumChrome({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <Win95Window id="forum" title={title} width={640} onClose={onClose}>
      {children}
    </Win95Window>
  )
}

export function ForumList({ onClose }: { onClose: () => void }) {
  const { address } = useAccount()
  const toast = useToast()
  const [threads, setThreads] = useState<Thread[]>(() => loadThreads())
  const [draft, setDraft] = useState('')

  const refresh = useCallback(() => setThreads(loadThreads()), [])

  const post = () => {
    const title = draft.trim()
    if (!title) {
      toast.push('thred need words, fren', 'err')
      return
    }
    addThread(title, shortAuthor(address))
    setDraft('')
    refresh()
    toast.push('thred posted ✓ very brave', 'ok')
  }

  const onUpvote = (id: string, e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    upvote(id)
    refresh()
  }

  const n = threads.length

  return (
    <ForumChrome
      title={`💬 stonkz_forum.exe — ${n} threds · very civil mostly`}
      onClose={onClose}
    >
      <a
        className="back btn95"
        href="#/"
        onClick={() => {
          onClose()
        }}
      >
        ← back to stonkz
      </a>
      <div
        className="caption"
        style={{
          fontSize: 'clamp(22px, 4vw, 32px)',
          textAlign: 'left',
          marginBottom: 14,
        }}
      >
        THE FORUM. WHERE FRENS TALK.
      </div>
      <p className="hint" style={{ textAlign: 'left', marginTop: 0 }}>
        forum is local to your machine for now. frens arrive at go-public.
      </p>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <div className="inset" style={{ flex: 1, padding: '6px 8px' }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="start a new thred... (what is on your mind, fren)"
            style={{
              border: 'none',
              outline: 'none',
              width: '100%',
              fontFamily: "'IBM Plex Mono'",
              fontSize: 12,
              background: 'transparent',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') post()
            }}
          />
        </div>
        <button type="button" className="btn95 go" onClick={post}>
          post thred
        </button>
      </div>
      <div className="inset" style={{ padding: 0 }}>
        {threads.length === 0 ? (
          <div className="nm" style={{ padding: 12 }}>
            no threds yet. very civil so far.
          </div>
        ) : (
          threads.map((t) => (
            <a
              key={t.id}
              className="thread-row"
              href={`#/thread/${t.id}`}
              style={{ display: 'flex', textDecoration: 'none', color: 'inherit' }}
            >
              <div className="vote">
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => onUpvote(t.id, e)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      e.stopPropagation()
                      upvote(t.id)
                      refresh()
                    }
                  }}
                >
                  ▲
                </span>
                <br />
                {t.votes}
              </div>
              <div className="grow">
                <b>
                  {t.sticky ? '📌 ' : ''}
                  {t.title}
                </b>
                <div className="mono" style={{ fontSize: 10, color: '#4A4A56' }}>
                  by {t.author} · {relativeTime(t.createdAt)}
                </div>
              </div>
              <div className="mono" style={{ fontSize: 11, color: '#3A3A46' }}>
                💬 {t.replies.length}
              </div>
            </a>
          ))
        )}
      </div>
    </ForumChrome>
  )
}

export function ForumThread({
  id,
  onClose,
}: {
  id: string
  onClose: () => void
}) {
  const { address } = useAccount()
  const toast = useToast()
  const [thread, setThread] = useState<Thread | null>(() =>
    loadThreads().find((t) => t.id === id) ?? null,
  )
  const [draft, setDraft] = useState('')

  useEffect(() => {
    setThread(loadThreads().find((t) => t.id === id) ?? null)
  }, [id])

  const refresh = useCallback(() => {
    setThread(loadThreads().find((t) => t.id === id) ?? null)
  }, [id])

  const title = useMemo(() => {
    if (!thread) return '💬 thred gone.exe'
    return `💬 ${thread.sticky ? '📌 ' : ''}${thread.title}`
  }, [thread])

  if (!thread) {
    return (
      <ForumChrome title={title} onClose={onClose}>
        <a className="back btn95" href="#/forum">
          ← all threds
        </a>
        <p className="hint">thred not found. maybe never was.</p>
      </ForumChrome>
    )
  }

  const reply = () => {
    const x = draft.trim()
    if (!x) {
      toast.push('reply need words, fren', 'err')
      return
    }
    addReply(thread.id, { a: shortAuthor(address), x })
    setDraft('')
    refresh()
    toast.push('reply posted ✓', 'ok')
  }

  return (
    <ForumChrome title={title} onClose={onClose}>
      <a className="back btn95" href="#/forum">
        ← all threds
      </a>
      <div
        className="mono"
        style={{ fontSize: 10.5, color: '#4A4A56', marginBottom: 8 }}
      >
        by {thread.author} · {relativeTime(thread.createdAt)} · ▲ {thread.votes}{' '}
        <span
          style={{ cursor: 'pointer', textDecoration: 'underline' }}
          role="button"
          tabIndex={0}
          onClick={() => {
            upvote(thread.id)
            refresh()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              upvote(thread.id)
              refresh()
            }
          }}
        >
          upvote
        </span>
      </div>
      {thread.replies.map((r, i) => (
        <div className="post" key={`${r.at}-${i}`}>
          <div className="post-h">
            <span>
              <b>{r.a}</b>
              {i === 0 ? ' (OP)' : ''}
            </span>
            <span>#{i + 1}</span>
          </div>
          <div className="post-b">{r.x}</div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <div className="inset" style={{ flex: 1, padding: '6px 8px' }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="reply to the thred..."
            style={{
              border: 'none',
              outline: 'none',
              width: '100%',
              fontFamily: "'IBM Plex Mono'",
              fontSize: 12,
              background: 'transparent',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') reply()
            }}
          />
        </div>
        <button type="button" className="btn95 go" onClick={reply}>
          reply
        </button>
      </div>
    </ForumChrome>
  )
}
