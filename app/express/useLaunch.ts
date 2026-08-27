import { useCallback, useState } from 'react'
import {
  decodeErrorResult,
  decodeEventLog,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'
import {
  useAccount,
  usePublicClient,
  useWriteContract,
} from 'wagmi'
import { directListingAbi } from '../abi/directListing'
import {
  expressFactoryAbi,
  type ListingParams,
} from '../abi/expressFactory'
import { env } from '../config/env'
import {
  matchesVanityPrefix,
  predictListingAddressLocal,
  predictTokenAddressLocal,
} from '../mining/create2'
import { mineVanitySalt } from '../mining/mineVanity'
import { waitForSuccess } from '../shell/tx'
import {
  FACTORY_V2_FAIL_COPY,
  fingerprintExpressFactoryV4,
} from './factoryFingerprint'

export function listBufferWei(): bigint {
  return BigInt(env.listBufferWei)
}

const MAX_DRIFT_LOOPS = 3

const DRIFT_RETRY_COPY =
  'eth price moved while you were confirming — re-mining at the fresh rate…'

export type PipelineStep =
  | 'idle'
  | 'build'
  | 'initCodeHash'
  | 'mine'
  | 'verify'
  | 'simulate'
  | 'write'
  | 'receipt'
  | 'done'
  | 'error'

export type LaunchReceipt = {
  listing: Address
  token: Address
  creator: Address
  userSalt: Hex
  salt: Hex
  txHash: Hex
  startMcap: bigint
  startPriceWad: bigint
  startTick: number
  creatorReserve: bigint
  reserveMode: number
  vestDuration: bigint
  unlockedAt: bigint
  reserveFiled: boolean
  createSidePool: boolean
  sidePoolBps: number
  liquidityLocked: boolean
  sidePoolDeployed: boolean
  /** Immutable stamp from listing.ethUsdWad() — caller-supplied on V3. */
  ethUsdWad: bigint
  listed?: bigint
  sidePoolTokens?: bigint
  instant?: boolean
}

function factoryAddress(): Address {
  const a = env.addrExpressFactory
  if (!a) throw new Error('VITE_ADDR_EXPRESS_FACTORY is not set')
  return a
}

function extractErrorName(err: unknown): string | undefined {
  let cur: unknown = err
  for (let i = 0; i < 10 && cur; i++) {
    if (typeof cur === 'object' && cur) {
      const o = cur as {
        errorName?: string
        data?: { errorName?: string; errorSignature?: string }
      }
      if (typeof o.errorName === 'string' && o.errorName) return o.errorName
      if (typeof o.data?.errorName === 'string' && o.data.errorName) {
        return o.data.errorName
      }
    }
    if (typeof cur === 'object' && cur && 'cause' in cur) {
      cur = (cur as { cause: unknown }).cause
    } else break
  }
  return undefined
}

/** Raw revert payload hex if present (selector + data). */
function extractRawRevertData(err: unknown): `0x${string}` | undefined {
  let cur: unknown = err
  for (let i = 0; i < 10 && cur; i++) {
    if (typeof cur === 'object' && cur) {
      const o = cur as {
        data?: unknown
        raw?: unknown
        cause?: unknown
      }
      const candidates = [o.data, o.raw]
      for (const c of candidates) {
        if (typeof c === 'string' && c.startsWith('0x') && c.length >= 10) {
          return c as `0x${string}`
        }
        if (
          c &&
          typeof c === 'object' &&
          'data' in c &&
          typeof (c as { data: unknown }).data === 'string'
        ) {
          const d = (c as { data: string }).data
          if (d.startsWith('0x') && d.length >= 10) return d as `0x${string}`
        }
      }
    }
    if (typeof cur === 'object' && cur && 'cause' in cur) {
      cur = (cur as { cause: unknown }).cause
    } else break
  }
  return undefined
}

function extractEthUsdStampDrift(
  err: unknown,
): { supplied: bigint; current: bigint } | null {
  const raw = extractRawRevertData(err)
  if (raw) {
    try {
      const decoded = decodeErrorResult({
        abi: expressFactoryAbi,
        data: raw,
      })
      if (decoded.errorName === 'EthUsdStampDrift') {
        return {
          supplied: decoded.args[0] as bigint,
          current: decoded.args[1] as bigint,
        }
      }
    } catch {
      /* not this error */
    }
  }
  let cur: unknown = err
  for (let i = 0; i < 10 && cur; i++) {
    if (typeof cur === 'object' && cur) {
      const o = cur as {
        errorName?: string
        args?: unknown
        data?: { errorName?: string; args?: unknown }
      }
      if (
        o.errorName === 'EthUsdStampDrift' &&
        Array.isArray(o.args) &&
        o.args.length >= 2
      ) {
        return {
          supplied: o.args[0] as bigint,
          current: o.args[1] as bigint,
        }
      }
      if (
        o.data?.errorName === 'EthUsdStampDrift' &&
        Array.isArray(o.data.args) &&
        o.data.args.length >= 2
      ) {
        return {
          supplied: o.data.args[0] as bigint,
          current: o.data.args[1] as bigint,
        }
      }
    }
    if (typeof cur === 'object' && cur && 'cause' in cur) {
      cur = (cur as { cause: unknown }).cause
    } else break
  }
  if (extractErrorName(err) === 'EthUsdStampDrift') {
    return { supplied: 0n, current: 0n }
  }
  return null
}

/**
 * Decode simulate/write failures using the full factory ABI surface.
 * Known names returned as-is; ListingCreateFailed mapped to buffer copy;
 * unrecognized reverts surface raw selector + data (never a silent generic).
 */
export function formatPipelineError(err: unknown, bufferWei?: bigint): string {
  if (!err || typeof err !== 'object') return String(err)
  const e = err as {
    name?: string
    shortMessage?: string
    message?: string
  }
  const drift = extractEthUsdStampDrift(err)
  if (drift && (drift.supplied > 0n || drift.current > 0n)) {
    return `EthUsdStampDrift(supplied=${drift.supplied.toString()}, current=${drift.current.toString()})`
  }
  const name = extractErrorName(err)
  if (name === 'ListingCreateFailed') {
    const n = (bufferWei ?? listBufferWei()).toString()
    return `listing creation failed inside the factory — most likely an insufficient settle buffer. buffer sent: ${n} wei.`
  }
  if (name === 'RefPoolsDisagree') {
    return 'the two ETH/USD reference pools disagree beyond tolerance — launches are paused until they re-converge'
  }
  if (name === 'RefPoolEmpty') {
    return 'a reference pool has no liquidity — launches paused'
  }
  if (name === 'EthUsdUnset' || name === 'EthUsdOutOfBand' || name === 'RefPoolUnset') {
    return 'ETH/USD reference not configured'
  }
  if (name) return name

  const raw = extractRawRevertData(err)
  if (raw) {
    return `unrecognized revert selector=${raw.slice(0, 10)} data=${raw}`
  }
  return e.shortMessage ?? e.message ?? e.name ?? String(err)
}

function errName(err: unknown, bufferWei?: bigint): string {
  return formatPipelineError(err, bufferWei)
}

export function useLaunch() {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const [step, setStep] = useState<PipelineStep>('idle')
  const [status, setStatus] = useState<string>('')
  const [mineStats, setMineStats] = useState<string>('')
  const [selfTestLine, setSelfTestLine] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<LaunchReceipt | null>(null)

  const run = useCallback(
    async (params: ListingParams) => {
      setError(null)
      setReceipt(null)
      setMineStats('')
      setSelfTestLine('')
      if (!publicClient) {
        setStep('error')
        setError('no public client')
        return
      }
      if (!address) {
        setStep('error')
        setError('wallet not connected')
        return
      }

      const factory = factoryAddress()
      let current: PipelineStep = 'idle'
      let attachedValue = 0n
      try {
        // 0. factory fingerprint — hard-block V3/V2/V1/unknown
        //    (V4 = two-hop poolManager → authorized(factory))
        setStatus('0/7 factory fingerprint (v4)')
        const adapter = await fingerprintExpressFactoryV4(
          publicClient,
          factory,
        )
        if (adapter == null) {
          throw new Error(FACTORY_V2_FAIL_COPY)
        }

        const pairToken = await publicClient.readContract({
          address: factory,
          abi: expressFactoryAbi,
          functionName: 'pairToken',
        })
        const value = pairToken === zeroAddress ? listBufferWei() : 0n
        attachedValue = value

        let p: ListingParams = params
        let mined: Awaited<ReturnType<typeof mineVanitySalt>> | null = null

        for (let loop = 1; loop <= MAX_DRIFT_LOOPS; loop++) {
          // a. read currentEthUsdWad → rateWad; build params with caller-supplied stamp
          current = 'build'
          setStep(current)
          if (loop > 1) {
            setStatus(DRIFT_RETRY_COPY)
          } else {
            setStatus('1/7 read currentEthUsdWad + build ListingParams')
          }
          const rateWad = await publicClient.readContract({
            address: factory,
            abi: expressFactoryAbi,
            functionName: 'currentEthUsdWad',
          })
          p = { ...params, ethUsdWad: rateWad }

          // b. listingInitCodeHash — stable under supplied ethUsdWad (V3+)
          current = 'initCodeHash'
          setStep(current)
          setStatus('2/7 read listingInitCodeHash(p)')
          const initCodeHash = await publicClient.readContract({
            address: factory,
            abi: expressFactoryAbi,
            functionName: 'listingInitCodeHash',
            args: [p],
          })

          // c. mine salt (vanity on TOKEN address)
          current = 'mine'
          setStep(current)
          setStatus('3/7 mining your 0x4663 token address…')
          mined = await mineVanitySalt({
            factory,
            deployer: address,
            initCodeHash,
            factoryIsV4: true,
            handlers: {
              onProgress: (pr) => {
                setMineStats(
                  `${pr.attempts.toLocaleString()} attempts · ${pr.perSec.toFixed(0)}/s`,
                )
              },
              onSelfTest: (ok, detail) => {
                setSelfTestLine(detail)
                if (!ok) throw new Error(detail)
              },
            },
          })
          setMineStats(
            `found in ${mined.attempts.toLocaleString()} attempts (${mined.mode})`,
          )
          setSelfTestLine(
            `self-test: salt=${mined.selfTest.userSalt} → listing=${mined.selfTest.listing} token=${mined.selfTest.token}`,
          )

          // d. on-chain verify predictListingAddress + predictTokenAddress
          current = 'verify'
          setStep(current)
          setStatus('4/7 on-chain listing+token predict verify')
          const onChainListing = await publicClient.readContract({
            address: factory,
            abi: expressFactoryAbi,
            functionName: 'predictListingAddress',
            args: [address, mined.userSalt, initCodeHash],
          })
          const localListing = predictListingAddressLocal(
            factory,
            address,
            mined.userSalt,
            initCodeHash,
          )
          const onChainToken = await publicClient.readContract({
            address: factory,
            abi: expressFactoryAbi,
            functionName: 'predictTokenAddress',
            args: [onChainListing],
          })
          const localToken = predictTokenAddressLocal(localListing)
          if (
            onChainListing.toLowerCase() !==
              mined.predictedListing.toLowerCase() ||
            onChainListing.toLowerCase() !== localListing.toLowerCase() ||
            onChainToken.toLowerCase() !== mined.predictedToken.toLowerCase() ||
            onChainToken.toLowerCase() !== localToken.toLowerCase() ||
            !matchesVanityPrefix(onChainToken)
          ) {
            throw new Error(
              `predict verify failed: listing onChain=${onChainListing} mined=${mined.predictedListing} local=${localListing}; token onChain=${onChainToken} mined=${mined.predictedToken} local=${localToken}`,
            )
          }

          // e. simulate — EthUsdStampDrift → re-loop (a), max 3
          current = 'simulate'
          setStep(current)
          setStatus('5/7 simulateContract list(p, salt)')
          try {
            await publicClient.simulateContract({
              address: factory,
              abi: expressFactoryAbi,
              functionName: 'list',
              args: [p, mined.userSalt],
              account: address,
              value,
            })
            break
          } catch (simErr) {
            const drift = extractEthUsdStampDrift(simErr)
            if (drift) {
              if (loop < MAX_DRIFT_LOOPS) {
                setStatus(DRIFT_RETRY_COPY)
                continue
              }
              throw new Error(
                `EthUsdStampDrift after ${MAX_DRIFT_LOOPS} attempts — supplied=${drift.supplied.toString()} current=${drift.current.toString()}`,
              )
            }
            throw new Error(`simulate: ${errName(simErr, attachedValue)}`)
          }
        }

        if (!mined) {
          throw new Error('pipeline ended without a mined salt')
        }

        // f. write + wait receipt
        current = 'write'
        setStep(current)
        setStatus('6/7 writeContract list')
        const txHash = await writeContractAsync({
          address: factory,
          abi: expressFactoryAbi,
          functionName: 'list',
          args: [p, mined.userSalt],
          value,
        })
        current = 'receipt'
        setStep(current)
        setStatus('7/7 waitForTransactionReceipt')
        // Assert success rather than inclusion. On a revert the logs below are simply absent, which surfaced
        // as a confusing "could not find ExpressListed" instead of "the launch reverted". See shell/tx.ts.
        const txReceipt = await waitForSuccess(publicClient, txHash, 'the launch')

        let listing: Address | undefined
        let token: Address | undefined
        let creator: Address | undefined
        let userSalt: Hex = mined.userSalt
        let salt: Hex = mined.userSalt
        let listed: bigint | undefined
        let sidePoolTokens: bigint | undefined
        let creatorReserveEvt: bigint | undefined
        let instant: boolean | undefined
        let createSidePoolEvt: boolean | undefined
        let sidePoolBpsEvt: number | undefined
        let liquidityLockedEvt: boolean | undefined
        let startMcapEvt: bigint | undefined

        for (const log of txReceipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: expressFactoryAbi,
              data: log.data,
              topics: log.topics,
            })
            if (decoded.eventName === 'ExpressListed') {
              listing = decoded.args.listing
              token = decoded.args.token
              creator = decoded.args.creator
              userSalt = decoded.args.userSalt
              salt = decoded.args.salt
            }
          } catch {
            /* not ExpressListed */
          }
          try {
            const decoded = decodeEventLog({
              abi: directListingAbi,
              data: log.data,
              topics: log.topics,
            })
            if (decoded.eventName === 'DirectListed') {
              token = decoded.args.token
              creator = decoded.args.creator
              startMcapEvt = decoded.args.startMcap
              listed = decoded.args.listed
              sidePoolTokens = decoded.args.sidePoolTokens
              creatorReserveEvt = decoded.args.creatorReserve
              instant = decoded.args.instant
              createSidePoolEvt = decoded.args.createSidePool
              sidePoolBpsEvt = decoded.args.sidePoolBps
              liquidityLockedEvt = decoded.args.liquidityLocked
              if (!listing) listing = log.address
            }
          } catch {
            /* not DirectListed */
          }
        }

        if (!listing || !token) {
          throw new Error('receipt missing ExpressListed / DirectListed')
        }

        const [
          startMcap,
          startPriceWad,
          startTick,
          creatorReserve,
          reserveState,
          createSidePool,
          sidePoolBps,
          liquidityLocked,
          sidePoolDeployed,
          ethUsdWad,
        ] = await Promise.all([
          publicClient.readContract({
            address: listing,
            abi: directListingAbi,
            functionName: 'startMcap',
          }),
          publicClient.readContract({
            address: listing,
            abi: directListingAbi,
            functionName: 'startPriceWad',
          }),
          publicClient.readContract({
            address: listing,
            abi: directListingAbi,
            functionName: 'startTick',
          }),
          publicClient.readContract({
            address: listing,
            abi: directListingAbi,
            functionName: 'creatorReserve',
          }),
          publicClient.readContract({
            address: listing,
            abi: directListingAbi,
            functionName: 'creatorReserveState',
          }),
          publicClient.readContract({
            address: listing,
            abi: directListingAbi,
            functionName: 'createSidePool',
          }),
          publicClient.readContract({
            address: listing,
            abi: directListingAbi,
            functionName: 'sidePoolBps',
          }),
          publicClient.readContract({
            address: listing,
            abi: directListingAbi,
            functionName: 'liquidityLocked',
          }),
          publicClient.readContract({
            address: listing,
            abi: directListingAbi,
            functionName: 'sidePoolDeployed',
          }),
          publicClient.readContract({
            address: listing,
            abi: directListingAbi,
            functionName: 'ethUsdWad',
          }),
        ])

        setReceipt({
          listing,
          token,
          creator: creator ?? address,
          userSalt,
          salt,
          txHash,
          startMcap: startMcapEvt ?? startMcap,
          startPriceWad,
          startTick,
          creatorReserve: creatorReserveEvt ?? creatorReserve,
          reserveMode: reserveState[0],
          vestDuration: reserveState[1],
          unlockedAt: reserveState[2],
          reserveFiled: reserveState[5],
          createSidePool: createSidePoolEvt ?? createSidePool,
          sidePoolBps: sidePoolBpsEvt ?? sidePoolBps,
          liquidityLocked: liquidityLockedEvt ?? liquidityLocked,
          sidePoolDeployed,
          ethUsdWad,
          listed,
          sidePoolTokens,
          instant,
        })
        setStep('done')
        setStatus('done')
      } catch (err) {
        setStep('error')
        const msg = errName(err, attachedValue)
        const shown =
          err instanceof Error && err.message.startsWith('simulate: ')
            ? err.message.slice('simulate: '.length)
            : err instanceof Error
              ? err.message
              : msg
        setError(`${current}: ${shown}`)
        setStatus(`halted at ${current}: ${shown}`)
      }
    },
    [address, publicClient, writeContractAsync],
  )

  return {
    run,
    step,
    status,
    mineStats,
    selfTestLine,
    error,
    receipt,
    reset: () => {
      setStep('idle')
      setStatus('')
      setError(null)
      setReceipt(null)
      setMineStats('')
      setSelfTestLine('')
    },
  }
}
