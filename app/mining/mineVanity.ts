import {
  getAddress,
  type Address,
  type Hex,
} from 'viem'
import {
  matchesVanityPrefix,
  predictListingAddressLocal,
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
  predicted: Address
  attempts: number
  elapsedMs: number
  mode: 'wasm' | 'idle'
  selfTest: { userSalt: Hex; address: Address }
}

export type MineHandlers = {
  onProgress?: (p: MineProgress) => void
  onSelfTest?: (ok: boolean, detail: string) => void
  signal?: AbortSignal
}

/**
 * Mine a 0x4663 vanity listing address.
 * WASM worker first; falls back to requestIdleCallback + viem keccak batches.
 */
export async function mineVanitySalt(args: {
  factory: Address
  deployer: Address
  initCodeHash: Hex
  handlers?: MineHandlers
}): Promise<MineResult> {
  const expected = predictListingAddressLocal(
    args.factory,
    args.deployer,
    SELF_TEST_USER_SALT,
    args.initCodeHash,
  )

  try {
    return await mineWithWorker({ ...args, expected })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    args.handlers?.onSelfTest?.(false, `WASM miner unavailable (${msg}); falling back to idle batches`)
    return mineWithIdle({ ...args, expected })
  }
}

function mineWithWorker(args: {
  factory: Address
  deployer: Address
  initCodeHash: Hex
  expected: Address
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
          `self-test mismatch worker=${d.worker} expected=${d.expected}`,
        )
        reject(
          new Error(
            `vanity self-test failed: worker ${d.worker} !== viem ${d.expected}`,
          ),
        )
        return
      }
      if (d.type === 'selftest_ok') {
        args.handlers?.onSelfTest?.(
          true,
          `self-test ok salt=${SELF_TEST_USER_SALT} addr=${d.address}`,
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
          predicted: getAddress(d.predicted),
          attempts: d.attempts,
          elapsedMs: d.elapsedMs,
          mode: 'wasm',
          selfTest: { userSalt: SELF_TEST_USER_SALT, address: args.expected },
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
      expectedSelfTestAddress: args.expected,
    })
  })
}

function mineWithIdle(args: {
  factory: Address
  deployer: Address
  initCodeHash: Hex
  expected: Address
  handlers?: MineHandlers
}): Promise<MineResult> {
  // Main-thread self-test already uses the same predictListingAddressLocal.
  args.handlers?.onSelfTest?.(
    true,
    `idle self-test vector salt=${SELF_TEST_USER_SALT} addr=${args.expected}`,
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
        const predicted = predictListingAddressLocal(
          args.factory,
          args.deployer,
          userSalt,
          args.initCodeHash,
        )
        attempts++
        if (matchesVanityPrefix(predicted)) {
          args.handlers?.signal?.removeEventListener('abort', onAbort)
          resolve({
            userSalt,
            predicted,
            attempts,
            elapsedMs: performance.now() - t0,
            mode: 'idle',
            selfTest: { userSalt: SELF_TEST_USER_SALT, address: args.expected },
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
