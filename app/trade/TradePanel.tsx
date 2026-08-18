import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  formatEther,
  parseEther,
  zeroAddress,
  type Address,
} from 'viem'
import {
  useAccount,
  useBalance,
  useChainId,
  usePublicClient,
  useReadContract,
  useWriteContract,
} from 'wagmi'
import { erc20ApproveAbi, permit2Abi } from '../abi/permit2'
import { env } from '../config/env'
import type { IndexedListing } from '../indexer/types'
import { useIndex } from '../shell/IndexProvider'
import { confetti } from '../shell/confetti'
import { useToast } from '../shell/Toast'
import {
  defaultPermit2Expiration,
  maxUint256,
  MAX_UINT160,
  readSellAllowances,
  type AllowanceState,
} from './allowances'
import { encodeV4ExactInSingle } from './encode'
import { formatSwapError } from './errors'
import {
  HOOK_FEE_BPS,
  isQuoteSuccess,
  quoteExactIn,
  type TradeQuote,
} from './quote'
import { resolveRoute } from './router'
import { universalRouterAbi } from '../abi/universalRouter'

const SLIPPAGE_KEY = 'stonkz:trade:slippageBps'
const DEFAULT_SLIPPAGE_BPS = 100n // 1%
const PRESETS = [50n, 100n, 300n] as const // 0.5 / 1 / 3 %
const QUOTE_INTERVAL_MS = 10_000
const DEBOUNCE_MS = 400

type Side = 'buy' | 'sell'
type SellStep = 'idle' | 'approve-erc20' | 'approve-permit2' | 'sell'

function loadSlippage(): bigint {
  try {
    const v = localStorage.getItem(SLIPPAGE_KEY)
    if (v == null) return DEFAULT_SLIPPAGE_BPS
    const n = BigInt(v)
    if (n < 0n || n > 5_000n) return DEFAULT_SLIPPAGE_BPS
    return n
  } catch {
    return DEFAULT_SLIPPAGE_BPS
  }
}

function fmtToken(raw: bigint, digits = 4): string {
  const n = Number(formatEther(raw))
  if (!Number.isFinite(n) || n === 0) return '0'
  if (n >= 1) return n.toPrecision(6)
  return n.toExponential(3)
}

function fmtEth(raw: bigint): string {
  const n = Number(formatEther(raw))
  if (!Number.isFinite(n) || n === 0) return '0'
  return n >= 0.001 ? n.toPrecision(4) : n.toExponential(2)
}

function fmtPct(frac: number | null): string {
  if (frac == null || !Number.isFinite(frac)) return '—'
  return `${(frac * 100).toFixed(2)}%`
}

function fmtBps(bps: bigint): string {
  return `${(Number(bps) / 100).toFixed(bps % 10n === 0n ? 1 : 2)}%`
}

type Props = {
  listing: IndexedListing
  spotEthPerToken: number | null
  liveEthUsd: number | null
  onTraded?: () => void
}

