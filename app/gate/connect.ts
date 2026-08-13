import { injected } from 'wagmi/connectors'
import { connect, disconnect } from 'wagmi/actions'
import { wagmiConfig } from '../config/wagmi'

type EthereumProvider = {
  on?(event: 'accountsChanged', handler: (accounts: string[]) => void): void
  removeListener?(event: 'accountsChanged', handler: (accounts: string[]) => void): void
  request?(args: { method: string; params?: unknown[] }): Promise<unknown>
}

export function getInjectedProvider(): EthereumProvider | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as Window & { ethereum?: EthereumProvider }).ethereum
}

export async function connectInjected() {
  const connector =
    wagmiConfig.connectors.find((c) => c.type === 'injected') ?? injected()
  return connect(wagmiConfig, { connector })
}

export function isAlreadyConnected(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === 'object' &&
      'name' in err &&
      (err as { name?: string }).name === 'ConnectorAlreadyConnectedError',
  )
}

export async function disconnectWallet() {
  return disconnect(wagmiConfig)
}

export function subscribeAccountsChanged(
  onAccounts: (accounts: readonly string[]) => void,
): () => void {
  const eth = getInjectedProvider()
  if (!eth?.on) return () => {}
  const handler = (accounts: string[]) => onAccounts(accounts)
  eth.on('accountsChanged', handler)
  return () => eth.removeListener?.('accountsChanged', handler)
}

export function isUserRejection(err: unknown): boolean {
  let current: unknown = err
  for (let i = 0; i < 6 && current; i++) {
    if (typeof current !== 'object' || current === null) break
    const rec = current as {
      name?: string
      code?: unknown
      cause?: unknown
      shortMessage?: string
      message?: string
    }
    if (rec.code === 4001 || rec.name === 'UserRejectedRequestError') return true
    const msg = `${rec.shortMessage ?? ''} ${rec.message ?? ''}`.toLowerCase()
    if (msg.includes('user rejected') || msg.includes('user denied')) return true
    current = rec.cause
  }
  return false
}
