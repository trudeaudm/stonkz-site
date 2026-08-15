/**
 * CREATE2 / listingSalt / token CREATE helpers — formulas cited to NOTES.md 0b/0d/0e
 * and Express V2 `predictTokenAddress` (CREATE nonce-1 from listing).
 */
import {
  concat,
  encodeAbiParameters,
  getAddress,
  getContractAddress,
  getCreate2Address,
  hexToBytes,
  keccak256,
  numberToHex,
  toBytes,
  toHex,
  type Address,
  type Hex,
} from 'viem'

/** NOTES.md 0e — Vanity.PREFIX = 0x4663 (top 2 bytes / 4 nibbles). Express V2: TOKEN address. */
export const VANITY_PREFIX = '4663'

/** Historical fork-test constant (1 ETH) — superseded by env.listBufferWei (1e6 wei). */
export const ETH_LIST_BUFFER_DEFAULT_WEI = 1_000_000n

/** NOTES.md 0b — keccak256(abi.encode(deployer, userSalt)). */
export function listingSalt(deployer: Address, userSalt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'bytes32' }],
      [deployer, userSalt],
    ),
  )
}

/**
 * NOTES.md 0d — standard CREATE2 with factory as deployer:
 * address(uint160(uint256(keccak256(0xff ++ factory ++ salt ++ initCodeHash))))
 */
export function predictCreate2(
  factory: Address,
  salt: Hex,
  initCodeHash: Hex,
): Address {
  return getCreate2Address({
    from: factory,
    salt,
    bytecodeHash: initCodeHash,
  })
}

export function predictListingAddressLocal(
  factory: Address,
  deployer: Address,
  userSalt: Hex,
  initCodeHash: Hex,
): Address {
  const salt = listingSalt(deployer, userSalt)
  return predictCreate2(factory, salt, initCodeHash)
}

/**
 * Express V2 — token = CREATE at listing nonce 1.
 * RLP([listing, 1]) = 0xd6 || 0x94 || listing || 0x01 (20-byte addr, nonce=1).
 * Same as factory `predictTokenAddress` / viem `getContractAddress({ from, nonce: 1n })`.
 */
export function predictTokenAddressLocal(listing: Address): Address {
  return getContractAddress({ from: listing, nonce: 1n })
}

/** Manual RLP path (worker / parity checks without getContractAddress). */
export function predictTokenAddressRlp(listing: Address): Address {
  const packed = concat([
    '0xd6',
    '0x94',
    listing,
    '0x01',
  ] as const)
  return getAddress(`0x${keccak256(packed).slice(-40)}`)
}

export function matchesVanityPrefix(address: Address): boolean {
  return getAddress(address).toLowerCase().slice(2, 6) === VANITY_PREFIX
}

/** Fixed self-test vector (arbitrary salt); main thread + worker must agree. */
export const SELF_TEST_USER_SALT = numberToHex(0x42, { size: 32 })

export function randomUserSalt(): Hex {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return toHex(bytes)
}

/** Manual CREATE2 (for WASM path without viem getCreate2Address). */
export async function create2FromKeccak(
  keccakHex: (data: Uint8Array) => Promise<Hex>,
  factory: Address,
  salt: Hex,
  initCodeHash: Hex,
): Promise<Address> {
  const packed = concat([
    '0xff',
    factory,
    salt,
    initCodeHash,
  ] as const)
  const hash = await keccakHex(hexToBytes(packed))
  return getAddress(`0x${hash.slice(-40)}`)
}

export async function listingSaltFromKeccak(
  keccakHex: (data: Uint8Array) => Promise<Hex>,
  deployer: Address,
  userSalt: Hex,
): Promise<Hex> {
  // NOTES.md 0b — abi.encode pads address to 32 bytes then bytes32
  const encoded = encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes32' }],
    [deployer, userSalt],
  )
  return keccakHex(hexToBytes(encoded))
}

export function utf8DeclaredUse(text: string): Hex {
  if (!text.trim()) return '0x' + '00'.repeat(32)
  return keccak256(toBytes(text))
}
