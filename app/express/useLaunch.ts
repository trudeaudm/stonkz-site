import { useCallback, useState } from 'react'
import {
  decodeEventLog,
  parseEther,
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
} from '../mining/create2'
import { mineVanitySalt } from '../mining/mineVanity'

export function listEthBufferWei(): bigint {
  return parseEther(env.listEthBuffer)
}

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
  listed?: bigint
  sidePoolTokens?: bigint
  instant?: boolean
}

function factoryAddress(): Address {
  const a = env.addrExpressFactory
  if (!a) throw new Error('VITE_ADDR_EXPRESS_FACTORY is not set')
  return a
}

function errName(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err)
  const e = err as {
    name?: string
    shortMessage?: string
    message?: string
    walk?: (fn: (x: Error) => boolean) => Error | null
    cause?: unknown
  }
  // wagmi/viem ContractFunctionRevertedError
  const meta = err as { data?: { errorName?: string }; errorName?: string }
  if (meta.errorName) return meta.errorName
  if (meta.data?.errorName) return meta.data.errorName
  let cur: unknown = err
  for (let i = 0; i < 8 && cur; i++) {
    if (typeof cur === 'object' && cur && 'data' in cur) {
      const d = (cur as { data?: { errorName?: string } }).data
      if (d?.errorName) return d.errorName
    }
    if (typeof cur === 'object' && cur && 'cause' in cur) {
      cur = (cur as { cause: unknown }).cause
    } else break
  }
  return e.shortMessage ?? e.message ?? e.name ?? String(err)
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
      try {
        // 1. build ListingParams (already ordered by caller per NOTES.md 0f)
        current = 'build'
        setStep(current)
        setStatus('1/7 build ListingParams')
        const p = params

        // 2. listingInitCodeHash from chain (stamps applied on-chain)
        current = 'initCodeHash'
        setStep(current)
        setStatus('2/7 read listingInitCodeHash(p)')
        const initCodeHash = await publicClient.readContract({
          address: factory,
          abi: expressFactoryAbi,
          functionName: 'listingInitCodeHash',
          args: [p],
        })

        // 3. mine salt
        current = 'mine'
        setStep(current)
        setStatus('3/7 mining your 0x4663 address…')
        const mined = await mineVanitySalt({
          factory,
          deployer: address,
          initCodeHash,
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
          `self-test: salt=${mined.selfTest.userSalt} → ${mined.selfTest.address}`,
        )

        // 4. on-chain verify predictListingAddress
        current = 'verify'
        setStep(current)
        setStatus('4/7 on-chain predictListingAddress verify')
        const onChain = await publicClient.readContract({
          address: factory,
          abi: expressFactoryAbi,
          functionName: 'predictListingAddress',
          args: [address, mined.userSalt, initCodeHash],
        })
        const local = predictListingAddressLocal(
          factory,
          address,
          mined.userSalt,
          initCodeHash,
        )
        if (
          onChain.toLowerCase() !== mined.predicted.toLowerCase() ||
          onChain.toLowerCase() !== local.toLowerCase() ||
          !matchesVanityPrefix(onChain)
        ) {
          throw new Error(
            `predict verify failed: onChain=${onChain} mined=${mined.predicted} local=${local}`,
          )
        }

        // 5. simulate
        current = 'simulate'
        setStep(current)
        setStatus('5/7 simulateContract list(p, salt)')
        const pairToken = await publicClient.readContract({
          address: factory,
          abi: expressFactoryAbi,
          functionName: 'pairToken',
        })
        const value = pairToken === zeroAddress ? listEthBufferWei() : 0n

        try {
          await publicClient.simulateContract({
            address: factory,
            abi: expressFactoryAbi,
            functionName: 'list',
            args: [p, mined.userSalt],
            account: address,
            value,
          })
        } catch (simErr) {
          throw new Error(`simulate: ${errName(simErr)}`)
        }

        // 6. write + wait receipt
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
        const txReceipt = await publicClient.waitForTransactionReceipt({
          hash: txHash,
        })

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
          listed,
          sidePoolTokens,
          instant,
        })
        setStep('done')
        setStatus('done')
      } catch (err) {
        setStep('error')
        setError(`${current}: ${errName(err)}`)
        setStatus(`halted at ${current}: ${errName(err)}`)
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
