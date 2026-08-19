import {
  decodeEventLog,
  formatEther,
  parseAbiItem,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { env } from '../config/env'
import type { IndexedListing } from '../indexer/types'
import { resolvePoolManager } from '../indexer/swaps'
import { buildExecuteCalldata, encodeV4ExactInSingle } from './encode'
import type { SupportedRoute } from './router'
import { formatSwapError } from './errors'

/**
 * Hook fee: deployed StonkzFeeHook beforeSwap takes abs(amountSpecified)*bps/10_000
 * in the pair currency on BOTH directions (ExactInHookFeeHarness). Buys: 1% of ETH
 * in. Sells: charged on the token amount sold (absSpec in token wei); the take is
 * still in pair (ETH) units equal to that numeric fee — which can dominate tiny
 * ETH outputs. Display uses input*bps/10_000 in the input currency.
 */
export const HOOK_FEE_BPS = 100n

export type TradeQuote = {
  amountIn: bigint
  amountOut: bigint
  /** amountOut after applying slippage bps (floor). */
  minAmountOut: bigint
  /** Input units taken as hook fee (amountIn * HOOK_FEE_BPS / 10_000). */
  hookFeeAmount: bigint
  /** |execPrice - spotPrice| / spotPrice as fraction (0.01 = 1%). Null if spot unknown. */
  priceImpact: number | null
  /** Output per 1 input (raw ratio, both in native decimals). */
  effectivePrice: number
  gasEstimate: bigint
  quotedAt: number
  route: SupportedRoute
  /** Calldata used for the simulation (amountOutMinimum=0). */
  simCalldata: Hex
  value: bigint
}

export type QuoteFailure = {
  error: string
  quotedAt: number
}

const SWAP_EVENT = parseAbiItem(
  'event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)',
)
const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
)

type SimCallResult = {
  status?: string | number
  error?: { message?: string; data?: Hex }
  gasUsed?: Hex | string
  logs?: Array<{ address: Address; data: Hex; topics: Hex[] }>
}

/**
 * Quote by eth_simulateV1 of UR.execute (never local AMM math) so the hook's
 * beforeSwap take is reflected in the realized output.
 */
