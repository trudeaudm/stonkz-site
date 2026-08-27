type Address = `0x${string}`

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/

function read(name: string): string | undefined {
  const value = import.meta.env[name]
  if (value == null) return undefined
  const s = String(value)
  return s === '' ? undefined : s
}

// http is allowed for LOOPBACK ONLY, so the app can be pointed at a local anvil fork. Without this the
// ladder UI could not be exercised against a real deploy before shipping, since a fork is reachable only over
// http on 127.0.0.1 — and the alternative (test first on staging) is the more dangerous one.
// Loopback is not a weakening: it cannot be a remote endpoint, so there is no credential or MITM surface.
const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/

function requireHttps(name: string): string {
  const value = read(name)
  if (!value || !(value.startsWith('https://') || LOOPBACK.test(value))) {
    throw new Error(
      `${name} must start with https:// (or http:// on 127.0.0.1/localhost for a local fork) (got ${JSON.stringify(value)})`,
    )
  }
  return value
}

function parseChainId(name: string): number {
  const value = read(name)
  const n = Number.parseInt(value ?? '', 10)
  if (!Number.isInteger(n) || n <= 0 || String(n) !== (value ?? '').trim()) {
    throw new Error(`${name} must be a positive integer (got ${JSON.stringify(value)})`)
  }
  return n
}

function optionalAddress(name: string): Address | undefined {
  const value = read(name)
  if (value == null) return undefined
  if (!ADDR_RE.test(value)) {
    throw new Error(`${name} must be a 20-byte hex address (got ${JSON.stringify(value)})`)
  }
  return value as Address
}

function parseAllowlist(name: string): Address[] {
  const value = read(name)
  if (value == null) return []
  return value.split(',').map((part, i) => {
    const addr = part.trim()
    if (!ADDR_RE.test(addr)) {
      throw new Error(
        `${name} entry ${i + 1} must be a 20-byte hex address (got ${JSON.stringify(addr)})`,
      )
    }
    return addr as Address
  })
}

function parseOptionalUint(name: string, fallback: number): number {
  const value = read(name)
  if (value == null) return fallback
  const n = Number.parseInt(value, 10)
  if (!Number.isInteger(n) || n < 0 || String(n) !== value.trim()) {
    throw new Error(`${name} must be a non-negative integer (got ${JSON.stringify(value)})`)
  }
  return n
}

/** Positive integer wei string (no decimals, no scientific notation). */
function parseWeiString(name: string, fallback: string): string {
  const value = (read(name) ?? fallback).trim()
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(
      `${name} must be a positive integer wei string (got ${JSON.stringify(value)})`,
    )
  }
  return value
}

export const env = Object.freeze({
  chainId: parseChainId('VITE_CHAIN_ID'),
  rpcUrl: requireHttps('VITE_RPC_URL'),
  explorerUrl: requireHttps('VITE_EXPLORER_URL'),
  betaGate: read('VITE_BETA_GATE') === '1',
  testerAllowlist: parseAllowlist('VITE_TESTER_ALLOWLIST'),
  /** Decimal wei string for list() settle buffer. */
  listBufferWei: parseWeiString('VITE_LIST_BUFFER_WEI', '1000000'),
  /** Express V4 deploy block (38007365). Prior factory floors orphaned with old addresses. */
  indexFromBlock: parseOptionalUint('VITE_INDEX_FROM_BLOCK', 0),
  addrV4Adapter: optionalAddress('VITE_ADDR_V4_ADAPTER'),
  /**
   * Optional Uniswap v4 PoolManager override (Swap log address).
   * Prefer on-chain adapter.manager(); this is only a last-resort bake.
   */
  addrPoolManager: optionalAddress('VITE_ADDR_POOL_MANAGER'),
  /** Universal Router — V4_SWAP execute target for in-app trades. */
  addrUniversalRouter: optionalAddress('VITE_ADDR_UNIVERSAL_ROUTER'),
  /** Permit2 — ERC20→UR allowance bridge for sells. */
  addrPermit2: optionalAddress('VITE_ADDR_PERMIT2'),
  addrFeeHook: optionalAddress('VITE_ADDR_FEE_HOOK'),
  addrCtoGovernor: optionalAddress('VITE_ADDR_CTO_GOVERNOR'),
  addrFeeLockerV2: optionalAddress('VITE_ADDR_FEE_LOCKER_V2'),
  addrBuybackAccum: optionalAddress('VITE_ADDR_BUYBACK_ACCUM'),
  addrLadderSettlement: optionalAddress('VITE_ADDR_LADDER_SETTLEMENT'),
  addrVault: optionalAddress('VITE_ADDR_VAULT'),
  /** Express V4: 0xEe25…E94a. V3/V2/V1 orphaned; cache key rotates on change. */
  addrExpressFactory: optionalAddress('VITE_ADDR_EXPRESS_FACTORY'),
  addrLadderFactory: optionalAddress('VITE_ADDR_LADDER_FACTORY'),
  addrSafe: optionalAddress('VITE_ADDR_SAFE'),
})

