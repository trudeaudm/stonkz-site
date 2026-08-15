import type { Reply, Thread } from './types'

const KEY = 'stonkz:forum:v1'

function uid(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function loadThreads(): Thread[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Thread[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveThreads(threads: Thread[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(threads))
  } catch {
    /* ignore quota */
  }
}

export function addThread(title: string, author: string): Thread {
  const now = Date.now()
  const thread: Thread = {
    id: uid(),
    title,
    author,
    time: 'just now',
    votes: 0,
    replies: [{ a: author, x: title, at: now }],
    createdAt: now,
  }
  const next = [thread, ...loadThreads()]
  saveThreads(next)
  return thread
}

export function addReply(threadId: string, reply: Omit<Reply, 'at'> & { at?: number }): Thread | null {
  const threads = loadThreads()
  const i = threads.findIndex((t) => t.id === threadId)
  if (i < 0) return null
  const at = reply.at ?? Date.now()
  const updated: Thread = {
    ...threads[i],
    replies: [...threads[i].replies, { a: reply.a, x: reply.x, at }],
  }
  threads[i] = updated
  saveThreads(threads)
  return updated
}

export function upvote(threadId: string): Thread | null {
  const threads = loadThreads()
  const i = threads.findIndex((t) => t.id === threadId)
  if (i < 0) return null
  const updated: Thread = { ...threads[i], votes: threads[i].votes + 1 }
  threads[i] = updated
  saveThreads(threads)
  return updated
}
