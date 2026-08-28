/**
 * file(params, userSalt) pipeline — read the live ETH/USD stamp, hash the params, mine a 0x4663
 * auction address, verify the prediction against the factory, simulate, write, wait, parse
 * AuctionFiled.
 *
 * UNITS. `floorMcap` is DOLLARS as WAD ($1,000 → 1000e18), not pair wei: the auction constructor
 * converts it with `ethUsdWad` on a native book and takes it as-is on a stable book. `supply` is
 * token wei. Everything else here is bps.
 *
 * WHY THE WHOLE THING RE-RUNS ON DRIFT. `ethUsdWad` is a Params member, so it is inside the CREATE2
 * init code: a fresher rate is a different `auctionInitCodeHash`, which is a different predicted
 * address, which invalidates the mined salt. So a drift retry cannot just swap the rate — it has to
 * re-hash and re-mine. Same reason the caller hands this hook a draft rather than finished Params:
 * the rate and the factory's carve default are read here, immediately before mining, so no salt can
 * outlive the params it was mined for.
 */
import { useCallback, useRef, useState } from 'react'
import {
  decodeEventLog,
  getAddress,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'
import { ladderFactoryAbi } from '../abi/ladderFactory'
import { env } from '../config/env'
import {
  listingSalt,
  matchesVanityPrefix,
  predictCreate2,
  randomUserSalt,
} from '../mining/create2'
import { waitForSuccess } from '../shell/tx'
import { formatLadderError, ladderErrorName } from './ladderErrors'

export type LadderTier = 0 | 1 | 2 | 3

export const LADDER_TIERS: LadderTier[] = [0, 1, 2, 3]

export const TIER_LABEL: Record<LadderTier, string> = {
  0: 'GOD',
  1: 'H4',
  2: 'DAILY',
  3: 'ROAD',
}

/** LadderConstants GOD/H4/DAILY/ROAD_DURATION. Derived from the tier, never typed by a filer. */
export const TIER_DURATION: Record<LadderTier, bigint> = {
  0: 3600n,
  1: 14400n,
  2: 86400n,
  3: 604800n,
}

/** LadderConstants *_LP_HEALTH_FLOOR, WAD fractions. Also tier-derived. */
export const TIER_LP_HEALTH_WAD: Record<LadderTier, bigint> = {
  0: 250_000_000_000_000_000n,
  1: 300_000_000_000_000_000n,
  2: 350_000_000_000_000_000n,
  3: 400_000_000_000_000_000n,
}

/** LadderConstants *_HOLDBACK_BPS_MAX — the contract reverts HoldbackCeiling above it. */
export const TIER_HOLDBACK_BPS_MAX: Record<LadderTier, number> = {
  0: 4000,
  1: 5000,
  2: 6000,
  3: 7000,
}

/** LadderConstants WALLET_CAP_BPS_MIN/MAX — a hard `require("cap")` in the constructor. */
export const WALLET_CAP_BPS_MIN = 1
export const WALLET_CAP_BPS_MAX = 1000
export const CASH_HOLDBACK_BPS_MAX = 2000

/** carveBps sentinel meaning "stamp the factory's defaultCarveBps". */
export const CARVE_BPS_DEFAULT_SENTINEL = 65535

/** USDG book — 6 decimals, and a dollar-quoted pair, so floorMcap is NOT rate-converted. */
export const USDG_ADDRESS: Address = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'

/** DeployControls.DEFAULT_CARVE_BPS, used only if the live read fails. */
const CARVE_BPS_FALLBACK = 400

const MAX_DRIFT_LOOPS = 3

const DRIFT_RETRY_COPY =
  'eth/usd moved while you were confirming — re-hashing and re-mining at the fresh rate…'

/**
 * 0x4663 is 16 bits, so the mean is 65,536 attempts and P(miss) after 2M is ~1e-13. Past that the
 * prefix is not unlucky, it is unreachable — a wrong initCodeHash or a factory that is not the one
 * we predicted against — and spinning forever hides that.
 */
const MINE_ATTEMPT_CEILING = 2_000_000

/** Attempts between yields. Big enough to amortise the yield, short enough to keep the UI painting. */
const MINE_BATCH = 512

export type LadderFileStep =
  | 'idle'
  | 'check'
  | 'rate'
  | 'initCodeHash'
  | 'mine'
  | 'verify'
  | 'simulate'
  | 'write'
  | 'receipt'
  | 'done'
  | 'error'

const BUSY = new Set<LadderFileStep>([
  'check',
  'rate',
  'initCodeHash',
  'mine',
  'verify',
  'simulate',
  'write',
  'receipt',
])

/** Exactly the factory's Params tuple, in the ABI's field order. */
export type LadderParams = {
  supply: bigint
  name: string
  symbol: string
  floorMcap: bigint
  duration: bigint
  lpShareWad: bigint
  lpHealthTargetWad: bigint
  carveBps: number
  cashHoldbackBps: number
  holdbackBps: number
  holdbackDelivery: number
  tier: number
  createSidePool: boolean
  sidePoolBps: number
  refPriceWad: bigint
  walletCapBps: number
  sizeBonusBps: number
  maxUniqueActives: number
  pairToken: Address
  creator: Address
  treasury: Address
  vaultRef: Address
  settlement: Address
  ethUsdWad: bigint
}

/** What a filer actually chooses. The rest of Params is derived here or stamped on-chain. */
export type LadderFileDraft = {
  name: string
  symbol: string
  /** Token wei. */
  supply: bigint
  /** DOLLARS as WAD. */
  floorMcapUsdWad: bigint
  tier: LadderTier
  /** zeroAddress = native ETH book. */
  pairToken: Address
  /** bps of total supply, to the vault. 0 = no creator reserve. */
  holdbackBps: number
  /** bps of raised, held back as cash. */
  cashHoldbackBps: number
  /** bps of TOTAL supply, per wallet. */
  walletCapBps: number
  sizeBonusBps: number
  /** 0 = no cap on unique bidders. */
  maxUniqueActives: number
}

export type LadderFileReceipt = {
  auction: Address
  creator: Address
  holdbackBps: number
  /** Post-stamp carve, straight off the event — not the 65535 sentinel we sent. */
  carveBps: number
  userSalt: Hex
  salt: Hex
  txHash: Hex
  attempts: number
  /** The rate the auction is stamped with, for the record. */
  ethUsdWad: bigint
}

/**
 * LP share of the raise, WAD. The carve and the cash holdback come off the top, so this is whatever
 * is left. `carveBps` here must be the EFFECTIVE carve (the factory default when the sentinel is
 * sent), not the sentinel itself.
 */
export function lpShareWadFor(carveBps: number, cashHoldbackBps: number): bigint {
  const rest = BigInt(10_000 - carveBps - cashHoldbackBps)
  return (rest * 10n ** 18n) / 10_000n
}

/** Dollar floor at a given rate → the pair-currency floor the auction will actually store. */
export function floorMcapPair(
  floorMcapUsdWad: bigint,
  pairToken: Address,
  ethUsdWad: bigint,
): bigint | null {
  if (pairToken !== zeroAddress) return floorMcapUsdWad
  if (ethUsdWad <= 0n) return null
  return (floorMcapUsdWad * 10n ** 18n) / ethUsdWad
}

function factoryAddress(): Address {
  const a = env.addrLadderFactory
  if (!a) throw new Error('VITE_ADDR_LADDER_FACTORY is not set')
  return a
}

type MineResult = {
  userSalt: Hex
  predicted: Address
  attempts: number
  elapsedMs: number
}

/**
 * Local CREATE2 grind. No rpc per attempt: the salt formula and the address derivation are both
 * pure, and the one on-chain input (initCodeHash) was read once by the caller. The factory's
 * `auctionSalt` is keccak256(abi.encode(deployer, userSalt)) — the same formula Express uses, hence
 * the shared `listingSalt` helper.
 */
async function mineAuctionSalt(args: {
  factory: Address
  deployer: Address
  initCodeHash: Hex
  onProgress: (attempts: number, perSec: number) => void
}): Promise<MineResult> {
  const t0 = performance.now()
  let attempts = 0

  for (;;) {
    for (let i = 0; i < MINE_BATCH; i++) {
      const userSalt = randomUserSalt()
      const predicted = predictCreate2(
        args.factory,
        listingSalt(args.deployer, userSalt),
        args.initCodeHash,
      )
      attempts++
      if (matchesVanityPrefix(predicted)) {
        return {
          userSalt,
          predicted,
          attempts,
          elapsedMs: performance.now() - t0,
        }
      }
    }
    const elapsed = (performance.now() - t0) / 1000
    args.onProgress(attempts, elapsed > 0 ? attempts / elapsed : 0)
    if (attempts >= MINE_ATTEMPT_CEILING) {
      throw new Error(
        `no 0x4663 address in ${attempts.toLocaleString()} attempts — that is far past the ~65,536 expected, so the init code hash or the factory address is wrong. nothing was filed.`,
      )
    }
    // Yield to the event loop so the window keeps painting and the progress line moves.
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

export function useLadderFile(opts?: { onDone?: (r: LadderFileReceipt) => void }) {
  const { address, chainId } = useAccount()
  const client = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const optsRef = useRef(opts)
  optsRef.current = opts
  const [step, setStep] = useState<LadderFileStep>('idle')
  const [status, setStatus] = useState('')
  const [mineStats, setMineStats] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<LadderFileReceipt | null>(null)

  const reset = useCallback(() => {
    setStep('idle')
    setStatus('')
    setMineStats('')
    setError(null)
    setReceipt(null)
  }, [])

  const run = useCallback(
    async (draft: LadderFileDraft) => {
      setError(null)
      setReceipt(null)
      setMineStats('')

      const fail = (msg: string) => {
        setStep('error')
        setStatus(msg)
        setError(msg)
      }

      if (!client) return fail('no rpc client')
      if (!address) return fail('connect a wallet first')
      if (chainId !== env.chainId) {
        return fail(`wrong network — switch to chain ${env.chainId}`)
      }

      let factory: Address
      try {
        factory = factoryAddress()
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err))
      }

      try {
        let params: LadderParams | null = null
        let mined: MineResult | null = null

        for (let loop = 1; loop <= MAX_DRIFT_LOOPS; loop++) {
          setStep('rate')
          setStatus(
            loop > 1 ? DRIFT_RETRY_COPY : '1/6 read currentEthUsdWad + build params',
          )
          // The rate is read here, not in the form, because the factory freshness-checks it against
          // its own live reading at the moment `file` executes (requireEthUsdFresh, ±band).
          const [ethUsdWad, defaultCarveBps] = await Promise.all([
            client.readContract({
              address: factory,
              abi: ladderFactoryAbi,
              functionName: 'currentEthUsdWad',
            }),
            client.readContract({
              address: factory,
              abi: ladderFactoryAbi,
              functionName: 'defaultCarveBps',
            }),
          ])
          params = buildLadderParams(draft, address, ethUsdWad, defaultCarveBps)

          setStep('initCodeHash')
          setStatus('2/6 read auctionInitCodeHash(p)')
          // The factory runs _stampAuctionParams internally, so this is the POST-stamp hash for the
          // raw params we are about to send — the two cannot disagree about side pool or treasury.
          const initCodeHash = await client.readContract({
            address: factory,
            abi: ladderFactoryAbi,
            functionName: 'auctionInitCodeHash',
            args: [params],
          })

          setStep('mine')
          setStatus('3/6 mining a 0x4663 auction address…')
          mined = await mineAuctionSalt({
            factory,
            deployer: address,
            initCodeHash,
            onProgress: (attempts, perSec) => {
              setMineStats(
                `${attempts.toLocaleString()} attempts · ${perSec.toFixed(0)}/s`,
              )
            },
          })
          setMineStats(
            `found in ${mined.attempts.toLocaleString()} attempts → ${mined.predicted}`,
          )

          setStep('verify')
          setStatus('4/6 on-chain predictAuctionAddress verify')
          // Cheap guard against a local/chain mismatch: if these disagree, `file` would either
          // revert VanityPrefixMismatch or deploy to an address we never showed the user.
          const onChain = await client.readContract({
            address: factory,
            abi: ladderFactoryAbi,
            functionName: 'predictAuctionAddress',
            args: [address, mined.userSalt, initCodeHash],
          })
          if (
            getAddress(onChain) !== getAddress(mined.predicted) ||
            !matchesVanityPrefix(onChain)
          ) {
            throw new Error(
              `predict verify FAILED — the factory says ${onChain} and this browser says ${mined.predicted}. refusing to file.`,
            )
          }

          setStep('simulate')
          setStatus('5/6 simulateContract file(p, salt)')
          try {
            await client.simulateContract({
              address: factory,
              abi: ladderFactoryAbi,
              functionName: 'file',
              args: [params, mined.userSalt],
              account: address,
            })
            break
          } catch (simErr) {
            // A fresh rate is a different init code hash, so a drift retry re-mines from the top.
            if (ladderErrorName(simErr) === 'EthUsdStampDrift') {
              if (loop < MAX_DRIFT_LOOPS) continue
              throw new Error(
                `eth/usd kept moving — ${MAX_DRIFT_LOOPS} attempts all landed outside the factory's freshness band. nothing was filed; try again in a moment.`,
              )
            }
            throw simErr
          }
        }

        if (!params || !mined) {
          throw new Error('pipeline ended without params or a mined salt')
        }

        setStep('write')
        setStatus('6/6 writeContract file')
        const txHash = await writeContractAsync({
          address: factory,
          abi: ladderFactoryAbi,
          functionName: 'file',
          args: [params, mined.userSalt],
        })

        setStep('receipt')
        setStatus('waiting for the receipt')
        // A reverted filing still returns a receipt, and its logs are simply absent — which read as
        // "AuctionFiled missing" rather than "the filing reverted". See shell/tx.ts.
        const txReceipt = await waitForSuccess(client, txHash, 'the filing')

        let filed: LadderFileReceipt | null = null
        for (const log of txReceipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: ladderFactoryAbi,
              data: log.data,
              topics: log.topics,
            })
            if (decoded.eventName !== 'AuctionFiled') continue
            filed = {
              auction: getAddress(decoded.args.auction),
              creator: getAddress(decoded.args.creator),
              holdbackBps: decoded.args.holdbackBps,
              carveBps: decoded.args.carveBps,
              userSalt: decoded.args.userSalt,
              salt: decoded.args.salt,
              txHash,
              attempts: mined.attempts,
              ethUsdWad: params.ethUsdWad,
            }
          } catch {
            /* not AuctionFiled */
          }
        }
        if (!filed) {
          throw new Error(
            'the transaction succeeded but carried no AuctionFiled log — check the tx on the explorer before filing again',
          )
        }

        setReceipt(filed)
        setStep('done')
        setStatus(`filed — ${filed.auction}`)
        optsRef.current?.onDone?.(filed)
      } catch (err) {
        fail(formatLadderError(err))
      }
    },
    [client, address, chainId, writeContractAsync],
  )

  return { run, step, status, mineStats, error, receipt, reset, busy: BUSY.has(step) }
}

