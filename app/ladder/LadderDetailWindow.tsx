import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatUnits, getAddress, parseUnits, type Address } from 'viem'
import { useAccount, usePublicClient } from 'wagmi'
import { LadderGrid } from '../components/LadderGrid'
import { env } from '../config/env'
import { useOnCorrectChain } from '../gate/ChainGuard'
import {
  hydrateAuctionByAddress,
  readWalletFill,
  refreshAuctionState,
} from '../indexer/ladderHydrate'
import {
  loadLadderEnvelope,
  loadPeriodStore,
  savePeriodStore,
} from '../indexer/ladderStorage'
import {
  LADDER_N,
  deriveLadderStatus,
  minBidRaw,
  pairDecimals,
  type IndexedAuction,
  type LadderAuctionState,
  type LadderPeriodStore,
  type LadderWalletFill,
} from '../indexer/ladderTypes'
import { confetti } from '../shell/confetti'
import { HelthBar } from '../shell/HelthBar'
import { useLadderIndex } from '../shell/LadderIndexProvider'
import { Stamp } from '../shell/Stamp'
import { useToast } from '../shell/Toast'
import { Win95Window } from '../shell/Window'
import { useWindowManager } from '../shell/windowManager'
import { loadPeriodPath, readPeriodPath, toLadderPeriodCells } from './periodCells'
import { useNowSeconds, usePairSymbol } from './ladderHooks'
import {
  LADDER_STATUS_LABEL,
  LADDER_STATUS_LONG,
  LADDER_STATUS_STAMP,
  LADDER_STATUS_TONE,
  NO_LIMIT_MAX_PRICE,
  formatBidFee,
  formatBps,
  formatClock,
  formatMinBid,
  formatPairRaw,
  formatPairWad,
  formatPct,
  formatPriceWad,
  formatRatioWad,
  formatTokens,
  isNativeBook,
  pairLabel,
  ratioOf,
  shortAddr,
  thresholdShareOfFloor,
  walletCapTokens,
} from './ladderFormat'
import {
  ladderActionGates,
  ladderActionLabel,
  useLadderActions,
  type LadderActionKind,
} from './useLadderActions'
import { bidValueNote, useLadderBid } from './useLadderBid'

/** Re-walk the period path this often while a book is live. */
const PATH_REFRESH_MS = 30_000

type CeilMode = 'x2' | 'x5' | 'x20' | 'nolimit'

const CEIL_MULT: Record<Exclude<CeilMode, 'nolimit'>, bigint> = {
  x2: 2n,
  x5: 5n,
  x20: 20n,
}

const CEIL_LABEL: Record<CeilMode, string> = {
  x2: '2× live',
  x5: '5× live',
  x20: '20× live',
  nolimit: 'no limit',
}

function explorer(path: string) {
  return `${env.explorerUrl.replace(/\/$/, '')}/${path}`
}

