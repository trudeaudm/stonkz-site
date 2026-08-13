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

/** Decimal ETH string → must parse as finite > 0 when set; default "1". */
function parseEthDecimal(name: string, fallback: string): string {
  const value = read(name) ?? fallback
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive decimal ETH amount (got ${JSON.stringify(value)})`)
  }
  // Reject scientific notation / junk that Number accepts but parseEther may not
  if (!/^\d+(\.\d+)?$/.test(value.trim())) {
    throw new Error(`${name} must be a plain decimal string (got ${JSON.stringify(value)})`)
  }
  return value.trim()
}

export const env = Object.freeze({
  chainId: parseChainId('VITE_CHAIN_ID'),
  rpcUrl: requireHttps('VITE_RPC_URL'),
  explorerUrl: requireHttps('VITE_EXPLORER_URL'),
  betaGate: read('VITE_BETA_GATE') === '1',
  testerAllowlist: parseAllowlist('VITE_TESTER_ALLOWLIST'),
  listEthBuffer: parseEthDecimal('VITE_LIST_ETH_BUFFER', '1'),
  indexFromBlock: parseOptionalUint('VITE_INDEX_FROM_BLOCK', 0),
  addrV4Adapter: optionalAddress('VITE_ADDR_V4_ADAPTER'),
  addrFeeHook: optionalAddress('VITE_ADDR_FEE_HOOK'),
  addrCtoGovernor: optionalAddress('VITE_ADDR_CTO_GOVERNOR'),
  addrFeeLockerV2: optionalAddress('VITE_ADDR_FEE_LOCKER_V2'),
  addrBuybackAccum: optionalAddress('VITE_ADDR_BUYBACK_ACCUM'),
  addrLadderSettlement: optionalAddress('VITE_ADDR_LADDER_SETTLEMENT'),
  addrVault: optionalAddress('VITE_ADDR_VAULT'),
  addrExpressFactory: optionalAddress('VITE_ADDR_EXPRESS_FACTORY'),
  addrLadderFactory: optionalAddress('VITE_ADDR_LADDER_FACTORY'),
  addrSafe: optionalAddress('VITE_ADDR_SAFE'),
})

