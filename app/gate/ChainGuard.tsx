import { useCallback, useState, type ReactNode } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import { env } from '../config/env'
import { getInjectedProvider } from './connect'

function isUnknownChainError(err: unknown): boolean {
  let current: unknown = err
  for (let i = 0; i < 6 && current; i++) {
    if (typeof current !== 'object' || current === null) break
    const rec = current as {
      code?: unknown
      cause?: unknown
      name?: string
      message?: string
    }
    if (rec.code === 4902 || rec.name === 'ChainNotFoundError') return true
    if (typeof rec.message === 'string' && /unrecognized chain/i.test(rec.message)) {
      return true
    }
    current = rec.cause
  }
  return false
}

async function addRobinhoodChain() {
  const eth = getInjectedProvider()
  if (!eth?.request) throw new Error('no injected wallet')
  await eth.request({
    method: 'wallet_addEthereumChain',
    params: [
      {
        chainId: `0x${env.chainId.toString(16)}`,
        chainName: 'Robinhood Chain',
        nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
        rpcUrls: [env.rpcUrl],
        blockExplorerUrls: [env.explorerUrl],
      },
    ],
  })
}

export function useOnCorrectChain(): boolean {
  const { chainId, isConnected } = useAccount()
  return Boolean(isConnected && chainId === env.chainId)
}

export function ChainGuard({ children }: { children: ReactNode }) {
  const { isConnected } = useAccount()
  const onCorrectChain = useOnCorrectChain()
  const { switchChainAsync } = useSwitchChain()
  const [switching, setSwitching] = useState(false)
  const [switchError, setSwitchError] = useState<string | null>(null)

  const onSwitch = useCallback(async () => {
    setSwitchError(null)
    setSwitching(true)
    try {
      try {
        await switchChainAsync({ chainId: env.chainId })
      } catch (err) {
        if (!isUnknownChainError(err)) throw err
        await addRobinhoodChain()
        await switchChainAsync({ chainId: env.chainId })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'switch failed'
      setSwitchError(msg)
    } finally {
      setSwitching(false)
    }
  }, [switchChainAsync])

  return (
    <>
      {isConnected && !onCorrectChain && (
        <div className="chain-banner">
          <span>wrong network</span>
          <button
            type="button"
            className="btn95"
            disabled={switching}
            onClick={() => void onSwitch()}
          >
            switch to robinhood chain
          </button>
          {switchError && <p className="hint">{switchError}</p>}
        </div>
      )}
      {children}
    </>
  )
}