export function LadderDetailWindow({
  auction,
  onClose,
}: {
  auction: Address
  onClose: () => void
}) {
  const client = usePublicClient()
  const { address, isConnected } = useAccount()
  const onCorrectChain = useOnCorrectChain()
  const { auctions } = useLadderIndex()
  const { open } = useWindowManager()
  const { push } = useToast()

  const indexed =
    auctions.find(
      (A) => A.auction.toLowerCase() === auction.toLowerCase(),
    ) ?? null
  const hasIndexed = indexed != null

  const [fallback, setFallback] = useState<IndexedAuction | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [localState, setLocalState] = useState<LadderAuctionState | null>(null)
  const [fill, setFill] = useState<LadderWalletFill | null>(null)
  const [periodStore, setPeriodStore] = useState<LadderPeriodStore | null>(null)
  const [periodErr, setPeriodErr] = useState<string | null>(null)
  const [pathNonce, setPathNonce] = useState(0)

  const [sizeStr, setSizeStr] = useState('')
  const [ceilMode, setCeilMode] = useState<CeilMode>('x2')

  // The index poll owns the indexed row; a deep link falls back to a direct read.
  useEffect(() => {
    if (hasIndexed) {
      setFallback(null)
      setLoadErr(null)
      setLoading(false)
      return
    }
    if (!client) {
      setLoadErr('no rpc client')
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void (async () => {
      const rec = await hydrateAuctionByAddress(client, getAddress(auction))
      if (cancelled) return
      if (!rec) {
        setLoadErr(
          'not a ladder auction — no code at that address, or its getters reverted',
        )
      } else {
        setFallback(rec)
        setLoadErr(null)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [hasIndexed, client, auction])

  const record = indexed ?? fallback

  // A local read taken after a write beats the polled snapshot until the next tick.
  const state =
    record && localState && localState.readAt > record.state.readAt
      ? localState
      : (record?.state ?? null)

  const view: IndexedAuction | null =
    record && state ? { ...record, state } : null

  const pairSymbol = usePairSymbol(record?.pairToken)
  const status = state ? deriveLadderStatus(state) : null
  const live = status === 'live'
  const nowSec = useNowSeconds(live)

  const refreshFill = useCallback(async () => {
    if (!client || !address) {
      setFill(null)
      return
    }
    setFill(await readWalletFill(client, getAddress(auction), address))
  }, [client, address, auction])

  const refreshState = useCallback(async () => {
    if (!client) return
    const next = await refreshAuctionState(client, getAddress(auction))
    if (next) setLocalState(next)
  }, [client, auction])

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshState(), refreshFill()])
  }, [refreshState, refreshFill])

  useEffect(() => {
    void refreshFill()
  }, [refreshFill])

  // Keyed on the title, not on `record`: the index poll hands back a fresh object
  // every 12s and open() bumps z, which would yank this window in front of
  // whatever the user was actually looking at.
  const winTitle = record
    ? `${record.symbol.toLowerCase()}.ipo — bookbuild`
    : null

  useEffect(() => {
    if (!winTitle) return
    open(`ladder:${auction}` as `ladder:${string}`, winTitle)
  }, [winTitle, auction, open])

  // Period path → grid cells. Events resume behind a cursor; a deep-linked
  // auction has no filing block to scan from, so it takes the path reads.
  useEffect(() => {
    if (!client || !record) return
    let cancelled = false
    const ac = new AbortController()
    void (async () => {
      try {
        const factory = env.addrLadderFactory
        const envl =
          factory && !record.notYetIndexed
            ? loadLadderEnvelope(env.chainId, factory)
            : null
        const prior = envl ? loadPeriodStore(envl, getAddress(auction)) : null
        const store =
          record.blockNumber === '0'
            ? await readPeriodPath(
                client,
                getAddress(auction),
                record.state.periodIndex,
              )
            : await loadPeriodPath(client, record, prior, { signal: ac.signal })
        if (cancelled) return
        setPeriodStore(store)
        setPeriodErr(null)
        if (envl && store.source === 'events') savePeriodStore(envl, store)
      } catch (err) {
        if (cancelled || ac.signal.aborted) return
        setPeriodErr(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
      ac.abort()
    }
    // record identity churns on every poll tick; the path only needs the address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, auction, hasIndexed, pathNonce])

  useEffect(() => {
    if (!live) return
    const id = window.setInterval(
      () => setPathNonce((n) => n + 1),
      PATH_REFRESH_MS,
    )
    return () => window.clearInterval(id)
  }, [live])

  const bid = useLadderBid(view, {
    pairSymbol,
    onDone: () => {
      push('bid placed', 'ok')
      confetti()
      void refreshAll()
      setSizeStr('')
      setPathNonce((n) => n + 1)
    },
  })

  const actions = useLadderActions(view, {
    onDone: (kind: LadderActionKind) => {
      push(`${ladderActionLabel(kind)} — done`, 'ok')
      if (kind === 'claimRefund' || kind === 'claimTokens') confetti()
      void refreshAll()
      setPathNonce((n) => n + 1)
    },
  })

  const decimals = view ? pairDecimals(view.pairScaleToWad) : 18
  const minRaw = view ? minBidRaw(view) : 0n

  const sizeRaw = useMemo(() => {
    if (!sizeStr.trim()) return 0n
    try {
      return parseUnits(sizeStr.trim(), decimals)
    } catch {
      return 0n
    }
  }, [sizeStr, decimals])

  const basePriceWad = useMemo(() => {
    if (!view) return 0n
    const p = BigInt(view.state.price)
    return p > 0n ? p : BigInt(view.floorPrice)
  }, [view])

  const maxPriceWad =
    ceilMode === 'nolimit'
      ? NO_LIMIT_MAX_PRICE
      : basePriceWad * CEIL_MULT[ceilMode]

  const gates = ladderActionGates(view, status, fill, isConnected)

  // A hydrateError row carries zeroed immutables, so every number below would be
  // a lie. Show the failure instead.
  const unreadable = view?.hydrateError ?? null

  if (!view || !state || !status || unreadable) {
    return (
      <Win95Window
        id={`ladder:${auction}`}
        title="ipo.exe — bookbuild"
        width={560}
        onClose={onClose}
      >
        <a
          className="back btn95"
          href="#/ladder"
          onClick={() => {
            onClose()
          }}
        >
          ← back to the ipo desk
        </a>
        <p className={loadErr || unreadable ? 'check bad' : 'hint'}>
          {unreadable
            ? `this auction is filed on chain but its getters would not answer — ${unreadable}`
            : (loadErr ??
              (loading ? 'reading the book from chain…' : 'loading…'))}
        </p>
        <p className="hint">
          auction{' '}
          <a
            href={explorer(`address/${auction}`)}
            target="_blank"
            rel="noreferrer"
          >
            {shortAddr(auction)}
          </a>
        </p>
      </Win95Window>
    )
  }

  const a = view
  const unit = pairLabel(a, pairSymbol)
  const native = isNativeBook(a)
  const n = a.n || LADDER_N
  const raiseFrac = ratioOf(state.raised, a.threshold)
  const cap = walletCapTokens(a)
  const gateShare = thresholdShareOfFloor(a)
  const cells = toLadderPeriodCells(periodStore, n)

  // Committed budget that has NOT yet converted into `raised`. These are different quantities and the gate
  // reads the second one, so a freshly bid book legitimately sits at 0% of gate with real money committed —
  // which looks broken unless we say so. Worth spelling out rather than conflating the two.
  const queuedWad = (() => {
    const committed = BigInt(state.committedTotal)
    const raised = BigInt(state.raised)
    return committed > raised ? committed - raised : 0n
  })()

  const bidDisabled = (() => {
    if (!isConnected) return 'connect a wallet to bid'
    if (!onCorrectChain) return 'wrong network — switch before you bid'
    if (state.done) return 'the bell already rang'
    if (bid.busy) return 'transaction pending'
    if (sizeRaw <= 0n) return 'enter a budget'
    if (sizeRaw < minRaw) {
      return `minimum is ${formatUnits(minRaw, decimals)} ${unit}`
    }
    return null
  })()

  return (
    <Win95Window
      id={`ladder:${auction}`}
      title={`${a.symbol.toLowerCase()}.ipo — bookbuild`}
      titleTone={LADDER_STATUS_TONE[status]}
      width={560}
      onClose={onClose}
    >
      <a
        className="back btn95"
        href="#/ladder"
        onClick={() => {
          onClose()
        }}
      >
        ← back to the ipo desk
      </a>

      <div className="coinrow" style={{ marginBottom: 8 }}>
        <div className="coinic">
          {a.symbol.slice(0, 1).toUpperCase() || '?'}
        </div>
        <div className="grow">
          <div className="tk">
            ${a.symbol}{' '}
            <Stamp variant={LADDER_STATUS_STAMP[status]}>
              {LADDER_STATUS_LABEL[status]}
            </Stamp>
          </div>
          <div className="nm">{a.name}</div>
        </div>
      </div>

      <div className="bigpx">
        {formatPriceWad(state.price)}{' '}
        <span style={{ fontSize: 13 }}>{unit}/token</span>
      </div>
      <div className="mono" style={{ fontSize: 11.5, marginBottom: 6 }}>
        {LADDER_STATUS_LONG[status]} · {formatClock(a, nowSec)} · rung{' '}
        {state.rung} · period {state.periodIndex} of {n}
      </div>

      {a.notYetIndexed && (
        <p className="hint">not in the local index — read straight from chain</p>
      )}

      {status === 'filed' && (
        <div className="win" style={{ marginTop: 8 }}>
          <div className="title">⏳ clock has not started</div>
          <div className="body95">
            <p className="hint" style={{ textAlign: 'left', marginTop: 0 }}>
              startTime is still zero. all {n} periods are sitting there
              unspent, and nothing is ticking. the FIRST BID stamps the start
              time and starts the whole ladder running for everybody — so if you
              bid now you are the one who rings the opening bell. it can sit
              like this indefinitely.
            </p>
          </div>
        </div>
      )}

      {status === 'failed' && (
        <div className="win" style={{ marginTop: 8 }}>
          <div className="title red">↩ this book failed — your money is here</div>
          <div className="body95">
            <p className="check bad" style={{ marginBottom: 6 }}>
              the gates did not clear at the bell, so the auction did not
              graduate.
            </p>
            <p className="hint" style={{ textAlign: 'left', marginTop: 0 }}>
              THIS IS NOT A LOSS. a failed ladder hands every bidder their FULL
              committed amount back — no tokens are delivered and no cash is
              kept. there is nothing to sell and nothing to wait for. claim it
              below.
            </p>
          </div>
        </div>
      )}

      <HelthBar
        ratio={raiseFrac}
        labelLeft={`RAISED ${formatPairWad(state.raised)} ${unit}`}
        labelRight={`GATE ${formatPairWad(a.threshold)} · ${formatPct(raiseFrac)}`}
      />
      <p className="hint" style={{ textAlign: 'left', marginTop: 0 }}>
        graduation gate: `raised` has to reach `threshold` at the bell
        {gateShare != null
          ? ` — this book's threshold is ${formatPct(gateShare)} of its filed floor mcap`
          : ''}
        . under it, the book fails and everyone is refunded in full.
      </p>
      {queuedWad > 0n && (
        <p className="hint" style={{ textAlign: 'left', marginTop: 0 }}>
          <b>
            {formatPairWad(queuedWad.toString())} {unit} of budget is committed but not yet
            converted.
          </b>{' '}
          a bid is a <i>budget</i>, not a purchase: it converts into `raised` only as periods clear
          and tokens actually change hands ({state.periodIndex} of {n} cleared so far). so the bar
          above can read 0% while the book is fully funded — poke it, or wait for the next period.
        </p>
      )}

      <div className="win" style={{ marginTop: 12 }}>
        <div className="title">🔍 the book</div>
        <div className="body95">
          <div className="dr">
            <span>status</span>
            <b>{LADDER_STATUS_LONG[status]}</b>
          </div>
          <div className="dr">
            <span>live price</span>
            <b className="mono">
              {formatPriceWad(state.price)} {unit}
            </b>
          </div>
          <div className="dr">
            <span>floor price</span>
            <b className="mono">
              {formatPriceWad(a.floorPrice)} {unit}
            </b>
          </div>
          <div className="dr">
            <span>rung</span>
            <b className="mono">{state.rung}</b>
          </div>
          <div className="dr">
            <span>period</span>
            <b className="mono">
              {state.periodIndex} / {n}
            </b>
          </div>
          <div className="dr">
            <span>raised</span>
            <b className="mono">
              {formatPairWad(state.raised)} / {formatPairWad(a.threshold)} {unit}
            </b>
          </div>
          <div className="dr">
            <span>committed</span>
            <b className="mono">
              {formatPairWad(state.committedTotal)} {unit}
            </b>
          </div>
          <div className="dr">
            <span>sold</span>
            <b className="mono">
              {formatTokens(state.soldTokens)} of{' '}
              {formatTokens(a.auctionSupply)} $
              {a.symbol}
            </b>
          </div>
          <div className="dr">
            <span>lp health</span>
            <b className="mono">
              {state.done
                ? `${formatRatioWad(state.lpHealth)} vs target ${formatRatioWad(a.lpHealthTargetWad)}`
                : `target ${formatRatioWad(a.lpHealthTargetWad)} — only computed at the bell`}
            </b>
          </div>
          <div className="dr">
            <span>unique bidders</span>
            <b className="mono">{state.uniqueBidders}</b>
          </div>
          <div className="dr">
            <span>pair</span>
            <b className="mono">
              {native ? (
                'native ETH'
              ) : (
                <a
                  href={explorer(`address/${a.pairToken}`)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {unit} · {shortAddr(a.pairToken)}
                </a>
              )}
            </b>
          </div>
          <div className="dr">
            <span>min bid</span>
            <b className="mono">
              {formatMinBid(a)} {unit}
            </b>
          </div>
          <div className="dr">
            <span>wallet cap</span>
            <b className="mono">
              {cap > 0n
                ? `${formatTokens(cap)} $${a.symbol} (${formatBps(a.walletCapBps)} of supply)`
                : 'uncapped'}
            </b>
          </div>
          <div className="dr">
            <span>creator</span>
            <b>
              <a
                href={explorer(`address/${a.creator}`)}
                target="_blank"
                rel="noreferrer"
              >
                {shortAddr(a.creator)}
              </a>
            </b>
          </div>
        </div>
      </div>

      <div className="win" style={{ marginTop: 12 }}>
        <div className="title">🪜 the ladder — {n} periods</div>
        <div className="body95">
          {cells.length === 0 ? (
            <p className="hint" style={{ marginTop: 0 }}>
              {periodErr
                ? `could not read the period path — ${periodErr}`
                : 'no period has cleared yet. the grid fills in left to right, bottom to top, as the book walks its rungs.'}
            </p>
          ) : (
            <>
              <LadderGrid
                periods={cells}
                currentPeriod={
                  state.periodIndex > 0 ? state.periodIndex : undefined
                }
              />
              <p className="hint" style={{ textAlign: 'left' }}>
                {periodStore?.stride && periodStore.stride > 1
                  ? `sampled every ${periodStore.stride}th period — each cell stands for its window, not a single period`
                  : 'green = sold, outline = offered and untouched, grey = idle skip'}
                {periodStore?.source === 'path'
                  ? ' · read from the path views'
                  : ''}
              </p>
            </>
          )}
        </div>
      </div>

      {(status === 'filed' || status === 'live') && (
        <div className="win" style={{ marginTop: 12 }}>
          <div className="title">💰 place a bid</div>
          <div className="body95">
            <label className="field95">
              <span className="lab">budget ({unit})</span>
              <div className="inset" style={{ display: 'flex', gap: 6 }}>
                <input
                  value={sizeStr}
                  onChange={(e) => setSizeStr(e.target.value)}
                  placeholder={minRaw > 0n ? formatUnits(minRaw, decimals) : '0.01'}
                  inputMode="decimal"
                  style={{ flex: 1 }}
                />
                {minRaw > 0n && (
                  <button
                    type="button"
                    className="btn95"
                    onClick={() => setSizeStr(formatUnits(minRaw, decimals))}
                  >
                    MIN
                  </button>
                )}
              </div>
            </label>

            <span className="lab">price ceiling</span>
            <div className="btn-row" style={{ marginTop: 4 }}>
              {(['x2', 'x5', 'x20', 'nolimit'] as CeilMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`btn95${ceilMode === m ? ' on' : ''}`}
                  onClick={() => setCeilMode(m)}
                >
                  {CEIL_LABEL[m]}
                </button>
              ))}
            </div>
            <p className="hint" style={{ textAlign: 'left' }}>
              your ceiling is{' '}
              {ceilMode === 'nolimit'
                ? 'unlimited — your budget keeps converting no matter how high the ladder climbs'
                : `${formatPriceWad(maxPriceWad)} ${unit}/token`}
              . if the live price passes your ceiling your budget stops
              converting and the unspent part comes back as a refund. it never
              becomes a loss.
            </p>

            {minRaw > 0n && (
              <div className="dr">
                <span>minimum bid</span>
                <b className="mono">
                  {formatMinBid(a)} {unit}
                </b>
              </div>
            )}
            <div className="dr">
              <span>bid fee</span>
              <b className="mono">{formatBidFee(a)}</b>
            </div>
            <div className="dr">
              <span>how it is sent</span>
              <b>{bidValueNote(a)}</b>
            </div>

            <button
              type="button"
              className="btn95 big go"
              style={{ marginTop: 10, width: '100%' }}
              disabled={Boolean(bidDisabled)}
              onClick={() => void bid.run({ sizeRaw, maxPriceWad })}
            >
              {bidDisabled ?? (status === 'filed' ? 'bid + start the clock' : 'place bid')}
            </button>
            {bid.status && (
              <p className={bid.error ? 'check bad' : 'hint'}>{bid.status}</p>
            )}
            {bid.txHash && (
              <p className="hint">
                <a
                  href={explorer(`tx/${bid.txHash}`)}
                  target="_blank"
                  rel="noreferrer"
                >
                  bid tx on explorer
                </a>
              </p>
            )}
          </div>
        </div>
      )}

      {address && (
        <div className="win" style={{ marginTop: 12 }}>
          <div className="title">🧍 your position</div>
          <div className="body95">
            {!fill || !fill.exists ? (
              <p className="hint" style={{ marginTop: 0 }}>
                this wallet has never bid into this book.
              </p>
            ) : (
              <>
                <div className="dr">
                  <span>committed</span>
                  <b className="mono">
                    {formatPairRaw(fill.committed, a)} {unit}
                  </b>
                </div>
                <div className="dr">
                  <span>spent</span>
                  <b className="mono">
                    {formatPairRaw(fill.spent, a)} {unit}
                  </b>
                </div>
                <div className="dr">
                  <span>tokens</span>
                  <b className="mono">
                    {formatTokens(fill.tokens)} ${a.symbol}
                    {fill.tokensClaimed ? ' · claimed' : ''}
                  </b>
                </div>
                <div className="dr">
                  <span>{state.done ? 'refund' : 'unspent so far'}</span>
                  <b className="mono">
                    {formatPairRaw(fill.refund, a)} {unit}
                    {fill.refundClaimed ? ' · claimed' : ''}
                  </b>
                </div>
                <div className="dr">
                  <span>your ceiling</span>
                  <b className="mono">
                    {formatPriceWad(fill.maxPrice)} {unit}/token
                  </b>
                </div>
                {cap > 0n && (
                  <div className="dr">
                    <span>against your cap</span>
                    <b className="mono">
                      {formatTokens(fill.tokens)} / {formatTokens(cap)} $
                      {a.symbol}
                    </b>
                  </div>
                )}
                {!state.done && (
                  <p className="hint" style={{ textAlign: 'left' }}>
                    unspent budget is not withdrawable while the book is live —
                    there is no cancel. it converts, or it is refunded at the
                    bell.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {(gates.poke.show ||
        gates.settle.show ||
        gates.claimTokens.show ||
        gates.claimRefund.show) && (
        <div className="win" style={{ marginTop: 12 }}>
          <div className="title">🔧 what you can do</div>
          <div className="body95">
            {(
              ['claimRefund', 'claimTokens', 'settle', 'poke'] as LadderActionKind[]
            ).map((kind) => {
              const g = gates[kind]
              if (!g.show) return null
              const isRefund = kind === 'claimRefund'
              const amount =
                isRefund && fill
                  ? ` — ${formatPairRaw(fill.refund, a)} ${unit}`
                  : kind === 'claimTokens' && fill
                    ? ` — ${formatTokens(fill.tokens)} $${a.symbol}`
                    : ''
              return (
                <div key={kind} style={{ marginBottom: 10 }}>
                  <button
                    type="button"
                    className={`btn95${isRefund ? ' big go' : ''}`}
                    style={isRefund ? { width: '100%' } : undefined}
                    disabled={
                      !g.enabled || !onCorrectChain || actions.pending != null
                    }
                    onClick={() => void actions.run(kind)}
                  >
                    {actions.pending === kind
                      ? `${ladderActionLabel(kind)}…`
                      : `${ladderActionLabel(kind)}${amount}`}
                  </button>
                  {g.note && (
                    <p className="hint" style={{ textAlign: 'left' }}>
                      {g.note}
                    </p>
                  )}
                </div>
              )
            })}
            {isConnected && !onCorrectChain && (
              <p className="check bad">
                wrong network — switch before any of this will go through
              </p>
            )}
            {actions.status && (
              <p className={actions.error ? 'check bad' : 'hint'}>
                {actions.status}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="btn-row" style={{ marginTop: 10 }}>
        <button type="button" className="btn95" onClick={() => void refreshAll()}>
          refresh
        </button>
        <button
          type="button"
          className="btn95"
          onClick={() => setPathNonce((v) => v + 1)}
        >
          re-read the ladder
        </button>
        <a
          className="btn95"
          href={explorer(`address/${a.auction}`)}
          target="_blank"
          rel="noreferrer"
        >
          auction on explorer
        </a>
        <a
          className="btn95"
          href={explorer(`address/${a.token}`)}
          target="_blank"
          rel="noreferrer"
        >
          token on explorer
        </a>
      </div>
    </Win95Window>
  )
}
