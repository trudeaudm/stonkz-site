/**
 * Ladder revert → human text, in the same spirit as formatPipelineError:
 * a named custom error becomes a sentence, and an unknown revert surfaces its
 * raw selector rather than being swallowed into "transaction failed".
 */
import { decodeErrorResult } from 'viem'
import { ladderAuctionAbi } from '../abi/ladderAuction'

const HUMAN: Record<string, string> = {
  MinBid: 'that bid is under the minimum for this book',
  MaxPriceBelowLive:
    'your price ceiling is below the live price — raise the ceiling',
  AuctionFinished: 'the bell already rang — this book takes no more bids',
  TooManyUniques:
    'this book is full — it has hit its cap on unique bidders and cannot take a new wallet',
  NothingToClaim: 'nothing owed to this wallet',
  NotDone: 'the auction is still live',
  NotGraduated:
    'this auction did not graduate — there are no tokens to hand out, only refunds',
  NotSettled: 'not settled yet — settle() has to run before tokens move',
  AlreadySettled: 'already settled',
  SettlementUnset:
    'the settlement contract was never wired — nobody can settle this book',
  SettlementFrozenAfterBell: 'settlement is frozen once the bell rings',
  RaiseGateFailed: 'the raise gate failed at the bell',
  HealthGateFailed: 'the lp health gate failed at the bell',
  TransferFailed: 'the pair transfer failed',
  NotOwner: 'owner only',
  HoldbackAlreadyDeposited: 'the holdback already went to the vault',
  HoldbackCeiling: 'holdback is over its ceiling',
  VaultRequiredForHoldback: 'a holdback needs a vault and there is none',
  VaultUnsetAtSettlement: 'the vault is not wired',
  TakeRemoved: 'that entry point was removed',
  WeightsRefUnset: 'the ladder weights reference is not wired',
  WeightsFrozenAfterStart: 'ladder weights freeze once the clock starts',
  WeightsRefWrongN: 'the ladder weights reference has the wrong N',
}

function walk(err: unknown, visit: (o: Record<string, unknown>) => string | undefined) {
  let cur: unknown = err
  for (let i = 0; i < 10 && cur; i++) {
    if (typeof cur === 'object' && cur) {
      const hit = visit(cur as Record<string, unknown>)
      if (hit) return hit
    }
    if (typeof cur === 'object' && cur && 'cause' in cur) {
      cur = (cur as { cause: unknown }).cause
    } else break
  }
  return undefined
}

function errorName(err: unknown): string | undefined {
  return walk(err, (o) => {
    if (typeof o.errorName === 'string' && o.errorName) return o.errorName
    const data = o.data as { errorName?: string } | undefined
    if (typeof data?.errorName === 'string' && data.errorName) {
      return data.errorName
    }
    return undefined
  })
}

function rawRevertData(err: unknown): `0x${string}` | undefined {
  return walk(err, (o) => {
    for (const c of [o.data, o.raw]) {
      if (typeof c === 'string' && c.startsWith('0x') && c.length >= 10) {
        return c as `0x${string}`
      }
      if (c && typeof c === 'object' && 'data' in c) {
        const d = (c as { data: unknown }).data
        if (typeof d === 'string' && d.startsWith('0x') && d.length >= 10) {
          return d as `0x${string}`
        }
      }
    }
    return undefined
  }) as `0x${string}` | undefined
}

function userRejected(err: unknown): boolean {
  const hit = walk(err, (o) => {
    if (o.name === 'UserRejectedRequestError') return 'yes'
    if (o.code === 4001) return 'yes'
    const msg = o.shortMessage ?? o.message
    if (
      typeof msg === 'string' &&
      /user rejected|user denied|request rejected/i.test(msg)
    ) {
      return 'yes'
    }
    return undefined
  })
  return hit === 'yes'
}

export function formatLadderError(err: unknown): string {
  if (userRejected(err)) return 'you cancelled it in the wallet'
  if (!err || typeof err !== 'object') return String(err)

  const named = errorName(err)
  if (named) return HUMAN[named] ?? named

  const raw = rawRevertData(err)
  if (raw) {
    try {
      const decoded = decodeErrorResult({ abi: ladderAuctionAbi, data: raw })
      if (decoded.errorName) {
        return HUMAN[decoded.errorName] ?? decoded.errorName
      }
    } catch {
      /* not one of ours */
    }
    return `unrecognized revert selector=${raw.slice(0, 10)} data=${raw}`
  }

  const e = err as { shortMessage?: string; message?: string; name?: string }
  return e.shortMessage ?? e.message ?? e.name ?? String(err)
}
