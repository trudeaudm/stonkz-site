import { zeroAddress, type Address } from 'viem'
import type { IndexedListing, MainPoolKey } from '../indexer/types'

export type TradeHop = {
  poolKey: MainPoolKey
  zeroForOne: boolean
  /** Pool charges StonkzFeeHook beforeSwap (absSpec * bps). */
  hookFee: boolean
}

export type SupportedRoute = {
  kind: 'supported'
  /** Human label for the panel. */
  label: string
  inputCurrency: Address
  outputCurrency: Address
  hops: TradeHop[]
  /** Expected UR command shape — single V4_SWAP today. */
  calldataShape: 'ur-v4-exact-in-single'
  /** Native ETH must be sent as msg.value on execute. */
  valueIsInput: boolean
}

export type UnsupportedRoute = {
  kind: 'unsupported'
  reason: string
}

export type Route = SupportedRoute | UnsupportedRoute

/**
 * Resolve a swap route for a listing.
 *
 * TODAY: only ETH ↔ launch-token on the MAIN pool (listing.mainPoolKey).
 * Side pool is never offered in the UI — arb bots balance it.
 *
 * GENESIS STUBS (not built): when sideTokenRef becomes STONKZ, compare
 * STONKZ→ETH→token multi-hop vs STONKZ→token direct via the side pool
 * (and the reverse). Return UnsupportedRoute until those branches land.
 */
export function resolveRoute(
  inputCurrency: Address,
  outputCurrency: Address,
  listing: IndexedListing,
): Route {
  const eth = zeroAddress
  const token = listing.token
  const inL = inputCurrency.toLowerCase()
  const outL = outputCurrency.toLowerCase()
  const ethL = eth.toLowerCase()
  const tokL = token.toLowerCase()

  if (inL === outL) {
    return { kind: 'unsupported', reason: 'input and output are the same currency' }
  }

  // ── live: ETH → token (buy) ──────────────────────────────────────────
  if (inL === ethL && outL === tokL) {
    return {
      kind: 'supported',
      label: 'ETH → token · main pool',
      inputCurrency: eth,
      outputCurrency: token,
      hops: [
        {
          poolKey: listing.mainPoolKey,
          zeroForOne: true,
          hookFee: true,
        },
      ],
      calldataShape: 'ur-v4-exact-in-single',
      valueIsInput: true,
    }
  }

  // ── live: token → ETH (sell) ─────────────────────────────────────────
  if (inL === tokL && outL === ethL) {
    return {
      kind: 'supported',
      label: 'token → ETH · main pool',
      inputCurrency: token,
      outputCurrency: eth,
      hops: [
        {
          poolKey: listing.mainPoolKey,
          zeroForOne: false,
          hookFee: true,
        },
      ],
      calldataShape: 'ur-v4-exact-in-single',
      valueIsInput: false,
    }
  }

  // ── genesis stubs (STONKZ) — intentionally unsupported ───────────────
  // When STONKZ exists as sideTokenRef:
  //   STONKZ → token: compare STONKZ→ETH→token vs STONKZ→token (side pool)
  //   token → STONKZ: reverse of the above
  // Until then sideTokenRef is USDG and there is no STONKZ.
  if (listing.sidePoolKey) {
    const side0 = listing.sidePoolKey.currency0.toLowerCase()
    const side1 = listing.sidePoolKey.currency1.toLowerCase()
    if (
      (inL === side0 || inL === side1 || outL === side0 || outL === side1) &&
      inL !== ethL &&
      outL !== ethL
    ) {
      return {
        kind: 'unsupported',
        reason:
          'STONKZ-denominated routes are not live yet — only ETH↔token on the main pool',
      }
    }
  }

  return {
    kind: 'unsupported',
    reason: 'no route — only ETH↔token on the main pool is live',
  }
}
