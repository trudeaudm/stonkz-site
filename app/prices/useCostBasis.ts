import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import { usePublicClient } from 'wagmi'
import type { IndexedListing } from '../indexer/types'
import { useIndex } from '../shell/IndexProvider'
import { costBasisForWallet, type CostBasis } from './costBasis'

export function useCostBasis(
  listing: IndexedListing | null | undefined,
  wallet: Address | undefined,
  balanceRaw: bigint | undefined,
  liveEthUsd: number | null,
): CostBasis | null {
  const client = usePublicClient()
  const { envelope } = useIndex()
  const [basis, setBasis] = useState<CostBasis | null>(null)

  useEffect(() => {
    if (!client || !envelope || !listing || !wallet || balanceRaw == null) {
      setBasis(null)
      return
    }
    if (balanceRaw === 0n) {
      setBasis(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const b = await costBasisForWallet(
          client,
          envelope,
          listing,
          wallet,
          balanceRaw,
          liveEthUsd,
        )
        if (!cancelled) setBasis(b)
      } catch (err) {
        console.error(
          '[costBasis]',
          listing.listing,
          err instanceof Error ? err.message : err,
        )
        if (!cancelled) setBasis(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [balanceRaw, client, envelope, listing, liveEthUsd, wallet])

  return basis
}
