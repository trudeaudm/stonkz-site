/**
 * placeBid pipeline — validate, approve if the book is ERC20-paired, simulate,
 * write, wait, refresh.
 *
 * UNITS. `size` is RAW pair units: wei on a native book, 6dp on a USDG book.
 * On a native book it must ALSO be forwarded as msg.value — the contract checks
 * `msg.value == size` and reverts MinBid when it disagrees. On an ERC20 book the
 * auction needs an allowance and the call carries no value.
 *
 * The minimum comes from minBidRaw(auction), which is the $5 floor already
 * converted into this book's currency. A hardcoded 5e18 would demand 5 ETH on a
 * native book; that shipped once and is not coming back.
 */
import { useCallback, useRef, useState } from 'react'
import { formatUnits, zeroAddress, type Hex } from 'viem'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'
import { ladderAuctionAbi } from '../abi/ladderAuction'
import { erc20ApproveAbi } from '../abi/permit2'
import { env } from '../config/env'
import { readWalletFill } from '../indexer/ladderHydrate'
import {
  minBidRaw,
  pairDecimals,
  type IndexedAuction,
} from '../indexer/ladderTypes'
import { waitForSuccess } from '../shell/tx'
import { formatLadderError } from './ladderErrors'
import {
  formatPriceWad,
  formatTokens,
  isNativeBook,
  pairLabel,
  walletCapTokens,
} from './ladderFormat'

export type BidStep =
  | 'idle'
  | 'check'
  | 'approve'
  | 'simulate'
  | 'write'
  | 'receipt'
  | 'done'
  | 'error'

const BUSY = new Set<BidStep>([
  'check',
  'approve',
  'simulate',
  'write',
  'receipt',
])

export type LadderBidArgs = {
  /** RAW pair units — exactly the first argument to placeBid. */
  sizeRaw: bigint
  /** Pair-wei per token, WAD. The bidder's willingness-to-pay ceiling. */
  maxPriceWad: bigint
}

type Options = {
  /** Pair token symbol, for copy only. */
  pairSymbol?: string | null
  /** Re-read auction state + wallet fill after the receipt lands. */
  onDone?: () => void
}

