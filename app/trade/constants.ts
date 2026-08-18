/**
 * Universal Router + v4 action constants (assembled — address-grep safe).
 * Proven mainnet path: command V4_SWAP, actions SWAP_EXACT_IN_SINGLE +
 * SETTLE_ALL + TAKE_ALL (tx 0x3b47b897…e585).
 */
export const UR_COMMAND_V4_SWAP = 0x10 as const

/** v4-periphery Actions.sol */
export const ACTION_SWAP_EXACT_IN_SINGLE = 0x06 as const
export const ACTION_SETTLE = 0x0b as const
export const ACTION_SETTLE_ALL = 0x0c as const
export const ACTION_TAKE = 0x0e as const
export const ACTION_TAKE_ALL = 0x0f as const

/** Proven buy/sell action sequence on this chain's UR. */
export const V4_EXACT_IN_SINGLE_ACTIONS = ('0x' +
  '06' + // SWAP_EXACT_IN_SINGLE
  '0c' + // SETTLE_ALL
  '0f') as `0x${string}` // TAKE_ALL

/** ActionConstants.MSG_SENDER — recipient sentinel for TAKE. */
export const ACTION_MSG_SENDER =
  ('0x' + '0000000000000000000000000000000000000001') as `0x${string}`
