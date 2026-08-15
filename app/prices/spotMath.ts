import { encodeAbiParameters, keccak256, zeroAddress, type Hex } from 'viem'
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

/** startPriceWad = pair-wei per token (WAD) → ETH per token. */
export function ethPerTokenFromStartPriceWad(startPriceWad: bigint | string): number {
  const w = typeof startPriceWad === 'string' ? BigInt(startPriceWad) : startPriceWad
  return Number(w) / 1e18
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
