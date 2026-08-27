import type { Address } from 'viem'
import {
  LADDER_CACHE_ROOT,
  ladderCacheKey,
  type LadderEnvelope,
  type LadderPeriodStore,
} from './ladderTypes'

export function loadLadderEnvelope(
  chainId: number,
  factory: Address,
): LadderEnvelope | null {
  try {
    const raw = localStorage.getItem(ladderCacheKey(chainId, factory))
    if (!raw) return null
    const parsed = JSON.parse(raw) as LadderEnvelope
    if (parsed.v !== 1) return null
    if (parsed.chainId !== chainId) return null
    if (parsed.factory.toLowerCase() !== factory.toLowerCase()) return null
    return parsed
  } catch {
    return null
  }
}

export function saveLadderEnvelope(env: LadderEnvelope): void {
  localStorage.setItem(
    ladderCacheKey(env.chainId, env.factory),
    JSON.stringify(env),
  )
}

/**
 * Drop ladder keys that do not match the current factory/chain (all schema versions).
 * Scoped to LADDER_CACHE_ROOT so it cannot touch the express index, and vice versa.
 */
export function gcStaleLadderKeys(chainId: number, factory: Address): number {
  const keep = ladderCacheKey(chainId, factory)
  let removed = 0
  const doomed: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k || !k.startsWith(LADDER_CACHE_ROOT)) continue
    if (k !== keep) doomed.push(k)
  }
  for (const k of doomed) {
    localStorage.removeItem(k)
    removed++
  }
  return removed
}

export function loadPeriodStore(
  env: LadderEnvelope | null,
  auction: Address,
): LadderPeriodStore | null {
  return env?.periods?.[auction.toLowerCase()] ?? null
}

/**
 * Persist a period path without disturbing the auction rows. Returns the new
 * envelope so the caller can hand it straight to React state.
 */
export function savePeriodStore(
  env: LadderEnvelope,
  store: LadderPeriodStore,
): LadderEnvelope {
  const next: LadderEnvelope = {
    ...env,
    periods: { ...env.periods, [store.auction.toLowerCase()]: store },
    updatedAt: Date.now(),
  }
  saveLadderEnvelope(next)
  return next
}

export function ladderEnvelopeByteSize(env: LadderEnvelope): number {
  return new Blob([JSON.stringify(env)]).size
}
