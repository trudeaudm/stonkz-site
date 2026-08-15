import { useEffect, useMemo, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { expressFactoryAbi } from '../abi/expressFactory'
import { v4AdapterAbi } from '../abi/v4Adapter'
import { env } from '../config/env'
import {
  activeStoreForListing,
  priceSeriesForPool,
} from '../indexer/swaps'
import type { IndexedListing, PoolSwapStore } from '../indexer/types'
import { useIndex } from '../shell/IndexProvider'
import {
  ethPerTokenFromSlot0,
  ethPerTokenFromStartPriceWad,
  poolIdFromKey,
  startUsdPerTokenFromMcap,
  usdPerTokenFromSideSlot0,
} from './spotMath'

export type ListingSpot = {
  usdPerToken: number
  startUsdPerToken: number
  deltaPct: number
  mcapNow: number
  activePool: 'main' | 'side'
  /** Live factory ETH/USD — used for main-pool USD and "@ live rate" labels. */
  liveEthUsd: number | null
  /** Filing stamp — history only. */
  stampedEthUsd: number | null
  ethPerToken: number | null
}

const INTERVAL_MS = 15_000

/**
 * Live spot from the ACTIVE traded pool (swap indexer).
 * Side (USDG): USDG/token IS usd/token — no ETH rate.
 * Main (ETH): eth/token × LIVE currentEthUsdWad() ("@ live rate").
 * Display spot always re-reads slot0; never silently falls back to the other pool.
 */
export function useListingSpot(
  listing: IndexedListing | null | undefined,
  visible = true,
): ListingSpot | null {
  const client = usePublicClient()
  const { envelope } = useIndex()
  const [spot, setSpot] = useState<ListingSpot | null>(null)

  const meta = listing
    ? envelope?.listingSwapMeta?.[listing.listing.toLowerCase()]
    : undefined
  const activePool = meta?.activePool ?? 'main'

  useEffect(() => {
    if (!visible || !listing || listing.hydrateError) {
      setSpot(null)
      return
    }
    const adapter = env.addrV4Adapter
    const factory = env.addrExpressFactory
    if (!adapter || !client) {
      setSpot(null)
      return
    }

    let cancelled = false

    const read = async () => {
      try {
        const key =
          activePool === 'side' && listing.sidePoolKey
            ? listing.sidePoolKey
            : listing.mainPoolKey
        if (activePool === 'side' && !listing.sidePoolKey) {
          throw new Error('activePool=side but sidePoolKey missing')
        }

        const id = poolIdFromKey(key)
        const [sqrtPriceX96] = await client.readContract({
          address: adapter,
          abi: v4AdapterAbi,
          functionName: 'getSlot0',
          args: [id],
        })
        if (sqrtPriceX96 === 0n) {
          throw new Error('slot0 sqrtPriceX96 is zero (pool not initialized?)')
        }

        let liveEthUsd: number | null = null
        if (factory) {
          try {
            const wad = await client.readContract({
              address: factory,
              abi: expressFactoryAbi,
              functionName: 'currentEthUsdWad',
            })
            liveEthUsd = Number(wad) / 1e18
          } catch (e) {
            console.error(
              '[spot] currentEthUsdWad failed',
              e instanceof Error ? e.message : e,
            )
          }
        }

        const stampedEthUsd =
          listing.ethUsdWad != null && listing.ethUsdWad !== '0'
            ? Number(BigInt(listing.ethUsdWad)) / 1e18
            : null

        let usdPerToken: number
        let ethPerToken: number | null = null

        if (activePool === 'side') {
          usdPerToken = usdPerTokenFromSideSlot0(
            sqrtPriceX96,
            key,
            listing.token,
          )
        } else {
          if (liveEthUsd == null || liveEthUsd <= 0) {
            throw new Error('live eth/usd unavailable for main-pool spot')
          }
          ethPerToken = ethPerTokenFromSlot0(sqrtPriceX96, key)
          if (!Number.isFinite(ethPerToken) || ethPerToken <= 0) {
            throw new Error(`bad ethPerToken from slot0: ${ethPerToken}`)
          }
          usdPerToken = ethPerToken * liveEthUsd
        }

        if (!Number.isFinite(usdPerToken) || usdPerToken <= 0) {
          throw new Error(`bad usdPerToken: ${usdPerToken}`)
        }

        // Δ vs start — filing start USD (mcap/supply); unchanged definition.
        const startUsdPerToken = startUsdPerTokenFromMcap(
          listing.startMcap,
          listing.totalSupply,
        )
        const deltaPct =
          startUsdPerToken > 0
            ? ((usdPerToken - startUsdPerToken) / startUsdPerToken) * 100
            : 0
        const supplyHuman = Number(BigInt(listing.totalSupply)) / 1e18
        const mcapNow = usdPerToken * supplyHuman

        if (!cancelled) {
          setSpot({
            usdPerToken,
            startUsdPerToken,
            deltaPct,
            mcapNow,
            activePool,
            liveEthUsd,
            stampedEthUsd,
            ethPerToken,
          })
        }
      } catch (err) {
        console.error(
          '[spot] active pool slot0 failed',
          listing.listing,
          activePool,
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
  }, [activePool, client, listing, visible])

  return spot
}

/** @deprecated alias — cards/tape/bags consume useListingSpot. */
export const useMainPoolSpot = useListingSpot

export function useActiveSwapStore(
  listing: IndexedListing | null | undefined,
): PoolSwapStore | null {
  const { envelope } = useIndex()
  return useMemo(() => {
    if (!listing || !envelope) return null
    return activeStoreForListing(envelope, listing.listing)
  }, [envelope, listing])
}

/** Active-pool price series for charts/sparks (USD). */
export function usePriceSeries(
  listing: IndexedListing | null | undefined,
  liveEthUsd: number | null,
): number[] {
  const store = useActiveSwapStore(listing)
  const { progress } = useIndex()
  const head = progress?.head ?? 0n

  return useMemo(() => {
    if (!listing || !store || store.swapCount === 0) return []
    const usdFromSqrt = (sqrt: bigint) => {
      if (store.kind === 'side') {
        return usdPerTokenFromSideSlot0(sqrt, store.key, listing.token)
      }
      if (liveEthUsd == null || liveEthUsd <= 0) return 0
      return ethPerTokenFromSlot0(sqrt, store.key) * liveEthUsd
    }
    return priceSeriesForPool(store, head > 0n ? head : BigInt(store.cursor), usdFromSqrt)
  }, [head, listing, liveEthUsd, store])
}

/** Start USD used for Δ — also eth×stamp path kept for recon labels. */
export function startUsdFromStamp(
  listing: IndexedListing,
  stampedEthUsd: number | null,
): number {
  if (stampedEthUsd != null && stampedEthUsd > 0) {
    return ethPerTokenFromStartPriceWad(listing.startPriceWad) * stampedEthUsd
  }
  return startUsdPerTokenFromMcap(listing.startMcap, listing.totalSupply)
}
