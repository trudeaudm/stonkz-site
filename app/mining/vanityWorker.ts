/// <reference lib="webworker" />
/**
 * Vanity salt miner (WASM keccak via hash-wasm).
 * Salt/CREATE2 layout cited to NOTES.md 0b/0d/0e — see create2.ts comments.
 */
import { createKeccak } from 'hash-wasm'
import {
  encodeAbiParameters,
  getAddress,
  hexToBytes,
  toHex,
  type Address,
  type Hex,
} from 'viem'
import { VANITY_PREFIX } from './create2'

type StartMsg = {
  type: 'start'
  factory: Address
  deployer: Address
  initCodeHash: Hex
  selfTestUserSalt: Hex
  expectedSelfTestAddress: Address
}

type Msg =
  | StartMsg
  | { type: 'stop' }

let stop = false

async function keccak256Hex(data: Uint8Array): Promise<Hex> {
  const k = await createKeccak(256)
  k.init()
  k.update(data)
  return `0x${k.digest('hex')}` as Hex
}

/** NOTES.md 0b */
async function listingSalt(deployer: Address, userSalt: Hex): Promise<Hex> {
  const encoded = encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes32' }],
    [deployer, userSalt],
  )
  return keccak256Hex(hexToBytes(encoded))
}

/** NOTES.md 0d — 0xff ++ factory ++ salt ++ initCodeHash */
async function predict(
  factory: Address,
  salt: Hex,
  initCodeHash: Hex,
): Promise<Address> {
  const packed = new Uint8Array(1 + 20 + 32 + 32)
  packed[0] = 0xff
  packed.set(hexToBytes(factory), 1)
  packed.set(hexToBytes(salt), 21)
  packed.set(hexToBytes(initCodeHash), 53)
  const hash = await keccak256Hex(packed)
  return getAddress(`0x${hash.slice(-40)}`)
}

function matchesPrefix(addr: Address): boolean {
  return addr.toLowerCase().slice(2, 6) === VANITY_PREFIX
}

function randomSalt(): Hex {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return toHex(b)
}

async function mine(msg: StartMsg) {
  stop = false
  // Self-test: derive FIXED salt address; main thread already computed expected via viem.
  const testSalt = await listingSalt(msg.deployer, msg.selfTestUserSalt)
  const testAddr = await predict(msg.factory, testSalt, msg.initCodeHash)
  if (getAddress(testAddr) !== getAddress(msg.expectedSelfTestAddress)) {
    self.postMessage({
      type: 'selftest_fail',
      worker: testAddr,
      expected: msg.expectedSelfTestAddress,
    })
    return
  }
  self.postMessage({
    type: 'selftest_ok',
    address: testAddr,
    userSalt: msg.selfTestUserSalt,
  })

  const t0 = performance.now()
  let attempts = 0
  let lastReport = t0

  while (!stop) {
    for (let i = 0; i < 64 && !stop; i++) {
      const userSalt = randomSalt()
      const salt = await listingSalt(msg.deployer, userSalt)
      const predicted = await predict(msg.factory, salt, msg.initCodeHash)
      attempts++
      if (matchesPrefix(predicted)) {
        self.postMessage({
          type: 'found',
          userSalt,
          predicted,
          attempts,
          elapsedMs: performance.now() - t0,
        })
        return
      }
    }
    const now = performance.now()
    if (now - lastReport > 200) {
      const elapsed = (now - t0) / 1000
      self.postMessage({
        type: 'progress',
        attempts,
        elapsedMs: now - t0,
        perSec: elapsed > 0 ? attempts / elapsed : 0,
      })
      lastReport = now
    }
  }
  self.postMessage({ type: 'stopped', attempts })
}

self.onmessage = (ev: MessageEvent<Msg>) => {
  const data = ev.data
  if (data.type === 'stop') {
    stop = true
    return
  }
  if (data.type === 'start') {
    void mine(data).catch((err: unknown) => {
      self.postMessage({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    })
  }
}
