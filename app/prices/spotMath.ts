import {
  encodeAbiParameters,
  keccak256,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'
import type { MainPoolKey } from '../indexer/types'

/** PoolId = keccak256(abi.encode(PoolKey)) — same as PoolIdLibrary.toId. */
export function poolIdFromKey(key: MainPoolKey): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'address' },
        { type: 'uint24' },
        { type: 'int24' },
        { type: 'address' },
      ],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  )
}

/**
 * Uniswap v4 sqrtPriceX96 → token1/token0 (raw, equal-decimals).
 * ETH is address(0) and is always currency0 when paired with a token.
 */
export function sqrtPriceX96ToToken1PerToken0(sqrtPriceX96: bigint): number {
  if (sqrtPriceX96 === 0n) return 0
  const r = Number(sqrtPriceX96) / 2 ** 96
  return r * r
}

/** ETH per whole token, oriented from PoolKey. */
export function ethPerTokenFromSlot0(
  sqrtPriceX96: bigint,
  key: MainPoolKey,
): number {
  const token1PerToken0 = sqrtPriceX96ToToken1PerToken0(sqrtPriceX96)
  if (token1PerToken0 <= 0 || !Number.isFinite(token1PerToken0)) return 0
  const ethIs0 = key.currency0.toLowerCase() === zeroAddress
  // ethIs0: token1/token0 = tokens per ETH → eth/token = 1 / that
  // else:   token1/token0 = ETH per token
  return ethIs0 ? 1 / token1PerToken0 : token1PerToken0
}

/**
 * USDG (6 dec) side pool → USD per whole token.
 * USDG = $1 ruling — no ETH rate. Orient by which currency is the launch token.
 */
export function usdPerTokenFromSideSlot0(
  sqrtPriceX96: bigint,
  key: MainPoolKey,
  token: Address,
  tokenDecimals = 18,
  usdgDecimals = 6,
): number {
  const t1PerT0 = sqrtPriceX96ToToken1PerToken0(sqrtPriceX96)
  if (t1PerT0 <= 0 || !Number.isFinite(t1PerT0)) return 0
  const tok0 = key.currency0.toLowerCase() === token.toLowerCase()
  // If token is c0 (18) and USDG is c1 (6): human USDG per token = t1PerT0 * 10^(18-6)
  // If USDG is c0 (6) and token is c1 (18): invert after decimal adjust.
  if (tok0) {
    return t1PerT0 * 10 ** (tokenDecimals - usdgDecimals)
  }
  const tokenPerUsdg = t1PerT0 * 10 ** (usdgDecimals - tokenDecimals)
  if (tokenPerUsdg <= 0) return 0
  return 1 / tokenPerUsdg
}

/** startPriceWad = pair-wei per token (WAD) → ETH per token. */
export function ethPerTokenFromStartPriceWad(
  startPriceWad: bigint | string,
): number {
  const w =
    typeof startPriceWad === 'string' ? BigInt(startPriceWad) : startPriceWad
  return Number(w) / 1e18
}

/** Filing start USD/token from startMcap / totalSupply (both wad-scaled). */
export function startUsdPerTokenFromMcap(
  startMcap: string | bigint,
  totalSupply: string | bigint,
): number {
  const m = typeof startMcap === 'string' ? BigInt(startMcap) : startMcap
  const s = typeof totalSupply === 'string' ? BigInt(totalSupply) : totalSupply
  if (s === 0n) return 0
  return Number(m) / Number(s)
}

export function formatUsdSpot(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '—'
  if (usd >= 1) return `$${usd.toPrecision(4)}`
  if (usd >= 0.0001) return `$${usd.toPrecision(4)}`
  return `$${usd.toExponential(2)}`
}

export function formatDeltaPct(deltaPct: number): string {
  const abs = Math.abs(deltaPct)
  const body = abs >= 10 ? abs.toFixed(0) : abs.toFixed(1)
  return `${deltaPct >= 0 ? '▲' : '▼'}${body}%`
}

export function formatMcapUsd(mcap: number): string {
  if (!Number.isFinite(mcap) || mcap <= 0) return '—'
  if (mcap >= 1_000_000) return `$${(mcap / 1_000_000).toPrecision(3)}M`
  if (mcap >= 1_000) return `$${Math.round(mcap).toLocaleString()}`
  return `$${mcap.toPrecision(3)}`
}

/** Gross pair volume → USD label. Side = USDG raw/1e6; main = ETH * liveRate. */
export function pairVolumeUsd(
  volumePairRaw: string,
  kind: 'main' | 'side',
  liveEthUsd: number | null,
): number | null {
  const raw = BigInt(volumePairRaw)
  if (kind === 'side') return Number(raw) / 1e6
  if (liveEthUsd == null || liveEthUsd <= 0) return null
  return (Number(raw) / 1e18) * liveEthUsd
}