export function useLadderBid(
  auction: IndexedAuction | null,
  opts?: Options,
) {
  const { address, chainId } = useAccount()
  const client = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  // Held in a ref so an inline options object cannot re-create `run` every render.
  const optsRef = useRef(opts)
  optsRef.current = opts
  const [step, setStep] = useState<BidStep>('idle')
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<Hex | null>(null)

  const reset = useCallback(() => {
    setStep('idle')
    setStatus('')
    setError(null)
    setTxHash(null)
  }, [])

  const run = useCallback(
    async ({ sizeRaw, maxPriceWad }: LadderBidArgs) => {
      setError(null)
      setTxHash(null)

      const fail = (msg: string) => {
        setStep('error')
        setStatus(msg)
        setError(msg)
      }

      if (!auction) return fail('no auction loaded')
      if (!client) return fail('no rpc client')
      if (!address) return fail('connect a wallet first')
      if (chainId !== env.chainId) {
        return fail(`wrong network — switch to chain ${env.chainId}`)
      }

      const a = auction
      const native = isNativeBook(a)
      const decimals = pairDecimals(a.pairScaleToWad)
      const unit = pairLabel(a, optsRef.current?.pairSymbol)
      const human = (raw: bigint) => `${formatUnits(raw, decimals)} ${unit}`

      try {
        setStep('check')
        setStatus('1/5 checking the book and your wallet')

        // Fresh price/done: the index poll is 12s behind and both gates are
        // evaluated after placeBid's own _sync().
        const [livePrice, done] = await Promise.all([
          client.readContract({
            address: a.auction,
            abi: ladderAuctionAbi,
            functionName: 'price',
          }),
          client.readContract({
            address: a.auction,
            abi: ladderAuctionAbi,
            functionName: 'done',
          }),
        ])
        if (done) {
          return fail('the bell already rang — this book takes no more bids')
        }

        const min = minBidRaw(a)
        if (sizeRaw < min) {
          return fail(
            `minimum bid on this book is ${human(min)} — you asked for ${human(sizeRaw)}`,
          )
        }
        if (maxPriceWad < livePrice) {
          return fail(
            `your ceiling ${formatPriceWad(maxPriceWad)} is under the live price ${formatPriceWad(livePrice)} — raise it or the bid reverts`,
          )
        }

        const balance = native
          ? await client.getBalance({ address })
          : await client.readContract({
              address: a.pairToken,
              abi: erc20ApproveAbi,
              functionName: 'balanceOf',
              args: [address],
            })
        if (sizeRaw > balance) {
          return fail(
            `you have ${human(balance)} and this bid needs ${human(sizeRaw)}`,
          )
        }
        if (native && sizeRaw === balance) {
          return fail('that is every wei you have — leave something for gas')
        }

        const fill = await readWalletFill(client, a.auction, address)
        const cap = walletCapTokens(a)
        if (fill && cap > 0n && BigInt(fill.tokens) >= cap) {
          return fail(
            `you are already at this book's per-wallet cap of ${formatTokens(cap)} $${a.symbol} — more budget cannot convert, it would just sit until the refund`,
          )
        }

        // The unique-bidder cap only bites a wallet that has never bid here.
        if (fill && !fill.exists) {
          const maxUniques = await client.readContract({
            address: a.auction,
            abi: ladderAuctionAbi,
            functionName: 'maxUniqueActives',
          })
          if (maxUniques !== 0 && a.state.uniqueBidders >= maxUniques) {
            return fail(
              `this book is full — ${maxUniques} unique bidders is the cap and it is already there`,
            )
          }
        }

        // ERC20 book: the auction pulls the pair token, so it needs an allowance.
        if (!native) {
          const allowance = await client.readContract({
            address: a.pairToken,
            abi: erc20ApproveAbi,
            functionName: 'allowance',
            args: [address, a.auction],
          })
          if (allowance < sizeRaw) {
            setStep('approve')
            setStatus(`2/5 approve ${human(sizeRaw)} to the auction`)
            const approveHash = await writeContractAsync({
              address: a.pairToken,
              abi: erc20ApproveAbi,
              functionName: 'approve',
              args: [a.auction, sizeRaw],
            })
            await waitForSuccess(client, approveHash, 'the approval')
          }
        }

        // Native book: msg.value MUST equal size. ERC20 book: no value at all.
        const value = native ? sizeRaw : 0n

        setStep('simulate')
        setStatus('3/5 simulateContract placeBid')
        await client.simulateContract({
          address: a.auction,
          abi: ladderAuctionAbi,
          functionName: 'placeBid',
          args: [sizeRaw, maxPriceWad],
          account: address,
          value,
        })

        setStep('write')
        setStatus('4/5 writeContract placeBid')
        const hash = await writeContractAsync({
          address: a.auction,
          abi: ladderAuctionAbi,
          functionName: 'placeBid',
          args: [sizeRaw, maxPriceWad],
          value,
        })
        setTxHash(hash)

        setStep('receipt')
        setStatus('5/5 waitForTransactionReceipt')
        // Must assert status, not just inclusion: a reverted bid used to report "bid in" (see shell/tx.ts).
        await waitForSuccess(client, hash, 'the bid')

        setStep('done')
        setStatus(`bid in — ${human(sizeRaw)} committed`)
        optsRef.current?.onDone?.()
      } catch (err) {
        const msg = formatLadderError(err)
        setStep('error')
        setStatus(msg)
        setError(msg)
      }
    },
    [auction, client, address, chainId, writeContractAsync],
  )

  return { run, step, status, error, txHash, reset, busy: BUSY.has(step) }
}

/** Native books must be able to hold `size` in msg.value — surfaced for copy. */
export function bidValueNote(a: IndexedAuction): string {
  return a.pairToken === zeroAddress
    ? 'native book — your bid is sent as msg.value on the same call'
    : 'erc20 book — one approve, then the bid carries no value'
}
