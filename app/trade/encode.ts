import {
  encodeAbiParameters,
  encodeFunctionData,
  maxUint256,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'
import { universalRouterAbi } from '../abi/universalRouter'
import type { MainPoolKey } from '../indexer/types'
import { V4_EXACT_IN_SINGLE_ACTIONS, UR_COMMAND_V4_SWAP } from './constants'

export type ExactInSingleParams = {
  poolKey: MainPoolKey
  zeroForOne: boolean
  amountIn: bigint
  amountOutMinimum: bigint
  hookData?: Hex
}

/**
 * Encode V4_SWAP input: actions + params for SWAP_EXACT_IN_SINGLE /
 * SETTLE_ALL / TAKE_ALL — matches the proven buy calldata layout.
 */
export function encodeV4ExactInSingle(
  p: ExactInSingleParams,
): Hex {
  const hookData = p.hookData ?? ('0x' as Hex)
  const currencyIn = p.zeroForOne
    ? p.poolKey.currency0
    : p.poolKey.currency1
  const currencyOut = p.zeroForOne
    ? p.poolKey.currency1
    : p.poolKey.currency0

  const exactIn = encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          {
            name: 'poolKey',
            type: 'tuple',
            components: [
              { name: 'currency0', type: 'address' },
              { name: 'currency1', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
            ],
          },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'amountIn', type: 'uint128' },
          { name: 'amountOutMinimum', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    [
      [
        [
          p.poolKey.currency0,
          p.poolKey.currency1,
          p.poolKey.fee,
          p.poolKey.tickSpacing,
          p.poolKey.hooks,
        ],
        p.zeroForOne,
        p.amountIn,
        p.amountOutMinimum,
        hookData,
      ],
    ],
  )

  const settleAll = encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }],
    [currencyIn, p.amountIn],
  )
  const takeAll = encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }],
    [currencyOut, 0n],
  )

  return encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'bytes[]' }],
    [V4_EXACT_IN_SINGLE_ACTIONS, [exactIn, settleAll, takeAll]],
  )
}

export function buildExecuteCalldata(
  v4Input: Hex,
  deadline: bigint = maxUint256,
): Hex {
  const commands = (`0x` +
    UR_COMMAND_V4_SWAP.toString(16).padStart(2, '0')) as Hex
  return encodeFunctionData({
    abi: universalRouterAbi,
    functionName: 'execute',
    args: [commands, [v4Input], deadline],
  })
}

export function isNative(currency: Address): boolean {
  return currency.toLowerCase() === zeroAddress
}
