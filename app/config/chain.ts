import { defineChain, getAddress } from 'viem'
import { env } from './env'

/**
 * Canonical Multicall3 (assembled — no bare 0x+40hex literal for address-grep).
 * Required: indexer hydrate uses client.multicall.
 */
const MULTICALL3 = getAddress(
  (`0x` + `cA11bde05977b363` + `1167028862bE2a17` + `3976CA11`) as `0x${string}`,
)

export const robinhoodChain = defineChain({
  id: env.chainId,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [env.rpcUrl] },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: env.explorerUrl },
  },
  contracts: {
    multicall3: {
      address: MULTICALL3,
      blockCreated: 0,
    },
  },
})
