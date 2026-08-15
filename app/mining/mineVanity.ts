import {
  getAddress,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { expressFactoryAbi } from '../abi/expressFactory'
import {
  matchesVanityPrefix,
  predictListingAddressLocal,
  predictTokenAddressLocal,
  predictTokenAddressRlp,
  randomUserSalt,
  SELF_TEST_USER_SALT,
} from './create2'

export type MineProgress = {
  attempts: number
  elapsedMs: number
  perSec: number
}

export type MineResult = {
  userSalt: Hex
  predictedListing: Address
  predictedToken: Address
  attempts: number
  elapsedMs: number
  mode: 'wasm' | 'idle'
  selfTest: {
    userSalt: Hex
    listing: Address
    token: Address
  }
}

export type MineHandlers = {
  onProgress?: (p: MineProgress) => void
  onSelfTest?: (ok: boolean, detail: string) => void
  signal?: AbortSignal
}

export type TokenParityResult = {
  ok: boolean
  detail: string
  listing: Address
  tokenViem: Address
  tokenRlp: Address
  tokenFactory?: Address
}

/**
 * Triple parity for fixed self-test salt:
 * worker/RLP token == viem getContractAddress(nonce:1) == factory predictTokenAddress.
 * Call once on launch-form mount with live RPC; disable mining if ok=false.
 */
export async function verifyTokenVanityParity(args: {
  factory: Address
  deployer: Address
  initCodeHash: Hex
  publicClient?: PublicClient
}): Promise<TokenParityResult> {
  const listing = predictListingAddressLocal(
    args.factory,
    args.deployer,
    SELF_TEST_USER_SALT,
    args.initCodeHash,
  )
  const tokenViem = predictTokenAddressLocal(listing)
  const tokenRlp = predictTokenAddressRlp(listing)
  if (getAddress(tokenViem) !== getAddress(tokenRlp)) {
    return {
      ok: false,
      detail: `viem/RLP token mismatch viem=${tokenViem} rlp=${tokenRlp}`,
      listing,
      tokenViem,
      tokenRlp,
    }
  }
  let tokenFactory: Address | undefined
  if (args.publicClient) {
    tokenFactory = await args.publicClient.readContract({
      address: args.factory,
      abi: expressFactoryAbi,
      functionName: 'predictTokenAddress',
      args: [listing],
    })
    if (getAddress(tokenFactory) !== getAddress(tokenViem)) {
      return {
        ok: false,
        detail: `factory predictTokenAddress mismatch factory=${tokenFactory} viem=${tokenViem}`,
        listing,
        tokenViem,
        tokenRlp,
        tokenFactory,
      }
    }
  }
  return {
    ok: true,
    detail: `parity ok listing=${listing} token=${tokenViem}${tokenFactory ? ` factory=${tokenFactory}` : ''}`,
    listing,
    tokenViem,
    tokenRlp,
    tokenFactory,
  }
}

/**
 * Mine a 0x4663 vanity TOKEN address (Express V2).
 * WASM worker first; falls back to requestIdleCallback + viem keccak batches.
 */
export async function mineVanitySalt(args: {
  factory: Address
  deployer: Address
  initCodeHash: Hex
  handlers?: MineHandlers
  /** Required — refuse mining against a non-v3 (or unfingerprinted) factory. */
  factoryIsV3: boolean
}): Promise<MineResult> {
  if (!args.factoryIsV3) {
    throw new Error(
      'miner refused: factory fingerprint is not v3 — DO NOT FILE. env or deploy is stale.',
    )
  }
  const expectedListing = predictListingAddressLocal(
    args.factory,
    args.deployer,
    SELF_TEST_USER_SALT,
    args.initCodeHash,
  )
  const expectedToken = predictTokenAddressLocal(expectedListing)

  try {
    return await mineWithWorker({
      ...args,
      expectedListing,
      expectedToken,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    args.handlers?.onSelfTest?.(
      false,
      `WASM miner unavailable (${msg}); falling back to idle batches`,
    )
    return mineWithIdle({
      ...args,
      expectedListing,
      expectedToken,
    })
  }
}

function mineWithWorker(args: {
  factory: Address
  deployer: Address
  initCodeHash: Hex
  expectedListing: Address
  expectedToken: Address
  handlers?: MineHandlers
}): Promise<MineResult> {
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./vanityWorker.ts', import.meta.url), {
        type: 'module',
      })
    } catch (err) {
      reject(err)
      return
    }

    const onAbort = () => {
      worker.postMessage({ type: 'stop' })
      worker.terminate()
      reject(new Error('mining aborted'))
    }
    args.handlers?.signal?.addEventListener('abort', onAbort)

    worker.onmessage = (ev: MessageEvent) => {
      const d = ev.data
      if (d.type === 'selftest_fail') {
        worker.terminate()
        args.handlers?.onSelfTest?.(
          false,
          `self-test mismatch workerListing=${d.workerListing} workerToken=${d.workerToken} expectedListing=${d.expectedListing} expectedToken=${d.expectedToken}`,
        )
        reject(
          new Error(
            `vanity self-test failed: worker listing/token !== viem`,
          ),
        )
        return
      }
      if (d.type === 'selftest_ok') {
        args.handlers?.onSelfTest?.(
          true,
          `self-test ok salt=${SELF_TEST_USER_SALT} listing=${d.listing} token=${d.token}`,
        )
        return
      }
      if (d.type === 'progress') {
        args.handlers?.onProgress?.({
          attempts: d.attempts,
          elapsedMs: d.elapsedMs,
          perSec: d.perSec,
        })
        return
      }
      if (d.type === 'found') {
        args.handlers?.signal?.removeEventListener('abort', onAbort)
        worker.terminate()
        resolve({
          userSalt: d.userSalt,
          predictedListing: getAddress(d.predictedListing),
          predictedToken: getAddress(d.predictedToken),
          attempts: d.attempts,
          elapsedMs: d.elapsedMs,
          mode: 'wasm',
          selfTest: {
            userSalt: SELF_TEST_USER_SALT,
            listing: args.expectedListing,
            token: args.expectedToken,
          },
        })
        return
      }
      if (d.type === 'error') {
        worker.terminate()
        reject(new Error(d.message))
      }
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(e.error ?? new Error(e.message))
    }

    worker.postMessage({
      type: 'start',
      factory: args.factory,
      deployer: args.deployer,
      initCodeHash: args.initCodeHash,
      selfTestUserSalt: SELF_TEST_USER_SALT,
      expectedSelfTestListing: args.expectedListing,
      expectedSelfTestToken: args.expectedToken,
    })
  })
}

