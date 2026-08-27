/**
 * The non-bid writes: poke, settle, claimTokens, claimRefund.
 *
 * Each one is gated on the auction's derived status so a button only appears
 * when the contract would actually accept the call. The gates mirror the
 * contract's own order of checks — see ladderActionGates.
 */
import { useCallback, useRef, useState } from 'react'
import { zeroAddress, type Hex } from 'viem'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'
import { ladderAuctionAbi } from '../abi/ladderAuction'
import { env } from '../config/env'
import type {
  IndexedAuction,
  LadderStatus,
  LadderWalletFill,
} from '../indexer/ladderTypes'
import { waitForSuccess } from '../shell/tx'
import { formatLadderError } from './ladderErrors'

export type LadderActionKind = 'poke' | 'settle' | 'claimTokens' | 'claimRefund'

export type LadderActionGate = {
  /** Render the button at all. False means the call is not applicable here. */
  show: boolean
  enabled: boolean
  /** Why it is disabled, or a one-liner about what the call does. */
  note: string | null
}

const ACTION_LABEL: Record<LadderActionKind, string> = {
  poke: 'poke the book',
  settle: 'settle the auction',
  claimTokens: 'claim your tokens',
  claimRefund: 'claim your refund',
}

export function ladderActionLabel(kind: LadderActionKind): string {
  return ACTION_LABEL[kind]
}

/**
 * Which of the four writes this wallet can make right now.
 *
 * poke        — permissionless, never reverts, but no-ops unless the clock is
 *               running and the bell has not rung. Only offered while live.
 * settle      — permissionless, and only in the done+graduated+!settled window.
 *               Needs a wired settlement contract or it reverts SettlementUnset.
 * claimTokens — settled books only, and only if this wallet is owed tokens.
 * claimRefund — after the bell, whenever refundClaimable is standing. On a
 *               FAILED book that is the wallet's entire committed budget.
 */
export function ladderActionGates(
  a: IndexedAuction | null,
  status: LadderStatus | null,
  fill: LadderWalletFill | null,
  connected: boolean,
): Record<LadderActionKind, LadderActionGate> {
  const off: LadderActionGate = { show: false, enabled: false, note: null }
  const gates: Record<LadderActionKind, LadderActionGate> = {
    poke: off,
    settle: off,
    claimTokens: off,
    claimRefund: off,
  }
  if (!a || !status) return gates

  if (status === 'live') {
    gates.poke = {
      show: true,
      enabled: connected,
      note: connected
        ? 'anyone can call this. it advances the clock and re-prices a book that has gone quiet.'
        : 'connect a wallet to poke',
    }
  }

  if (status === 'ended_pending_settle') {
    const wired = a.settlement !== zeroAddress
    gates.settle = {
      show: true,
      enabled: connected && wired,
      note: !wired
        ? 'the settlement contract was never wired to this auction — nobody can settle it until an admin does'
        : connected
          ? 'anyone can call this. it builds the lp and releases the cash legs.'
          : 'connect a wallet to settle',
    }
  }

  if (status === 'graduated' && fill && BigInt(fill.tokens) > 0n) {
    gates.claimTokens = {
      show: true,
      enabled: connected && !fill.tokensClaimed,
      note: fill.tokensClaimed ? 'already claimed' : null,
    }
  }

  if (a.state.done && fill) {
    const claimable = BigInt(fill.refundClaimableWad) > 0n
    const committed = BigInt(fill.committed) > 0n
    if (claimable || (committed && !fill.refundClaimed)) {
      gates.claimRefund = {
        show: true,
        enabled: connected && claimable && !fill.refundClaimed,
        note: fill.refundClaimed
          ? 'already claimed'
          : !claimable
            ? 'nothing standing for this wallet — every committed unit converted'
            : null,
      }
    }
  }

  return gates
}

type Options = {
  onDone?: (kind: LadderActionKind) => void
}

export function useLadderActions(
  auction: IndexedAuction | null,
  opts?: Options,
) {
  const { address, chainId } = useAccount()
  const client = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const optsRef = useRef(opts)
  optsRef.current = opts
  const [pending, setPending] = useState<LadderActionKind | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<Hex | null>(null)

  const run = useCallback(
    async (kind: LadderActionKind) => {
      setError(null)
      setTxHash(null)

      const fail = (msg: string) => {
        setStatus(msg)
        setError(msg)
        setPending(null)
      }

      if (!auction) return fail('no auction loaded')
      if (!client) return fail('no rpc client')
      if (!address) return fail('connect a wallet first')
      if (chainId !== env.chainId) {
        return fail(`wrong network — switch to chain ${env.chainId}`)
      }

      setPending(kind)
      try {
        setStatus(`simulating ${kind}`)
        await client.simulateContract({
          address: auction.auction,
          abi: ladderAuctionAbi,
          functionName: kind,
          account: address,
        })

        setStatus(`sending ${kind}`)
        const hash = await writeContractAsync({
          address: auction.auction,
          abi: ladderAuctionAbi,
          functionName: kind,
        })
        setTxHash(hash)

        setStatus('waiting for the receipt')
        await waitForSuccess(client, hash, kind)
        setStatus(`${kind} done`)
        optsRef.current?.onDone?.(kind)
        setPending(null)
      } catch (err) {
        fail(formatLadderError(err))
      }
    },
    [auction, client, address, chainId, writeContractAsync],
  )

  return { run, pending, status, error, txHash }
}
