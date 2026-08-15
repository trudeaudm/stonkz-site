type Address = `0x${string}`

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/

function read(name: string): string | undefined {
  const value = import.meta.env[name]
  if (value == null) return undefined
  const s = String(value)
  return s === '' ? undefined : s
}

function requireHttps(name: string): string {
  const value = read(name)
  if (!value || !value.startsWith('https://')) {
    throw new Error(`${name} must start with https:// (got ${JSON.stringify(value)})`)
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
  /** Express V2 deploy block (37184159). V1 floor orphaned with old factory. */
  indexFromBlock: parseOptionalUint('VITE_INDEX_FROM_BLOCK', 0),
  addrV4Adapter: optionalAddress('VITE_ADDR_V4_ADAPTER'),
  addrFeeHook: optionalAddress('VITE_ADDR_FEE_HOOK'),
  addrCtoGovernor: optionalAddress('VITE_ADDR_CTO_GOVERNOR'),
  addrFeeLockerV2: optionalAddress('VITE_ADDR_FEE_LOCKER_V2'),
  addrBuybackAccum: optionalAddress('VITE_ADDR_BUYBACK_ACCUM'),
  addrLadderSettlement: optionalAddress('VITE_ADDR_LADDER_SETTLEMENT'),
  addrVault: optionalAddress('VITE_ADDR_VAULT'),
  /** Express V2: 0x3eAb…C5Fd. V1 0xdaA8… is orphaned; cache key rotates on change. */
  addrExpressFactory: optionalAddress('VITE_ADDR_EXPRESS_FACTORY'),
  addrLadderFactory: optionalAddress('VITE_ADDR_LADDER_FACTORY'),
  addrSafe: optionalAddress('VITE_ADDR_SAFE'),
})