function mineWithIdle(args: {
  factory: Address
  deployer: Address
  initCodeHash: Hex
  expectedListing: Address
  expectedToken: Address
  handlers?: MineHandlers
}): Promise<MineResult> {
  args.handlers?.onSelfTest?.(
    true,
    `idle self-test vector salt=${SELF_TEST_USER_SALT} listing=${args.expectedListing} token=${args.expectedToken}`,
  )

  return new Promise((resolve, reject) => {
    const t0 = performance.now()
    let attempts = 0
    let lastReport = t0
    let cancelled = false

    const onAbort = () => {
      cancelled = true
      reject(new Error('mining aborted'))
    }
    args.handlers?.signal?.addEventListener('abort', onAbort)

    const tick = (deadline: IdleDeadline) => {
      if (cancelled) return
      while (deadline.timeRemaining() > 2 || deadline.didTimeout) {
        const userSalt = randomUserSalt()
        const predictedListing = predictListingAddressLocal(
          args.factory,
          args.deployer,
          userSalt,
          args.initCodeHash,
        )
        const predictedToken = predictTokenAddressLocal(predictedListing)
        attempts++
        if (matchesVanityPrefix(predictedToken)) {
          args.handlers?.signal?.removeEventListener('abort', onAbort)
          resolve({
            userSalt,
            predictedListing,
            predictedToken,
            attempts,
            elapsedMs: performance.now() - t0,
            mode: 'idle',
            selfTest: {
              userSalt: SELF_TEST_USER_SALT,
              listing: args.expectedListing,
              token: args.expectedToken,
            },
          })
          return
        }
        if (attempts % 128 === 0) break
      }
      const now = performance.now()
      if (now - lastReport > 200) {
        const elapsed = (now - t0) / 1000
        args.handlers?.onProgress?.({
          attempts,
          elapsedMs: now - t0,
          perSec: elapsed > 0 ? attempts / elapsed : 0,
        })
        lastReport = now
      }
      schedule()
    }

    const schedule = () => {
      if (cancelled) return
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(tick, { timeout: 100 })
      } else {
        setTimeout(() => {
          tick({
            timeRemaining: () => 8,
            didTimeout: false,
          } as IdleDeadline)
        }, 0)
      }
    }
    schedule()
  })
}
