import type { PublicClient } from 'viem'
import { env } from '../config/env'

/**
 * Ceiling over measured list() gas ~5.43–5.45M
 * (fork block 35828651, stonkz-buffer-sim.md).
 */
export const GAS_UNITS_LIST = 6_000_000n

export type ListCostEstimate = {
  perGasWei: bigint
  gasCostWei: bigint
  /** settle buffer + 1.5× gas cost (margin on gas only). */
  requiredWei: bigint
  bufferWei: bigint
}

function defaultBufferWei(): bigint {
  return BigInt(env.listBufferWei)
}

async function readPerGasWei(publicClient: PublicClient): Promise<bigint> {
  try {
    const fees = await publicClient.estimateFeesPerGas()
    const eip1559 =
      fees.maxFeePerGas ??
      ('gasPrice' in fees ? (fees as { gasPrice?: bigint }).gasPrice : undefined)
    if (eip1559 != null && eip1559 > 0n) return eip1559
  } catch {
    /* fall through */
  }
  const gp = await publicClient.getGasPrice()
  if (gp <= 0n) throw new Error('gas price unavailable')
  return gp
}

export async function getListCostEstimate(
  publicClient: PublicClient,
  bufferWei: bigint = defaultBufferWei(),
): Promise<ListCostEstimate> {
  const perGasWei = await readPerGasWei(publicClient)
  const gasCostWei = GAS_UNITS_LIST * perGasWei
  // 1.5× margin on gas only; buffer already carries ~10× measured settle.
  const requiredWei = bufferWei + (gasCostWei * 3n) / 2n
  return { perGasWei, gasCostWei, requiredWei, bufferWei }
}

/** ETH decimal string with ~6 significant figures (estimate display). */
export function formatEthSig(wei: bigint, sigFigs = 6): string {
  if (wei === 0n) return '0'
  const neg = wei < 0n
  const abs = neg ? -wei : wei
  const whole = abs / 10n ** 18n
  const frac = abs % 10n ** 18n
  const raw = `${whole}.${frac.toString().padStart(18, '0')}`
  const n = Number(raw)
  if (!Number.isFinite(n) || n === 0) {
    const s = raw.replace(/0+$/, '').replace(/\.$/, '')
    return neg ? `-${s}` : s
  }
  let out = n.toPrecision(sigFigs)
  if (out.includes('e') || out.includes('E')) {
    out = n.toFixed(18).replace(/0+$/, '').replace(/\.$/, '')
  } else {
    out = out.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '')
  }
  return neg ? `-${out}` : out
}
