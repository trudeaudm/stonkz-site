/**
 * Express factory fingerprint — V2 answers predictTokenAddress; V1/unknown revert.
 */
import {
  getAddress,
  pad,
  toHex,
  type Address,
  type PublicClient,
} from 'viem'
import { expressFactoryAbi } from '../abi/expressFactory'
import { env } from '../config/env'

export const FACTORY_V2_FAIL_COPY =
  'this build points at a factory without v2 pricing — DO NOT FILE. env or deploy is stale.'

/** Probe address for predictTokenAddress — any 20-byte value works; result discarded. */
const FINGERPRINT_PROBE = getAddress(pad(toHex(1), { size: 20 }))

export function shortFactory(addr: Address): string {
  return `0x${addr.slice(2, 6)}…${addr.slice(-4)}`
}

export function factoryV2PassCopy(addr: Address): string {
  return `factory ${shortFactory(addr)} — v2 (usd tiers, token vanity)`
}

/**
 * Returns true when the configured factory implements predictTokenAddress (Express V2).
 * V1 and unknown contracts revert / return empty → false.
 */
export async function fingerprintExpressFactoryV2(
  client: PublicClient,
  factory: Address = env.addrExpressFactory!,
): Promise<boolean> {
  try {
    const predicted = await client.readContract({
      address: factory,
      abi: expressFactoryAbi,
      functionName: 'predictTokenAddress',
      args: [FINGERPRINT_PROBE],
    })
    return typeof predicted === 'string' && /^0x[a-fA-F0-9]{40}$/.test(predicted)
  } catch {
    return false
  }
}