export async function quoteExactIn(args: {
  client: PublicClient
  account: Address
  listing: IndexedListing
  route: SupportedRoute
  amountIn: bigint
  slippageBps: bigint
  spotEthPerToken?: number | null
}): Promise<TradeQuote | QuoteFailure> {
  const { client, account, listing, route, amountIn, slippageBps } = args
  const quotedAt = Date.now()
  const ur = env.addrUniversalRouter
  if (!ur) {
    return { error: 'Universal Router address not configured', quotedAt }
  }
  if (amountIn <= 0n) {
    return { error: 'amount must be positive', quotedAt }
  }

  const hop = route.hops[0]
  if (!hop) return { error: 'route has no hops', quotedAt }

  const v4 = encodeV4ExactInSingle({
    poolKey: hop.poolKey,
    zeroForOne: hop.zeroForOne,
    amountIn,
    amountOutMinimum: 0n,
  })
  const simCalldata = buildExecuteCalldata(v4)
  const value = route.valueIsInput ? amountIn : 0n

  try {
    const raw = (await client.request({
      method: 'eth_simulateV1',
      params: [
        {
          blockStateCalls: [
            {
              calls: [
                {
                  from: account,
                  to: ur,
                  data: simCalldata,
                  value: `0x${value.toString(16)}`,
                },
              ],
            },
          ],
        },
        'latest',
      ],
    })) as Array<{ calls: SimCallResult[] }>

    const call = raw?.[0]?.calls?.[0]
    if (!call) return { error: 'simulation returned no call result', quotedAt }

    const status = call.status
    const ok = status === '0x1' || status === 1 || status === '0x01'
    if (!ok) {
      const data = call.error?.data
      const msg = data
        ? formatSwapError({ data })
        : call.error?.message || 'simulation reverted'
      return { error: msg, quotedAt }
    }

    const pm = await resolvePoolManager(client, env.addrExpressFactory!)
    let transferOut = 0n
    let swapOut = 0n
    let sqrtAfter: bigint | null = null

    for (const log of call.logs ?? []) {
      if (log.address.toLowerCase() === listing.token.toLowerCase()) {
        try {
          const d = decodeEventLog({
            abi: [TRANSFER_EVENT],
            data: log.data,
            topics: log.topics,
          })
          if (
            hop.zeroForOne &&
            d.args.to?.toLowerCase() === account.toLowerCase()
          ) {
            transferOut += d.args.value as bigint
          }
        } catch {
          /* not Transfer */
        }
      }
      if (log.address.toLowerCase() === pm.toLowerCase()) {
        try {
          const d = decodeEventLog({
            abi: [SWAP_EVENT],
            data: log.data,
            topics: log.topics,
          })
          sqrtAfter = d.args.sqrtPriceX96 as bigint
          if (!hop.zeroForOne) {
            const a0 = d.args.amount0 as bigint
            if (a0 > 0n) swapOut = a0
          } else {
            const a1 = d.args.amount1 as bigint
            if (a1 > 0n) swapOut = a1
          }
        } catch {
          /* not Swap */
        }
      }
    }

    // Prefer the ERC20 Transfer to the trader; Swap amount is the same
    // event counted once — never add both (tx 0xc9d66975 double-counted
    // ~2× and set amountOutMinimum above the real out).
    const amountOut = hop.zeroForOne
      ? transferOut > 0n
        ? transferOut
        : swapOut
      : swapOut

    if (amountOut <= 0n) {
      return { error: 'simulation succeeded but output was zero', quotedAt }
    }

    const hookFeeAmount = (amountIn * HOOK_FEE_BPS) / 10_000n
    const minAmountOut = amountOut - (amountOut * slippageBps) / 10_000n
    const gasEstimate = call.gasUsed ? BigInt(call.gasUsed) : 350_000n

    const inF = Number(amountIn)
    const outF = Number(amountOut)
    const effectivePrice = inF > 0 ? outF / inF : 0

    let priceImpact: number | null = null
    const spot = args.spotEthPerToken
    if (spot != null && spot > 0 && sqrtAfter != null) {
      // Compare exec vs pre-trade spot (ETH per token).
      const execEthPerToken = hop.zeroForOne
        ? Number(amountIn - hookFeeAmount) / Number(amountOut) // approx ETH spent in pool / tokens
        : Number(amountOut) / Number(amountIn)
      // Better: use spot from args for impact vs current slot0 mid.
      if (hop.zeroForOne) {
        const exec = Number(formatEther(amountIn)) / (Number(amountOut) / 1e18)
        priceImpact = Math.abs(exec - spot) / spot
      } else {
        const exec = Number(amountOut) / 1e18 / (Number(amountIn) / 1e18)
        priceImpact = Math.abs(exec - spot) / spot
      }
    } else if (spot != null && spot > 0) {
      if (hop.zeroForOne) {
        const exec = Number(formatEther(amountIn)) / (Number(amountOut) / 1e18)
        priceImpact = Math.abs(exec - spot) / spot
      } else {
        const exec = Number(amountOut) / 1e18 / (Number(amountIn) / 1e18)
        priceImpact = Math.abs(exec - spot) / spot
      }
    }

    return {
      amountIn,
      amountOut,
      minAmountOut: minAmountOut > 0n ? minAmountOut : 0n,
      hookFeeAmount,
      priceImpact,
      effectivePrice,
      gasEstimate,
      quotedAt,
      route,
      simCalldata,
      value,
    }
  } catch (err) {
    return { error: formatSwapError(err), quotedAt }
  }
}

export function isQuoteSuccess(
  q: TradeQuote | QuoteFailure,
): q is TradeQuote {
  return 'amountOut' in q
}
