import { useCallback, useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { env } from '../config/env'
import {
  connectInjected,
  disconnectWallet,
  isAlreadyConnected,
  isUserRejection,
  subscribeAccountsChanged,
} from './connect'

export type BetaGateState =
  | { phase: 'off' }
  | { phase: 'disconnected' }
  | { phase: 'connecting' }
  | { phase: 'checking' }
  | { phase: 'approved'; address: `0x${string}` }
  | { phase: 'denied'; address: `0x${string}` }

function isAllowlisted(address: string): boolean {
  if (env.testerAllowlist.length === 0) return false
  const needle = address.toLowerCase()
  return env.testerAllowlist.some((a) => a.toLowerCase() === needle)
}

function asAddress(value: string | undefined): `0x${string}` | undefined {
  if (!value) return undefined
  return value as `0x${string}`
}

export function useBetaGate() {
  const { address: wagmiAddress, status } = useAccount()
  const [watchedAccounts, setWatchedAccounts] = useState<readonly string[] | null>(
    null,
  )
  const [connecting, setConnecting] = useState(false)
  const [declined, setDeclined] = useState(false)
  const [state, setState] = useState<BetaGateState>(
    env.betaGate ? { phase: 'disconnected' } : { phase: 'off' },
  )

  const address = asAddress(
    watchedAccounts ? watchedAccounts[0] : wagmiAddress,
  )

  useEffect(() => {
    return subscribeAccountsChanged((accounts) => {
      setWatchedAccounts(accounts)
    })
  }, [])

  useEffect(() => {
    if (!env.betaGate) {
      setState({ phase: 'off' })
      return
    }

    const reconnecting = status === 'reconnecting' || status === 'connecting'
    if (connecting || (reconnecting && !address)) {
      setState({ phase: 'connecting' })
      return
    }

    if (!address) {
      setState({ phase: 'disconnected' })
      return
    }

    setState({ phase: 'checking' })
    const t = window.setTimeout(() => {
      if (isAllowlisted(address)) setState({ phase: 'approved', address })
      else setState({ phase: 'denied', address })
    }, 50)
    return () => window.clearTimeout(t)
  }, [address, connecting, status])

  const connect = useCallback(async () => {
    setDeclined(false)
    setConnecting(true)
    try {
      const result = await connectInjected()
      const next = result.accounts[0]
      if (next) setWatchedAccounts([next])
    } catch (err) {
      if (isAlreadyConnected(err)) return
      if (isUserRejection(err)) setDeclined(true)
      else setWatchedAccounts(null)
    } finally {
      setConnecting(false)
    }
  }, [])

  const disconnect = useCallback(async () => {
    setWatchedAccounts([])
    setDeclined(false)
    try {
      await disconnectWallet()
    } catch {
      // wallet already gone — local state still returns to disconnected
    }
  }, [])

  return { state, declined, connect, disconnect }
}
