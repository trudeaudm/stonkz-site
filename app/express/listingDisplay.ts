/**
 * Listing economics display — V2 uses stamped ethUsdWad; V1-era objects are labeled honestly.
 */
import { formatEther } from 'viem'

const TIER_4K = 4000n * 10n ** 18n
const TIER_8K = 8000n * 10n ** 18n

export function isV2UsdStamp(ethUsdWad: bigint | null | undefined): boolean {
  return ethUsdWad != null && ethUsdWad > 0n
}

/** Human USD-per-ETH from WAD. */
export function formatEthUsdRate(ethUsdWad: bigint): string {
  return (Number(ethUsdWad) / 1e18).toFixed(2)
}

/**
 * Start mcap line.
 * V2 (nonzero ethUsdWad): "$4,000" / "$8,000" (usd) — no "(pair units)".
 * V1 (absent/zero): factual orphaned-factory label.
 */
export function formatStartMcapLine(
  startMcap: bigint | string,
  ethUsdWad: bigint | null | undefined,
): string {
  const mcap = typeof startMcap === 'string' ? BigInt(startMcap) : startMcap
  if (isV2UsdStamp(ethUsdWad)) {
    if (mcap === TIER_4K) return 'start mcap $4,000'
    if (mcap === TIER_8K) return 'start mcap $8,000'
    return `start mcap $${formatEther(mcap)}`
  }
  return `start mcap ${formatEther(mcap)} pair units (v1 — mispriced, orphaned factory)`
}

export function formatStampedEthUsdLine(ethUsdWad: bigint): string {
  return `stamped @ $${formatEthUsdRate(ethUsdWad)}/ETH`
}

/**
 * Start price as $/token when ethUsdWad is known.
 * startPriceWad = pair-wei per token (WAD); × ethUsdWad / 1e36 → USD per token.
 */
export function formatStartPriceUsdLine(
  startPriceWad: bigint | string,
  ethUsdWad: bigint,
): string {
  const price = typeof startPriceWad === 'string' ? BigInt(startPriceWad) : startPriceWad
  const usdPerToken = Number(price * ethUsdWad) / 1e36
  const text =
    usdPerToken >= 0.01
      ? usdPerToken.toFixed(4)
      : usdPerToken.toExponential(3)
  return `start price ≈ $${text}/token`
}
