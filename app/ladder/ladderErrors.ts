/**
 * Ladder revert → human text, in the same spirit as formatPipelineError:
 * a named custom error becomes a sentence, and an unknown revert surfaces its
 * raw selector rather than being swallowed into "transaction failed".
 */
import { decodeErrorResult, type Abi } from 'viem'
import { ladderAuctionAbi } from '../abi/ladderAuction'
import { ladderFactoryAbi } from '../abi/ladderFactory'

/** A revert can come from either side of a filing, so both ABIs get a shot at the selector. */
const ABIS: Abi[] = [ladderAuctionAbi as Abi, ladderFactoryAbi as Abi]

const HUMAN: Record<string, string> = {
  MinBid: 'that bid is under the minimum for this book',
  MaxPriceBelowLive:
    'your price ceiling is below the live price — raise the ceiling',
  AuctionFinished: 'the bell already rang — this book takes no more bids',
  TooManyUniques:
    'this book is full — it has hit its cap on unique bidders and cannot take a new wallet',
  // Recoverable, and the ONLY error here whose fix is a button on this same screen: the book is behind the
  // clock and a bid may not enter until it is level. Catch-up is capped per call, so a large gap needs several
  // pokes — which is the point, since it used to be one unbounded transaction that ran out of gas.
  BookBehind:
    'this book is behind its clock and cannot take a bid until it catches up — poke it (more than once if the gap is large), then bid',
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

  // ─── factory-side, i.e. filing a new book ───────────────────────────────
  DeploysOff: 'filing is switched off at the factory — nobody can file right now',
  DeployerNotAllowed:
    'this wallet is not on the factory allowlist, so it cannot file a book. browsing access is not filing access.',
  NotOnAllowlist: 'that wallet was not on the allowlist',
  // Only reachable if the local prediction and the factory disagree, which the verify step catches
  // first — so if it ever shows up, the mined salt was stale.
  VanityPrefixMismatch:
    'the predicted auction address does not start with 0x4663 — the salt was mined against different params',
  EthUsdStampDrift:
    'the eth/usd rate stamped into these params drifted outside the factory freshness band',
  AuctionCreateFailed: 'the factory could not deploy the auction',
  CarveBounds: 'the protocol carve is out of bounds',
  CarveTreasuryUnset:
    'the factory has no carve treasury set, so it refuses to file anything',
  SideTokenRefUnset:
    'the factory wants a side pool but has no side-token reference — filing is blocked until an admin sets it',
  RefPriceUnset: 'no side-pool reference price is configured for this pair',
  RefPriceOutOfBounds: 'the side-pool reference price is out of bounds',
  RefPoolUnset: 'the eth/usd reference pools are not configured',
  RefPoolEmpty: 'an eth/usd reference pool has no liquidity — filing is paused',
  RefPoolsDisagree:
    'the two eth/usd reference pools disagree beyond tolerance — filing is paused until they re-converge',
  CreationCodePointerMissing: 'the factory has no auction creation code stored',
  CreationCodeTooLarge: 'the stored auction creation code is too large',
}

type Decoded = { name: string; args?: readonly unknown[] }

/** Extra numbers worth showing verbatim — a band error is unreadable without them. */
function argDetail({ name, args }: Decoded): string | null {
  if (!args || args.length === 0) return null
  const show = (v: unknown) => (typeof v === 'bigint' ? v.toString() : String(v))
  if (name === 'EthUsdStampDrift') {
    return `(supplied=${show(args[0])}, current=${show(args[1])})`
  }
  if (name === 'RefPoolsDisagree') {
    return `(primary=${show(args[0])}, check=${show(args[1])})`
  }
  if (name === 'VanityPrefixMismatch') return `(predicted=${show(args[0])})`
  return null
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

function namedRevert(err: unknown): Decoded | undefined {
  let found: Decoded | undefined
  walk(err, (o) => {
    const args = Array.isArray(o.args) ? (o.args as readonly unknown[]) : undefined
    if (typeof o.errorName === 'string' && o.errorName) {
      found = { name: o.errorName, args }
      return 'hit'
    }
    const data = o.data as { errorName?: string; args?: unknown } | undefined
    if (typeof data?.errorName === 'string' && data.errorName) {
      found = {
        name: data.errorName,
        args: Array.isArray(data.args)
          ? (data.args as readonly unknown[])
          : undefined,
      }
      return 'hit'
    }
    return undefined
  })
  return found
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

/** The custom error behind a revert, or undefined when it is not one of ours. */
export function decodeLadderRevert(err: unknown): Decoded | undefined {
  const named = namedRevert(err)
  if (named) return named

  const raw = rawRevertData(err)
  if (!raw) return undefined
  for (const abi of ABIS) {
    try {
      const decoded = decodeErrorResult({ abi, data: raw })
      if (decoded.errorName) {
        return { name: decoded.errorName, args: decoded.args }
      }
    } catch {
      /* not this abi */
    }
  }
  return undefined
}

/** Bare error name, for callers that branch on it (drift retries). */
export function ladderErrorName(err: unknown): string | undefined {
  return decodeLadderRevert(err)?.name
}

export function formatLadderError(err: unknown): string {
  if (userRejected(err)) return 'you cancelled it in the wallet'
  if (!err || typeof err !== 'object') return String(err)

  const decoded = decodeLadderRevert(err)
  if (decoded) {
    const human = HUMAN[decoded.name] ?? decoded.name
    const detail = argDetail(decoded)
    return detail ? `${human} ${detail}` : human
  }

  const raw = rawRevertData(err)
  if (raw) return `unrecognized revert selector=${raw.slice(0, 10)} data=${raw}`

  const e = err as { shortMessage?: string; message?: string; name?: string }
  return e.shortMessage ?? e.message ?? e.name ?? String(err)
}
