/**
 * V4Adapter surface — slot0 reads + generation fingerprint (authorized).
 * Errors from fix/express-mint:contracts/src/v4/V4Adapter.sol + IPoolManager.sol.
 */
export const v4AdapterAbi = [
  {
    type: 'function',
    name: 'getSlot0',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'protocolFee', type: 'uint24' },
      { name: 'lpFee', type: 'uint24' },
    ],
  },
  /**
   * Underlying Uniswap v4 PoolManager (Swap log address).
   * Distinct from factory.poolManager(), which returns this adapter.
   */
  {
    type: 'function',
    name: 'manager',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'authorized',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  // Access control on modifyLiquidity / initialize / pokeCollect (V4 generation)
  { type: 'error', name: 'NotAuthorized', inputs: [] },
  // syncToPrice rejects uninitialized pools (IPoolManager / V4Adapter)
  { type: 'error', name: 'PoolNotInitialized', inputs: [] },
] as const
