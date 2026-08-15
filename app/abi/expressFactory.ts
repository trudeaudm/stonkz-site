/**
 * Minimal Express factory ABI — field order pinned to NOTES.md 0f + Express V2.
 * No address literals; consumers pass env.addrExpressFactory.
 *
 * ListingParams (verbatim StonkzDirectListing.sol @ fix/express-pricing):
 *   startMcap, totalSupply, creatorReserveBps, deliveryMode, vestDuration,
 *   declaredUse, creator, name, symbol, createSidePool, sidePoolBps,
 *   liquidityLocked, refPriceWad, ethUsdWad
 */
const listingParamsComponents = [
  { name: 'startMcap', type: 'uint256' },
  { name: 'totalSupply', type: 'uint256' },
  { name: 'creatorReserveBps', type: 'uint16' },
  { name: 'deliveryMode', type: 'uint8' },
  { name: 'vestDuration', type: 'uint64' },
  { name: 'declaredUse', type: 'bytes32' },
  { name: 'creator', type: 'address' },
  { name: 'name', type: 'string' },
  { name: 'symbol', type: 'string' },
  { name: 'createSidePool', type: 'bool' },
  { name: 'sidePoolBps', type: 'uint16' },
  { name: 'liquidityLocked', type: 'bool' },
  { name: 'refPriceWad', type: 'uint256' },
  { name: 'ethUsdWad', type: 'uint256' },
] as const

