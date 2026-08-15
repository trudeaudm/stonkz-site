/** Uniswap v4 PoolManager — Swap logs for the swap indexer. */
export const poolManagerSwapAbi = [
  {
    type: 'event',
    name: 'Swap',
    inputs: [
      { name: 'id', type: 'bytes32', indexed: true },
      { name: 'sender', type: 'address', indexed: true },
      { name: 'amount0', type: 'int128', indexed: false },
      { name: 'amount1', type: 'int128', indexed: false },
      { name: 'sqrtPriceX96', type: 'uint160', indexed: false },
      { name: 'liquidity', type: 'uint128', indexed: false },
      { name: 'tick', type: 'int24', indexed: false },
      { name: 'fee', type: 'uint24', indexed: false },
    ],
  },
] as const

/** Canonical topic0 for the v4 Swap event (asserted in the swap scanner). */
export const POOL_SWAP_TOPIC0 =
  ('0x' +
    '40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba' +
    '5563708daca94dd84ad7112f') as `0x${string}`