export function TradePanel({
  listing,
  spotEthPerToken,
  liveEthUsd,
  onTraded,
}: Props) {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const client = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const { push } = useToast()
  const { rescanSwaps } = useIndex()

  const [side, setSide] = useState<Side>('buy')
  const [amountStr, setAmountStr] = useState('')
  const [slippageBps, setSlippageBps] = useState<bigint>(loadSlippage)
  const [customSlip, setCustomSlip] = useState('')
  const [quote, setQuote] = useState<TradeQuote | null>(null)
  const [quoteErr, setQuoteErr] = useState<string | null>(null)
  const [quoteAt, setQuoteAt] = useState<number | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [stale, setStale] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sellStep, setSellStep] = useState<SellStep>('idle')
  const [allow, setAllow] = useState<AllowanceState | null>(null)

  const ur = env.addrUniversalRouter
  const permit2 = env.addrPermit2
  const wrongChain = isConnected && chainId !== env.chainId

  const ethBal = useBalance({ address, query: { enabled: Boolean(address) } })
  const tokenBal = useReadContract({
    address: listing.token,
    abi: erc20ApproveAbi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  })

  const amountIn = useMemo(() => {
    try {
      if (!amountStr || Number(amountStr) <= 0) return 0n
      return parseEther(amountStr as `${number}`)
    } catch {
      return 0n
    }
  }, [amountStr])

  const route = useMemo(() => {
    if (side === 'buy') {
      return resolveRoute(zeroAddress, listing.token, listing)
    }
    return resolveRoute(listing.token, zeroAddress, listing)
  }, [side, listing])

  const persistSlippage = (bps: bigint) => {
    setSlippageBps(bps)
    try {
      localStorage.setItem(SLIPPAGE_KEY, bps.toString())
    } catch {
      /* ignore */
    }
  }

  // Re-read allowances on mount / side / amount / address (sell flow survives reload).
  useEffect(() => {
    if (!client || !address || side !== 'sell' || amountIn <= 0n) {
      setAllow(null)
      setSellStep('idle')
      return
    }
    let cancelled = false
    void (async () => {
      const a = await readSellAllowances(client, address, listing.token, amountIn)
      if (cancelled) return
      if ('error' in a) {
        setAllow(null)
        return
      }
      setAllow(a)
      if (a.needsErc20Approve) setSellStep('approve-erc20')
      else if (a.needsPermit2Approve) setSellStep('approve-permit2')
      else setSellStep('sell')
    })()
    return () => {
      cancelled = true
    }
  }, [client, address, side, amountIn, listing.token])

  const runQuote = useCallback(async () => {
    if (!client || !address || route.kind !== 'supported' || amountIn <= 0n) {
      setQuote(null)
      setQuoteErr(null)
      return
    }
    if (!ur || !permit2) {
      setQuote(null)
      setQuoteErr('router addresses not configured')
      return
    }
    setQuoting(true)
    const q = await quoteExactIn({
      client,
      account: address,
      listing,
      route,
      amountIn,
      slippageBps,
      spotEthPerToken,
    })
    setQuoting(false)
    setQuoteAt(Date.now())
    if (isQuoteSuccess(q)) {
      setQuote(q)
      setQuoteErr(null)
      setStale(false)
    } else {
      setQuote(null)
      setQuoteErr(q.error)
      setStale(true)
    }
  }, [
    client,
    address,
    route,
    amountIn,
    ur,
    permit2,
    listing,
    slippageBps,
    spotEthPerToken,
  ])

  // Debounced re-quote on input + every 10s while panel open.
  useEffect(() => {
    if (amountIn <= 0n || route.kind !== 'supported') {
      setQuote(null)
      setQuoteErr(null)
      return
    }
    const t = window.setTimeout(() => void runQuote(), DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [amountIn, side, slippageBps, runQuote, route.kind])

  useEffect(() => {
    if (amountIn <= 0n || route.kind !== 'supported') return
    const id = window.setInterval(() => void runQuote(), QUOTE_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [amountIn, side, runQuote, route.kind])

  const balance =
    side === 'buy'
      ? ethBal.data?.value ?? 0n
      : typeof tokenBal.data === 'bigint'
        ? tokenBal.data
        : 0n

  const gasHeadroomWei = useMemo(() => {
    const gas = quote?.gasEstimate ?? 400_000n
    // ~1.5× gas units × 1 gwei fallback headroom for MAX on ETH buys
    return (gas * 15n) / 10n * 1_000_000_000n
  }, [quote?.gasEstimate])

  const setMax = () => {
    if (side === 'buy') {
      const leave = gasHeadroomWei
      const max = balance > leave ? balance - leave : 0n
      setAmountStr(formatEther(max))
    } else {
      setAmountStr(formatEther(balance))
    }
  }

  const disabledReason = useMemo(() => {
    if (!ur || !permit2) return 'set Universal Router + Permit2 in env (Render) then rebuild'
    if (!isConnected) return 'connect wallet'
    if (wrongChain) return `wrong chain — switch to ${env.chainId}`
    if (route.kind === 'unsupported') return route.reason
    if (amountIn <= 0n) return 'enter an amount'
    if (amountIn > balance) return 'insufficient balance'
    if (quoteErr && !quote) return `quote failed — ${quoteErr}`
    if (!quote && quoting) return 'quoting…'
    if (!quote) return 'waiting for quote'
    if (busy) return 'transaction pending'
    return null
  }, [
    ur,
    permit2,
    isConnected,
    wrongChain,
    route,
    amountIn,
    balance,
    quoteErr,
    quote,
    quoting,
    busy,
  ])

  const primaryLabel = useMemo(() => {
    if (side === 'buy') return 'buy'
    if (sellStep === 'approve-erc20') return '1 of 2: approve'
    if (sellStep === 'approve-permit2') return '1 of 2: approve permit2'
    if (sellStep === 'sell') return '2 of 2: sell'
    return 'sell'
  }, [side, sellStep])

  const onSubmit = async () => {
    if (disabledReason || !client || !address || !quote || !ur || !permit2) return
    setBusy(true)
    try {
      if (side === 'sell') {
        if (sellStep === 'approve-erc20') {
          await writeContractAsync({
            address: listing.token,
            abi: erc20ApproveAbi,
            functionName: 'approve',
            args: [permit2, maxUint256],
          })
          push('permit2 approved on token', 'ok')
          const a = await readSellAllowances(client, address, listing.token, amountIn)
          if (!('error' in a) && a.needsPermit2Approve) setSellStep('approve-permit2')
          else setSellStep('sell')
          setBusy(false)
          return
        }
        if (sellStep === 'approve-permit2') {
          const exp = defaultPermit2Expiration()
          const amt = amountIn > MAX_UINT160 ? MAX_UINT160 : amountIn
          await writeContractAsync({
            address: permit2,
            abi: permit2Abi,
            functionName: 'approve',
            args: [listing.token, ur, amt, exp],
          })
          push('router approved via permit2', 'ok')
          setSellStep('sell')
          setBusy(false)
          return
        }
      }

      const hop = quote.route.hops[0]!
      const v4 = encodeV4ExactInSingle({
        poolKey: hop.poolKey,
        zeroForOne: hop.zeroForOne,
        amountIn: quote.amountIn,
        amountOutMinimum: quote.minAmountOut,
      })
      const commands = ('0x' + (0x10).toString(16).padStart(2, '0')) as `0x${string}`
      const hash = await writeContractAsync({
        address: ur,
        abi: universalRouterAbi,
        functionName: 'execute',
        args: [commands, [v4], maxUint256],
        value: quote.value,
      })
      await client.waitForTransactionReceipt({ hash })
      push(side === 'buy' ? 'bought' : 'sold', 'ok')
      confetti()
      void ethBal.refetch?.()
      void tokenBal.refetch?.()
      void rescanSwaps?.()
      onTraded?.()
      setAmountStr('')
      setQuote(null)
    } catch (err) {
      push(formatSwapError(err).slice(0, 80), 'err')
    } finally {
      setBusy(false)
    }
  }

  const networkCostEth = quote
    ? (Number(quote.gasEstimate) * 1e9) / 1e18 // rough @ 1 gwei display
    : null

  return (
    <div className="body95">
      <div className="seg" style={{ marginBottom: 8 }}>
        <button
          type="button"
          className={`btn95${side === 'buy' ? ' on' : ''}`}
          onClick={() => {
            setSide('buy')
            setAmountStr('')
            setQuote(null)
            setQuoteErr(null)
          }}
        >
          buy
        </button>
        <button
          type="button"
          className={`btn95${side === 'sell' ? ' on' : ''}`}
          onClick={() => {
            setSide('sell')
            setAmountStr('')
            setQuote(null)
            setQuoteErr(null)
          }}
        >
          sell
        </button>
      </div>

      <label className="field95">
        <span className="lab">
          amount ({side === 'buy' ? 'ETH' : `$${listing.symbol}`})
        </span>
        <div className="inset" style={{ display: 'flex', gap: 6 }}>
          <input
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            placeholder="0.0"
            inputMode="decimal"
            style={{ flex: 1 }}
          />
          <button type="button" className="btn95" onClick={setMax}>
            MAX
          </button>
        </div>
      </label>

      <div className="dr">
        <span>you receive</span>
        <b>
          {quote
            ? side === 'buy'
              ? `${fmtToken(quote.amountOut)} $${listing.symbol}`
              : `${fmtEth(quote.amountOut)} ETH`
            : '—'}
        </b>
      </div>
      <div className="dr">
        <span>price impact</span>
        <b>{quote ? fmtPct(quote.priceImpact) : '—'}</b>
      </div>
      <div className="dr">
        <span>hook fee (1%)</span>
        <b>
          {quote
            ? side === 'buy'
              ? `${fmtEth(quote.hookFeeAmount)} ETH`
              : `${fmtToken(quote.hookFeeAmount)} $${listing.symbol}`
            : '—'}
        </b>
      </div>
      <div className="dr">
        <span>min received ({fmtBps(slippageBps)} slip)</span>
        <b>
          {quote
            ? side === 'buy'
              ? `${fmtToken(quote.minAmountOut)} $${listing.symbol}`
              : `${fmtEth(quote.minAmountOut)} ETH`
            : '—'}
        </b>
      </div>
      <div className="dr">
        <span>network cost</span>
        <b>
          {quote
            ? `~${quote.gasEstimate.toString()} gas${
                liveEthUsd != null && networkCostEth
                  ? ` (≈ $${(networkCostEth * liveEthUsd).toFixed(3)} @1 gwei)`
                  : ''
              }`
            : '—'}
        </b>
      </div>
      {stale && quoteErr && (
        <p className="hint" style={{ marginTop: 4 }}>
          quote stale — last error: {quoteErr}
        </p>
      )}
      {quoting && <p className="hint">quoting…</p>}
      {quoteAt && quote && (
        <p className="hint">
          quoted {Math.max(0, Math.round((Date.now() - quoteAt) / 1000))}s ago
        </p>
      )}

      <div style={{ marginTop: 8 }}>
        <span className="lab">slippage</span>
        <div className="btn-row" style={{ marginTop: 4 }}>
          {PRESETS.map((p) => (
            <button
              key={p.toString()}
              type="button"
              className={`btn95${slippageBps === p ? ' on' : ''}`}
              onClick={() => {
                setCustomSlip('')
                persistSlippage(p)
              }}
            >
              {fmtBps(p)}
            </button>
          ))}
          <input
            className="inset"
            style={{ width: 64 }}
            placeholder="custom %"
            value={customSlip}
            onChange={(e) => {
              setCustomSlip(e.target.value)
              const n = Number(e.target.value)
              if (Number.isFinite(n) && n >= 0 && n <= 50) {
                persistSlippage(BigInt(Math.round(n * 100)))
              }
            }}
          />
        </div>
      </div>

      <p className="hint" style={{ marginTop: 8 }}>
        this swap moves the price. the hook takes {Number(HOOK_FEE_BPS) / 100}% of
        the input. what you receive can differ from the quote.
      </p>

      {side === 'sell' && allow && (
        <p className="hint">
          {allow.needsErc20Approve || allow.needsPermit2Approve
            ? `approvals needed: ${[
                allow.needsErc20Approve ? 'ERC20→Permit2' : null,
                allow.needsPermit2Approve ? 'Permit2→router' : null,
              ]
                .filter(Boolean)
                .join(' + ')}`
            : 'approvals ok — ready to sell'}
        </p>
      )}

      <button
        type="button"
        className="btn95 big go"
        style={{ marginTop: 10, width: '100%' }}
        disabled={Boolean(disabledReason)}
        onClick={() => void onSubmit()}
      >
        {disabledReason ?? primaryLabel}
      </button>
    </div>
  )
}
