export type Reply = { a: string; x: string; at: number }

export type Thread = {
  id: string
  title: string
  author: string
  time: string
  votes: number
  sticky?: boolean
  replies: Reply[]
  createdAt: number
}