export const expressFactoryAbi = [
  {
    type: 'function',
    name: 'list',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'p',
        type: 'tuple',
        components: listingParamsComponents,
      },
      { name: 'userSalt', type: 'bytes32' },
    ],
    outputs: [{ name: 'listing', type: 'address' }],
  },
  {
    type: 'function',
    name: 'listingSalt',
    stateMutability: 'pure',
    inputs: [
      { name: 'deployer', type: 'address' },
      { name: 'userSalt', type: 'bytes32' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'listingInitCodeHash',
    stateMutability: 'view',
    inputs: [
      {
        name: 'p',
        type: 'tuple',
        components: listingParamsComponents,
      },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'predictListingAddress',
    stateMutability: 'view',
    inputs: [
      { name: 'deployer', type: 'address' },
      { name: 'userSalt', type: 'bytes32' },
      { name: 'initCodeHash', type: 'bytes32' },
    ],
    outputs: [{ name: 'predicted', type: 'address' }],
  },
  {
    type: 'function',
    name: 'predictTokenAddress',
    stateMutability: 'pure',
    inputs: [{ name: 'predictedListing', type: 'address' }],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'currentEthUsdWad',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'deploysEnabled',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'isDeployerAllowed',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowlistCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'defaultCreateSidePool',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'defaultSidePoolBps',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint16' }],
  },
  {
    type: 'function',
    name: 'defaultLiquidityLocked',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'refPriceWad',
    stateMutability: 'view',
    inputs: [
      { name: 'sideToken', type: 'address' },
      { name: 'pairCurrency', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'refPriceConfigured',
    stateMutability: 'view',
    inputs: [
      { name: 'sideToken', type: 'address' },
      { name: 'pairCurrency', type: 'address' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'sideTokenRef',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'pairToken',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'hook',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'feeLocker',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  // deployed factory (disk build) — see stonkz-deployed-truth.md Part 3; absent at repo HEAD
  {
    type: 'function',
    name: 'listingCreationPtr0',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  // deployed factory (disk build) — see stonkz-deployed-truth.md Part 3; absent at repo HEAD
  {
    type: 'function',
    name: 'listingCreationPtr1',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'event',
    name: 'ExpressListed',
    inputs: [
      { name: 'listing', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'userSalt', type: 'bytes32', indexed: false },
      { name: 'salt', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'error',
    name: 'VanityPrefixMismatch',
    inputs: [{ name: 'predicted', type: 'address' }],
  },
  { type: 'error', name: 'NotOwner', inputs: [] },
  { type: 'error', name: 'DeploysOff', inputs: [] },
  { type: 'error', name: 'DeployerNotAllowed', inputs: [] },
  { type: 'error', name: 'ZeroAddress', inputs: [] },
  { type: 'error', name: 'AlreadyAllowed', inputs: [] },
  { type: 'error', name: 'NotOnAllowlist', inputs: [] },
  {
    type: 'error',
    name: 'SidePoolBpsOutOfBounds',
    inputs: [{ name: 'bps', type: 'uint16' }],
  },
  {
    type: 'error',
    name: 'RefPriceOutOfBounds',
    inputs: [
      { name: 'pairCurrency', type: 'address' },
      { name: 'price', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'RefPriceUnset',
    inputs: [
      { name: 'sideToken', type: 'address' },
      { name: 'pairCurrency', type: 'address' },
    ],
  },
  // Express V2 — DeployControls two-pool ETH/USD surface
  { type: 'error', name: 'RefPoolUnset', inputs: [] },
  {
    type: 'error',
    name: 'RefPoolEmpty',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
  },
  {
    type: 'error',
    name: 'RefPoolsDisagree',
    inputs: [
      { name: 'primaryWad', type: 'uint256' },
      { name: 'checkWad', type: 'uint256' },
    ],
  },
  // Decode surface for EthUsd* (map to "ETH/USD reference not configured")
  { type: 'error', name: 'EthUsdUnset', inputs: [] },
  {
    type: 'error',
    name: 'EthUsdOutOfBand',
    inputs: [
      { name: 'value', type: 'uint256' },
      { name: 'bound', type: 'uint256' },
    ],
  },
  // deployed factory (disk build) — see stonkz-deployed-truth.md Part 3; absent at repo HEAD
  // selector 0x08586462
  { type: 'error', name: 'ListingCreateFailed', inputs: [] },
  // deployed factory (disk build) — see stonkz-deployed-truth.md Part 3; absent at repo HEAD
  // selector 0x2947850f — decode-only; shared so a future ladder module inherits it
  { type: 'error', name: 'AuctionCreateFailed', inputs: [] },
  // deployed factory (disk build) — see stonkz-deployed-truth.md Part 3; absent at repo HEAD
  // bubbled from CreationCodeStore
  { type: 'error', name: 'EmptyCreationCode', inputs: [] },
  // deployed factory (disk build) — see stonkz-deployed-truth.md Part 3; absent at repo HEAD
  { type: 'error', name: 'CreationCodeTooLarge', inputs: [] },
  // deployed factory (disk build) — see stonkz-deployed-truth.md Part 3; absent at repo HEAD
  { type: 'error', name: 'CreationCodePointerMissing', inputs: [] },
] as const

/**
 * Shared create / CreationCodeStore errors — Express consumes them today;
 * ladder modules should spread this list for AuctionCreateFailed decode.
 * Provenance: deployed factory (disk build) — see stonkz-deployed-truth.md Part 3; absent at repo HEAD.
 */
export const sharedFactoryCreateErrors = [
  { type: 'error', name: 'AuctionCreateFailed', inputs: [] },
  { type: 'error', name: 'EmptyCreationCode', inputs: [] },
  { type: 'error', name: 'CreationCodeTooLarge', inputs: [] },
  { type: 'error', name: 'CreationCodePointerMissing', inputs: [] },
] as const

export const expressListedEvent = expressFactoryAbi.find(
  (x): x is Extract<(typeof expressFactoryAbi)[number], { type: 'event'; name: 'ExpressListed' }> =>
    x.type === 'event' && x.name === 'ExpressListed',
)!

export type ListingParams = {
  startMcap: bigint
  totalSupply: bigint
  creatorReserveBps: number
  deliveryMode: number
  vestDuration: bigint
  declaredUse: `0x${string}`
  creator: `0x${string}`
  name: string
  symbol: string
  createSidePool: boolean
  sidePoolBps: number
  liquidityLocked: boolean
  refPriceWad: bigint
  /** Caller sends 0; Express `_stampListingParams` sets `p.ethUsdWad = currentEthUsdWad()`. */
  ethUsdWad: bigint
}
