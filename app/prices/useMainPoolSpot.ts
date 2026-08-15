import { useEffect, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { v4AdapterAbi } from '../abi/v4Adapter'
import { env } from '../config/env'
import type { IndexedListing } from '../indexer/types'
import {
  ethPerTokenFromSlot0,
  ethPerTokenFromStartPriceWad,
  poolIdFromKey,
} from './spotMath'

export type MainPoolSpot = {
  ethPerToken: number
  usdPerToken: number
  startUsdPerToken: number
  deltaPct: number
  stampedEthUsd: number
}

const INTERVAL_MS = 15_000

/**
 * Live main-pool spot for a listing.
 * ETH/token from V4Adapter.getSlot0(poolId); USD = spot × stamped ethUsdWad.
 * On failure: returns null (never invents a number) and console.errors.
 */
export function useMainPoolSpot(
  listing: IndexedListing | null | undefined,
  visible = true,
): MainPoolSpot | null {
  const client = usePublicClient()
  const [spot, setSpot] = useState<MainPoolSpot | null>(null)

  useEffect(() => {
    if (!visible || !listing || listing.hydrateError) {
      setSpot(null)
      return
    }
    const adapter = env.addrV4Adapter
    if (!adapter || !client) {
      setSpot(null)
      return
    }

    let cancelled = false

    const read = async () => {
      try {
        const ethUsdRaw =
          listing.ethUsdWad != null && listing.ethUsdWad !== '0'
            ? BigInt(listing.ethUsdWad)
            : await client
                .readContract({
                  address: listing.listing,
                  abi: [
                    {
                      type: 'function',
                      name: 'ethUsdWad',
                      stateMutability: 'view',
                      inputs: [],
                      outputs: [{ type: 'uint256' }],
                    },
                  ] as const,
                  functionName: 'ethUsdWad',
                })
                .catch(() => 0n)
        const ethUsdWad = ethUsdRaw > 0n ? ethUsdRaw : null
        if (ethUsdWad == null) {
          if (!cancelled) setSpot(null)
          return
        }

        const id = poolIdFromKey(listing.mainPoolKey)
        const [sqrtPriceX96] = await client.readContract({
          address: adapter,
          abi: v4AdapterAbi,
          functionName: 'getSlot0',
          args: [id],
        })
        if (sqrtPriceX96 === 0n) {
          throw new Error('slot0 sqrtPriceX96 is zero (pool not initialized?)')
        }

        const ethPerToken = ethPerTokenFromSlot0(
          sqrtPriceX96,
          listing.mainPoolKey,
        )
        if (!Number.isFinite(ethPerToken) || ethPerToken <= 0) {
          throw new Error(`bad ethPerToken from slot0: ${ethPerToken}`)
        }

        const stampedEthUsd = Number(ethUsdWad) / 1e18
        const usdPerToken = ethPerToken * stampedEthUsd
        const startEth = ethPerTokenFromStartPriceWad(listing.startPriceWad)
        const startUsdPerToken = startEth * stampedEthUsd
        const deltaPct =
          startUsdPerToken > 0
            ? ((usdPerToken - startUsdPerToken) / startUsdPerToken) * 100
            : 0

        if (!cancelled) {
          setSpot({
            ethPerToken,
            usdPerToken,
            startUsdPerToken,
            deltaPct,
            stampedEthUsd,
          })
        }
      } catch (err) {
        console.error(
          '[spot] main pool slot0 failed',
          listing.listing,
          err instanceof Error ? err.message : err,
        )
        if (!cancelled) setSpot(null)
      }
    }

    void read()
    const id = window.setInterval(() => void read(), INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [client, listing, visible])

  return spot
}