/**
 * Draft → Params. Everything the filer does not choose is either tier-derived (duration,
 * lpHealthTarget), arithmetic (lpShareWad), or stamped by the factory — the stamped members are
 * sent as zero/false so the local params and `auctionInitCodeHash` agree on what the stamp replaces.
 */
export function buildLadderParams(
  draft: LadderFileDraft,
  creator: Address,
  ethUsdWad: bigint,
  defaultCarveBps?: number,
): LadderParams {
  const carve = defaultCarveBps ?? CARVE_BPS_FALLBACK
  return {
    supply: draft.supply,
    name: draft.name.trim(),
    symbol: draft.symbol.trim().toUpperCase(),
    // DOLLARS as WAD. The auction ctor divides by ethUsdWad on a native book and leaves it alone on
    // a dollar-quoted one; passing pair wei here is the BONZI bug the contract comments warn about.
    floorMcap: draft.floorMcapUsdWad,
    duration: TIER_DURATION[draft.tier],
    lpShareWad: lpShareWadFor(carve, draft.cashHoldbackBps),
    lpHealthTargetWad: TIER_LP_HEALTH_WAD[draft.tier],
    carveBps: CARVE_BPS_DEFAULT_SENTINEL,
    cashHoldbackBps: draft.cashHoldbackBps,
    holdbackBps: draft.holdbackBps,
    // Re-stamped either way, but the factory only accepts Vault alongside a non-zero holdback.
    holdbackDelivery: draft.holdbackBps > 0 ? 1 : 0,
    tier: draft.tier,
    createSidePool: false,
    sidePoolBps: 0,
    refPriceWad: 0n,
    walletCapBps: draft.walletCapBps,
    sizeBonusBps: draft.sizeBonusBps,
    maxUniqueActives: draft.maxUniqueActives,
    pairToken: draft.pairToken,
    creator,
    treasury: zeroAddress,
    vaultRef: zeroAddress,
    settlement: zeroAddress,
    ethUsdWad,
  }
}
