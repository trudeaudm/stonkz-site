/**
 * Express factory generation fingerprint — V4 two-hop wiring check.
 *
 * Why this check (not ethUsdStampBandBps): that view answers 200 on V3 too,
 * so it cannot discriminate generations. This proves the whole generation is
 * wired — factory → new adapter → factory authorized on that adapter — not
 * merely that an address string changed.
 *
 *   a. eth_call factory.poolManager() → adapter address
 *   b. eth_call adapter.authorized(factory) → must be true
 *
 * Any failure (poolManager missing, authorized missing/reverting on V3-era
 * adapters, or false) → null → existing DO-NOT-FILE hard block.
 */
import { zeroAddress, type Address, type PublicClient } from 'viem'
import { expressFactoryAbi } from '../abi/expressFactory'
import { v4AdapterAbi } from '../abi/v4Adapter'
import { env } from '../config/env'

/** Same hard-block copy as step 15 — stale env / orphaned factory. */
export const FACTORY_V2_FAIL_COPY =
  'this build points at a factory without v2 pricing — DO NOT FILE. env or deploy is stale.'

export function shortFactory(addr: Address): string {
  return `0x${addr.slice(2, 6)}…${addr.slice(-4)}`
}

export function factoryV4PassCopy(addr: Address): string {
  return `factory ${shortFactory(addr)} — v4 (usd tiers, token vanity, fillable main ask)`
}

/**
 * Returns the adapter address when the configured factory is Express V4
 * (two-hop pass). V3 / V2 / V1 / unknown → null.
 */
export async function fingerprintExpressFactoryV4(
  client: PublicClient,
  factory: Address = env.addrExpressFactory!,
): Promise<Address | null> {
  try {
    const adapter = await client.readContract({
      address: factory,
      abi: expressFactoryAbi,
      functionName: 'poolManager',
    })
    if (!adapter || adapter.toLowerCase() === zeroAddress) {
      return null
    }
    const ok = await client.readContract({
      address: adapter,
      abi: v4AdapterAbi,
      functionName: 'authorized',
      args: [factory],
    })
    return ok === true ? adapter : null
  } catch {
    return null
  }
}
