/**
 * Express factory fingerprint — V3 answers ethUsdStampBandBps; V2/V1/unknown revert.
 */
import { type Address, type PublicClient } from 'viem'
import { expressFactoryAbi } from '../abi/expressFactory'
import { env } from '../config/env'

/** Same hard-block copy as step 15 — stale env / orphaned factory. */
export const FACTORY_V2_FAIL_COPY =
  'this build points at a factory without v2 pricing — DO NOT FILE. env or deploy is stale.'

export function shortFactory(addr: Address): string {
  return `0x${addr.slice(2, 6)}…${addr.slice(-4)}`
}

export function factoryV3PassCopy(addr: Address, bandBps: bigint): string {
  return `factory ${shortFactory(addr)} — v3 (supplied rate, drift band ${bandBps.toString()} bps)`
}

/**
 * Returns drift band (bps) when the configured factory is Express V3.
 * V2 / V1 / unknown revert on ethUsdStampBandBps → null.
 */
export async function fingerprintExpressFactoryV3(
  client: PublicClient,
  factory: Address = env.addrExpressFactory!,
): Promise<bigint | null> {
  try {
    const band = await client.readContract({
      address: factory,
      abi: expressFactoryAbi,
      functionName: 'ethUsdStampBandBps',
    })
    if (typeof band === 'bigint') return band
    if (typeof band === 'number' && Number.isFinite(band)) return BigInt(band)
    return null
  } catch {
    return null
  }
}
