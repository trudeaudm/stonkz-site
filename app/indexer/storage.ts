import type { Address } from 'viem'
import {
  INDEX_CACHE_PREFIX,
  cacheKey,
  type IndexEnvelope,
} from './types'

export function loadEnvelope(
  chainId: number,
  factory: Address,
): IndexEnvelope | null {
  try {
    const raw = localStorage.getItem(cacheKey(chainId, factory))
    if (!raw) return null
    const parsed = JSON.parse(raw) as IndexEnvelope
    if (parsed.v !== 1) return null
    if (parsed.chainId !== chainId) return null
    if (parsed.factory.toLowerCase() !== factory.toLowerCase()) return null
    return parsed
  } catch {
    return null
  }
}

export function saveEnvelope(env: IndexEnvelope): void {
  localStorage.setItem(cacheKey(env.chainId, env.factory), JSON.stringify(env))
}

/** Drop keys that do not match the current factory/chain. */
export function gcStaleIndexKeys(chainId: number, factory: Address): number {
  const keep = cacheKey(chainId, factory)
  let removed = 0
  const doomed: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k || !k.startsWith(INDEX_CACHE_PREFIX)) continue
    if (k !== keep) doomed.push(k)
  }
  for (const k of doomed) {
    localStorage.removeItem(k)
    removed++
  }
  return removed
}

export function envelopeByteSize(env: IndexEnvelope): number {
  return new Blob([JSON.stringify(env)]).size
}
