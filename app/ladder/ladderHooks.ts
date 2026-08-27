import { useEffect, useState } from 'react'
import { zeroAddress, type Address } from 'viem'
import { useReadContract } from 'wagmi'
import { launchTokenAbi } from '../abi/launchToken'

/** ERC20 pair symbol, for copy only. A native book never hits the wire. */
export function usePairSymbol(pairToken: Address | undefined): string | null {
  const { data } = useReadContract({
    address: pairToken,
    abi: launchTokenAbi,
    functionName: 'symbol',
    query: {
      enabled: Boolean(pairToken) && pairToken !== zeroAddress,
    },
  })
  return typeof data === 'string' ? data : null
}

/** Wall clock in unix seconds. Only ticks while `active`, so a dead book is free. */
export function useNowSeconds(active: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      everyMs,
    )
    return () => window.clearInterval(id)
  }, [active, everyMs])
  return now
}
