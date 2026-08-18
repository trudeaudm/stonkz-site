import { maxUint256, type Address, type PublicClient } from 'viem'
import { erc20ApproveAbi, permit2Abi } from '../abi/permit2'
import { env } from '../config/env'

export type AllowanceState = {
  erc20ToPermit2: bigint
  /** Permit2 allowance amount for UR (uint160). */
  permit2ToUr: bigint
  permit2Expiration: number
  /** Wall-clock: permit2 allowance currently usable for `amount`. */
  permit2Ok: boolean
  needsErc20Approve: boolean
  needsPermit2Approve: boolean
}

const MAX_UINT160 = (1n << 160n) - 1n

/** Default Permit2 expiration: ~30 days from now (uint48). */
export function defaultPermit2Expiration(nowSec = Math.floor(Date.now() / 1000)): number {
  return nowSec + 30 * 24 * 60 * 60
}

/**
 * Detect which sell approval steps are still required for `amount`.
 * Skips any step already sufficient — never ask the user to re-sign needlessly.
 */
export async function readSellAllowances(
  client: PublicClient,
  owner: Address,
  token: Address,
  amount: bigint,
): Promise<AllowanceState | { error: string }> {
  const permit2 = env.addrPermit2
  const ur = env.addrUniversalRouter
  if (!permit2 || !ur) {
    return { error: 'Permit2 or Universal Router address not configured' }
  }

  const [erc20ToPermit2, packed] = await Promise.all([
    client.readContract({
      address: token,
      abi: erc20ApproveAbi,
      functionName: 'allowance',
      args: [owner, permit2],
    }),
    client.readContract({
      address: permit2,
      abi: permit2Abi,
      functionName: 'allowance',
      args: [owner, token, ur],
    }),
  ])

  const permit2ToUr = packed[0]
  const permit2Expiration = Number(packed[1])
  const now = Math.floor(Date.now() / 1000)
  const need = amount > MAX_UINT160 ? MAX_UINT160 : amount
  const permit2Ok =
    permit2ToUr >= need && permit2Expiration > now

  return {
    erc20ToPermit2,
    permit2ToUr,
    permit2Expiration,
    permit2Ok,
    needsErc20Approve: erc20ToPermit2 < amount,
    needsPermit2Approve: !permit2Ok,
  }
}

export { maxUint256, MAX_UINT160 }
