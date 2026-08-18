import { decodeErrorResult, type Hex } from 'viem'
import { universalRouterAbi } from '../abi/universalRouter'
import { permit2Abi } from '../abi/permit2'
import { formatPipelineError } from '../express/useLaunch'

/**
 * Swap-path errors from deployed sources (express-v4-deploy-2026-08 +
 * pinned v4-core/v4-periphery + Permit2). Names only — no invented selectors.
 */
const swapErrorAbi = [
  ...universalRouterAbi.filter((x) => x.type === 'error'),
  ...permit2Abi.filter((x) => x.type === 'error'),
  // StonkzFeeHook.sol @ express-v4-deploy-2026-08
  { type: 'error', name: 'AlreadyRegistered', inputs: [] },
  { type: 'error', name: 'NotFeeReceiver', inputs: [] },
  { type: 'error', name: 'CTOActiveBlocked', inputs: [] },
  { type: 'error', name: 'OnlyGovernor', inputs: [] },
  { type: 'error', name: 'OnlyOwner', inputs: [] },
  {
    type: 'error',
    name: 'HookFeeBpsOutOfBounds',
    inputs: [{ name: 'bps', type: 'uint16' }],
  },
  {
    type: 'error',
    name: 'ProtocolFeeBpsOutOfBounds',
    inputs: [{ name: 'bps', type: 'uint16' }],
  },
  { type: 'error', name: 'ForcedAccrueFail', inputs: [] },
  { type: 'error', name: 'OnlySelf', inputs: [] },
  { type: 'error', name: 'KeyHooksMismatch', inputs: [] },
  // IPoolManager.sol @ v4-core pin
  { type: 'error', name: 'CurrencyNotSettled', inputs: [] },
  { type: 'error', name: 'PoolNotInitialized', inputs: [] },
  { type: 'error', name: 'AlreadyUnlocked', inputs: [] },
  { type: 'error', name: 'ManagerLocked', inputs: [] },
  {
    type: 'error',
    name: 'TickSpacingTooLarge',
    inputs: [{ name: 'tickSpacing', type: 'int24' }],
  },
  {
    type: 'error',
    name: 'TickSpacingTooSmall',
    inputs: [{ name: 'tickSpacing', type: 'int24' }],
  },
  {
    type: 'error',
    name: 'CurrenciesOutOfOrderOrEqual',
    inputs: [
      { name: 'currency0', type: 'address' },
      { name: 'currency1', type: 'address' },
    ],
  },
  { type: 'error', name: 'UnauthorizedDynamicLPFeeUpdate', inputs: [] },
  { type: 'error', name: 'SwapAmountCannotBeZero', inputs: [] },
  { type: 'error', name: 'NonzeroNativeValue', inputs: [] },
  { type: 'error', name: 'MustClearExactPositiveDelta', inputs: [] },
  // Pool.sol
  {
    type: 'error',
    name: 'PriceLimitAlreadyExceeded',
    inputs: [
      { name: 'sqrtPriceCurrentX96', type: 'uint160' },
      { name: 'sqrtPriceLimitX96', type: 'uint160' },
    ],
  },
  {
    type: 'error',
    name: 'PriceLimitOutOfBounds',
    inputs: [{ name: 'sqrtPriceLimitX96', type: 'uint160' }],
  },
  { type: 'error', name: 'NoLiquidityToReceiveFees', inputs: [] },
  { type: 'error', name: 'InvalidFeeForExactOut', inputs: [] },
  { type: 'error', name: 'SafeCastOverflow', inputs: [] },
  // IV4Router.sol @ v4-periphery pin
  {
    type: 'error',
    name: 'V4TooLittleReceived',
    inputs: [
      { name: 'minAmountOutReceived', type: 'uint256' },
      { name: 'amountReceived', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'V4TooMuchRequested',
    inputs: [
      { name: 'maxAmountInRequested', type: 'uint256' },
      { name: 'amountRequested', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'V4TooLittleReceivedPerHopSingle',
    inputs: [
      { name: 'minPrice', type: 'uint256' },
      { name: 'price', type: 'uint256' },
    ],
  },
  { type: 'error', name: 'UnsupportedAction', inputs: [{ name: 'action', type: 'uint256' }] },
  { type: 'error', name: 'DeltaNotPositive', inputs: [{ name: 'currency', type: 'address' }] },
  { type: 'error', name: 'DeltaNotNegative', inputs: [{ name: 'currency', type: 'address' }] },
  { type: 'error', name: 'InsufficientBalance', inputs: [] },
  { type: 'error', name: 'NotPoolManager', inputs: [] },
  { type: 'error', name: 'SliceOutOfBounds', inputs: [] },
] as const

function extractRaw(err: unknown): Hex | null {
  if (typeof err === 'string' && err.startsWith('0x') && err.length >= 10) {
    return err as Hex
  }
  if (err && typeof err === 'object' && 'data' in err) {
    const d = (err as { data?: unknown }).data
    if (typeof d === 'string' && d.startsWith('0x') && d.length >= 10) {
      return d as Hex
    }
  }
  return null
}

/** Decode UR / v4 / Permit2 / hook reverts; fall back to pipeline + raw selector. */
export function formatSwapError(err: unknown): string {
  const raw = extractRaw(err)
  if (raw) {
    try {
      const decoded = decodeErrorResult({ abi: swapErrorAbi, data: raw })
      if (decoded.args && decoded.args.length > 0) {
        return `${decoded.errorName}(${decoded.args.map(String).join(', ')})`
      }
      return decoded.errorName
    } catch {
      return `unrecognized revert selector=${raw.slice(0, 10)} data=${raw}`
    }
  }
  return formatPipelineError(err)
}
