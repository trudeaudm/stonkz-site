/**
 * file_book.exe — the filing side of the ipo desk.
 *
 * Only the members a filer is meant to choose are inputs. The rest is either derived from the tier
 * (duration, lpHealthTarget), arithmetic (lpShareWad), or stamped on-chain by the factory
 * (createSidePool, sidePoolBps, refPriceWad, treasury, vaultRef, settlement) — those are shown as
 * read-only consequences so a filer can see what the protocol is deciding for them.
 *
 * The one unit trap: `floor mcap` is in DOLLARS. Every other money figure on the ladder screens is
 * pair currency (wei on a native book), and the auction converts the dollar floor itself using the
 * eth/usd rate stamped at filing. The preview below spells out both sides of that conversion.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  formatEther,
  formatUnits,
  parseUnits,
  zeroAddress,
  type Address,
} from 'viem'
import { useAccount, usePublicClient, useReadContract, useReadContracts } from 'wagmi'
import { ladderFactoryAbi } from '../abi/ladderFactory'
import { env } from '../config/env'
import { useOnCorrectChain } from '../gate/ChainGuard'
import { useLadderIndex } from '../shell/LadderIndexProvider'
import { Stamp } from '../shell/Stamp'
import { useToast } from '../shell/Toast'
import { Win95Window } from '../shell/Window'
import { formatBps, formatDuration, formatRatioWad, shortAddr } from './ladderFormat'
import {
  CASH_HOLDBACK_BPS_MAX,
  LADDER_TIERS,
  TIER_DURATION,
  TIER_HOLDBACK_BPS_MAX,
  TIER_LABEL,
  TIER_LP_HEALTH_WAD,
  USDG_ADDRESS,
  WALLET_CAP_BPS_MAX,
  WALLET_CAP_BPS_MIN,
  floorMcapPair,
  lpShareWadFor,
  useLadderFile,
  type LadderFileDraft,
  type LadderTier,
} from './useLadderFile'

/** 1,000,000,000 tokens — what the drill files, and a sane default for a bookbuild. */
const DEFAULT_SUPPLY_HUMAN = '1000000000'
const DEFAULT_FLOOR_USD = '10000'

const RATE_REFRESH_MS = 30_000

type Check = { ok: boolean; label: string; detail: string }

function explorer(path: string) {
  return `${env.explorerUrl.replace(/\/$/, '')}/${path}`
}

/** address(0) is native ETH on this factory — not a missing value. */
function pairTokenFor(usdg: boolean): Address {
  return usdg ? USDG_ADDRESS : zeroAddress
}

export function LadderFileForm({
  onClose,
  onOpen,
}: {
  onClose: () => void
  onOpen: (auction: Address) => void
}) {
  const { address, isConnected } = useAccount()
  const client = usePublicClient()
  const onCorrectChain = useOnCorrectChain()
  const { refresh } = useLadderIndex()
  const { push } = useToast()
  const factoryAddr = env.addrLadderFactory

  const [symbol, setSymbol] = useState('')
  const [name, setName] = useState('')
  const [supplyHuman, setSupplyHuman] = useState(DEFAULT_SUPPLY_HUMAN)
  const [floorUsd, setFloorUsd] = useState(DEFAULT_FLOOR_USD)
  const [tier, setTier] = useState<LadderTier>(2)
  const [pairIsUsdg, setPairIsUsdg] = useState(false)
  const [holdbackBps, setHoldbackBps] = useState(0)
  const [cashHoldbackBps, setCashHoldbackBps] = useState(500)
  const [walletCapBps, setWalletCapBps] = useState(500)
  const [sizeBonusBps, setSizeBonusBps] = useState(1000)
  const [maxUniqueActives, setMaxUniqueActives] = useState(300)
  /** Display only — the hook re-reads the rate immediately before it mines. */
  const [liveEthUsdWad, setLiveEthUsdWad] = useState<bigint | null>(null)
  const [rateError, setRateError] = useState<string | null>(null)

  const file = useLadderFile({
    onDone: (r) => {
      push(`book filed — ${shortAddr(r.auction)}`, 'ok')
      // The desk indexes AuctionFiled from the chain, so it needs a rescan to see this one.
      refresh()
    },
  })

  const reads = useReadContracts({
    contracts: factoryAddr
      ? [
          {
            address: factoryAddr,
            abi: ladderFactoryAbi,
            functionName: 'deploysEnabled',
          },
          {
            address: factoryAddr,
            abi: ladderFactoryAbi,
            functionName: 'allowlistCount',
          },
          {
            address: factoryAddr,
            abi: ladderFactoryAbi,
            functionName: 'defaultCarveBps',
          },
          {
            address: factoryAddr,
            abi: ladderFactoryAbi,
            functionName: 'carveTreasury',
          },
          {
            address: factoryAddr,
            abi: ladderFactoryAbi,
            functionName: 'vaultRef',
          },
          {
            address: factoryAddr,
            abi: ladderFactoryAbi,
            functionName: 'defaultCreateSidePool',
          },
          {
            address: factoryAddr,
            abi: ladderFactoryAbi,
            functionName: 'defaultSidePoolBps',
          },
          {
            address: factoryAddr,
            abi: ladderFactoryAbi,
            functionName: 'sideTokenRef',
          },
          {
            address: factoryAddr,
            abi: ladderFactoryAbi,
            functionName: 'ethUsdStampBandBps',
          },
        ]
      : [],
    query: { enabled: Boolean(factoryAddr) },
  })

  const deploysEnabled = reads.data?.[0]?.result as boolean | undefined
  const allowlistCount = reads.data?.[1]?.result as bigint | undefined
  const defaultCarveBps = reads.data?.[2]?.result as number | undefined
  const carveTreasury = reads.data?.[3]?.result as Address | undefined
  const vaultRef = reads.data?.[4]?.result as Address | undefined
  const defCreateSide = reads.data?.[5]?.result as boolean | undefined
  const defSideBps = reads.data?.[6]?.result as number | undefined
  const sideTokenRef = reads.data?.[7]?.result as Address | undefined
  const stampBandBps = reads.data?.[8]?.result as number | undefined

  const allowed = useReadContract({
    address: factoryAddr,
    abi: ladderFactoryAbi,
    functionName: 'isDeployerAllowed',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(factoryAddr && address) },
  })

  // The stamped side pool needs a (sideToken, pair) reference price, and the miss reverts inside
  // auctionInitCodeHash — i.e. before the user's wallet ever opens, with no useful message.
  const refConfigured = useReadContract({
    address: factoryAddr,
    abi: ladderFactoryAbi,
    functionName: 'refPriceConfigured',
    args: sideTokenRef ? [sideTokenRef, pairTokenFor(pairIsUsdg)] : undefined,
    query: {
      enabled: Boolean(
        factoryAddr && defCreateSide === true && sideTokenRef && sideTokenRef !== zeroAddress,
      ),
    },
  })

  useEffect(() => {
    if (!client || !factoryAddr) return
    let cancelled = false
    const read = async () => {
      try {
        const wad = await client.readContract({
          address: factoryAddr,
          abi: ladderFactoryAbi,
          functionName: 'currentEthUsdWad',
        })
        if (!cancelled) {
          setLiveEthUsdWad(wad)
          setRateError(null)
        }
      } catch (err) {
        if (cancelled) return
        setLiveEthUsdWad(null)
        setRateError(err instanceof Error ? err.message : String(err))
      }
    }
    void read()
    const id = window.setInterval(() => void read(), RATE_REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [client, factoryAddr])

  const pairToken = pairTokenFor(pairIsUsdg)
  const nativeBook = pairToken === zeroAddress
  const holdbackCeiling = TIER_HOLDBACK_BPS_MAX[tier]
  const carveBps = defaultCarveBps ?? null

  const supply = useMemo(() => {
    const digits = supplyHuman.replace(/[^\d]/g, '')
    if (!digits) return 0n
    try {
      return BigInt(digits) * 10n ** 18n
    } catch {
      return 0n
    }
  }, [supplyHuman])

  const floorMcapUsdWad = useMemo(() => {
    const t = floorUsd.trim()
    if (!t) return 0n
    try {
      return parseUnits(t, 18)
    } catch {
      return 0n
    }
  }, [floorUsd])

  const lpShareWad =
    carveBps == null ? null : lpShareWadFor(carveBps, cashHoldbackBps)

  const floorPairPreview =
    liveEthUsdWad == null
      ? null
      : floorMcapPair(floorMcapUsdWad, pairToken, liveEthUsdWad)

  const formError = useMemo(() => {
    if (!symbol.trim()) return 'give it a ticker'
    if (!name.trim()) return 'give it a name'
    if (supply <= 0n) return 'supply has to be above zero'
    if (floorMcapUsdWad <= 0n) return 'floor mcap has to be above zero dollars'
    // A cleared or half-typed number input reads back as NaN, which slips past every bound below.
    const ints = [
      holdbackBps,
      cashHoldbackBps,
      walletCapBps,
      sizeBonusBps,
      maxUniqueActives,
    ]
    if (ints.some((v) => !Number.isInteger(v))) {
      return 'the bps fields need whole numbers'
    }
    if (holdbackBps < 0 || holdbackBps > holdbackCeiling) {
      return `holdback on ${TIER_LABEL[tier]} tops out at ${formatBps(holdbackCeiling)} of supply — over it the factory reverts HoldbackCeiling`
    }
    if (cashHoldbackBps < 0 || cashHoldbackBps > CASH_HOLDBACK_BPS_MAX) {
      return `cash holdback tops out at ${formatBps(CASH_HOLDBACK_BPS_MAX)} of the raise`
    }
    if (
      walletCapBps < WALLET_CAP_BPS_MIN ||
      walletCapBps > WALLET_CAP_BPS_MAX
    ) {
      return `wallet cap has to sit between ${formatBps(WALLET_CAP_BPS_MIN)} and ${formatBps(WALLET_CAP_BPS_MAX)} of total supply — a hard contract bound`
    }
    if (sizeBonusBps < 0 || sizeBonusBps > 10_000) {
      return 'size bonus is bps — keep it between 0 and 10000'
    }
    if (maxUniqueActives < 0 || maxUniqueActives > 65_535) {
      return 'max unique bidders has to fit in a uint16'
    }
    if (carveBps != null && carveBps + cashHoldbackBps >= 10_000) {
      return 'carve + cash holdback would eat the entire raise, leaving nothing for the lp'
    }
    return null
  }, [
    symbol,
    name,
    supply,
    floorMcapUsdWad,
    holdbackBps,
    holdbackCeiling,
    tier,
    cashHoldbackBps,
    walletCapBps,
    sizeBonusBps,
    maxUniqueActives,
    carveBps,
  ])

  const checks: Check[] = useMemo(() => {
    const list: Check[] = []

    list.push({
      ok: Boolean(address) && onCorrectChain,
      label: 'wallet',
      detail: !isConnected
        ? 'connect a wallet to file'
        : !onCorrectChain
          ? `wrong network — switch to chain ${env.chainId}`
          : `filing as ${shortAddr(address ?? zeroAddress)}`,
    })

    list.push({
      ok: deploysEnabled === true,
      label: 'deploysEnabled',
      detail:
        deploysEnabled === undefined
          ? 'reading the factory switch…'
          : deploysEnabled
            ? 'filing is switched on at the factory'
            : 'filing is switched off at the factory — every file() reverts DeploysOff',
    })

    // Empty allowlist means open filing; non-empty means allowlisted only. Right now exactly one
    // address is on it, so most wallets land on the bad branch — say so plainly instead of letting
    // them pay gas to learn it.
    const count = allowlistCount ?? 0n
    const gateOpen = count === 0n
    const isAllowed = gateOpen || allowed.data === true
    list.push({
      ok: Boolean(address) && isAllowed,
      label: 'isDeployerAllowed',
      detail: !address
        ? 'connect wallet'
        : gateOpen
          ? 'the allowlist is empty — filing is open to anyone'
          : isAllowed
            ? `this wallet is on the filing allowlist (${count.toString()} entr${count === 1n ? 'y' : 'ies'})`
            : `this wallet is NOT permitted to file. the factory allowlist has ${count.toString()} entr${count === 1n ? 'y' : 'ies'} and this is not one of them, so file() would revert DeployerNotAllowed and cost you gas for nothing.`,
    })

    list.push({
      ok: liveEthUsdWad != null && liveEthUsdWad > 0n,
      label: 'currentEthUsdWad',
      detail:
        liveEthUsdWad != null && liveEthUsdWad > 0n
          ? `eth/usd $${Number(formatEther(liveEthUsdWad)).toFixed(2)} from the reference pools${
              stampBandBps != null
                ? ` · the chain accepts a stamp within ±${(stampBandBps / 100).toFixed(2)}% of its own reading`
                : ''
            }`
          : `the factory will not quote eth/usd${rateError ? ` — ${rateError}` : ''}. filing needs a fresh rate, so it is blocked.`,
    })

    list.push({
      ok: Boolean(carveTreasury && carveTreasury !== zeroAddress),
      label: 'carveTreasury',
      detail:
        carveTreasury === undefined
          ? 'reading the carve treasury…'
          : carveTreasury === zeroAddress
            ? 'the factory has no carve treasury, so it refuses to file anything (CarveTreasuryUnset)'
            : `carve is paid to ${shortAddr(carveTreasury)} — stamped, not yours to set`,
    })

    if (defCreateSide === true) {
      const sideOk = Boolean(sideTokenRef && sideTokenRef !== zeroAddress)
      list.push({
        ok: sideOk,
        label: 'sideTokenRef',
        detail: sideOk
          ? `side pool on at ${formatBps(defSideBps ?? 0)} of lp tokens — set by protocol`
          : 'the factory wants a side pool but has no side-token ref — filing reverts SideTokenRefUnset',
      })
      if (sideOk) {
        list.push({
          ok: refConfigured.data === true,
          label: 'refPriceConfigured',
          detail:
            refConfigured.data === true
              ? `side-pool reference price is configured for ${nativeBook ? 'the ETH' : 'the USDG'} pair`
              : `no side-pool reference price for ${nativeBook ? 'the ETH' : 'the USDG'} pair — filing reverts RefPriceUnset before your wallet even opens`,
        })
      }
    }

    if (holdbackBps > 0) {
      const vaultOk = Boolean(vaultRef && vaultRef !== zeroAddress)
      list.push({
        ok: vaultOk,
        label: 'vaultRef',
        detail: vaultOk
          ? `holdback goes to the vault at ${shortAddr(vaultRef ?? zeroAddress)}`
          : 'a holdback needs a vault and the factory has none — either set holdback to 0 or wait for an admin (VaultRequiredForHoldback)',
      })
    }

    return list
  }, [
    address,
    isConnected,
    onCorrectChain,
    deploysEnabled,
    allowlistCount,
    allowed.data,
    liveEthUsdWad,
    stampBandBps,
    rateError,
    carveTreasury,
    defCreateSide,
    defSideBps,
    sideTokenRef,
    refConfigured.data,
    nativeBook,
    holdbackBps,
    vaultRef,
  ])

  const allGreen = checks.every((c) => c.ok)
  const canSubmit = allGreen && !formError && !file.busy && Boolean(factoryAddr)

  const draft: LadderFileDraft = {
    name,
    symbol,
    supply,
    floorMcapUsdWad,
    tier,
    pairToken,
    holdbackBps,
    cashHoldbackBps,
    walletCapBps,
    sizeBonusBps,
    maxUniqueActives,
  }

  if (!factoryAddr) {
    return (
      <Win95Window
        id="ladder_file"
        title="🪜 file_book.exe — new ladder auction"
        titleTone="red"
        width={560}
        onClose={onClose}
      >
        <div className="win" style={{ marginTop: 8 }}>
          <div className="title red">⚠ no factory</div>
          <div className="body95">
            <p className="check bad">
              VITE_ADDR_LADDER_FACTORY is not set in this build.
            </p>
            <p className="hint" style={{ textAlign: 'left' }}>
              nothing to file against, so this form has no address to point at.
              it lights up on the next deploy.
            </p>
          </div>
        </div>
      </Win95Window>
    )
  }

  if (file.receipt) {
    const r = file.receipt
    return (
      <Win95Window
        id="ladder_file"
        title="🪜 file_book.exe — filed"
        titleTone="green"
        width={560}
        onClose={() => {
          file.reset()
          onClose()
        }}
      >
        <div className="cert-stamp-row">
          <Stamp variant="stonkz">FILED</Stamp>
        </div>
        <div className="win" style={{ marginTop: 8 }}>
          <div className="title">📄 the book is on chain</div>
          <div className="body95">
            <div className="dr">
              <span>auction</span>
              <b className="mono">
                <a
                  href={explorer(`address/${r.auction}`)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {r.auction}
                </a>
              </b>
            </div>
            <div className="dr">
              <span>creator</span>
              <b className="mono">{shortAddr(r.creator)}</b>
            </div>
            <div className="dr">
              <span>carve (stamped)</span>
              <b className="mono">{formatBps(r.carveBps)} of the raise</b>
            </div>
            <div className="dr">
              <span>holdback</span>
              <b className="mono">{formatBps(r.holdbackBps)} of supply</b>
            </div>
            <div className="dr">
              <span>vanity mine</span>
              <b className="mono">{r.attempts.toLocaleString()} attempts</b>
            </div>
            <div className="dr">
              <span>eth/usd stamp</span>
              <b className="mono">
                ${Number(formatEther(r.ethUsdWad)).toFixed(2)}
              </b>
            </div>
            <p className="hint" style={{ textAlign: 'left' }}>
              the clock is not running yet. startTime stays zero until the FIRST
              BID, and that bid rings the opening bell for everybody.
            </p>
          </div>
        </div>
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn95 big go"
            onClick={() => {
              file.reset()
              onOpen(r.auction)
            }}
          >
            open the book
          </button>
          <a
            className="btn95"
            href={explorer(`tx/${r.txHash}`)}
            target="_blank"
            rel="noreferrer"
          >
            filing tx on explorer
          </a>
          <button type="button" className="btn95" onClick={() => file.reset()}>
            file another
          </button>
        </div>
      </Win95Window>
    )
  }

  return (
    <Win95Window
      id="ladder_file"
      title="🪜 file_book.exe — new ladder auction"
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

      <p className="hint" style={{ textAlign: 'left' }}>
        filing does not set a price. it sets a FLOOR and a ladder: the book opens
        at the floor and walks up its rungs as bidders arrive. you choose the
        shape, the market chooses the number.
      </p>

      <div className="win" style={{ marginTop: 8 }}>
        <div className="title">📋 precheck</div>
        <div className="body95">
          {checks.map((c) => (
            <p key={c.label} className={c.ok ? 'check ok' : 'check bad'}>
              ● {c.detail}
            </p>
          ))}
        </div>
      </div>

      <div className="win" style={{ marginTop: 12 }}>
        <div className="title">🪙 the asset</div>
        <div className="body95">
          <div className="field95">
            <span className="lab">ticker</span>
            <div className="inset">
              <input
                value={symbol}
                maxLength={12}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                placeholder="MOONBOI"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
          </div>
          <div className="field95">
            <span className="lab">name</span>
            <div className="inset">
              <input
                value={name}
                maxLength={32}
                onChange={(e) => setName(e.target.value)}
                placeholder="moon boi industries"
              />
            </div>
          </div>
          <div className="field95">
            <span className="lab">total supply (whole tokens)</span>
            <div className="inset">
              <input
                value={supplyHuman}
                inputMode="numeric"
                onChange={(e) =>
                  setSupplyHuman(e.target.value.replace(/[^\d]/g, ''))
                }
              />
            </div>
            <span className="hint">
              raw: {supply.toString()} token wei · 10% of the launch supply is
              withheld as the lp ask side, and it is derived by the contract, not
              by you.
            </span>
          </div>
        </div>
      </div>

      <div className="win" style={{ marginTop: 12 }}>
        <div className="title">💵 the floor — in DOLLARS</div>
        <div className="body95">
          <div className="field95">
            <span className="lab">floor mcap (US dollars)</span>
            <div className="inset">
              <input
                value={floorUsd}
                inputMode="decimal"
                onChange={(e) => setFloorUsd(e.target.value)}
                placeholder="10000"
              />
            </div>
            <span className="hint">
              DOLLARS, not eth and not wei. the auction stores it as{' '}
              {floorMcapUsdWad.toString()} (dollars × 1e18) and converts it into
              the book's own currency itself.
            </span>
          </div>

          <fieldset>
            <legend>pair currency</legend>
            <label className="row">
              <input
                type="radio"
                checked={!pairIsUsdg}
                onChange={() => setPairIsUsdg(false)}
              />
              native ETH
            </label>
            <label className="row">
              <input
                type="radio"
                checked={pairIsUsdg}
                onChange={() => setPairIsUsdg(true)}
              />
              USDG ({shortAddr(USDG_ADDRESS)}, 6dp)
            </label>
          </fieldset>

          <div className="dr">
            <span>floor in book currency</span>
            <b className="mono">
              {floorPairPreview == null
                ? '…'
                : nativeBook
                  ? `${formatEther(floorPairPreview)} ETH (at $${Number(
                      formatEther(liveEthUsdWad ?? 0n),
                    ).toFixed(2)}/ETH)`
                  : `${formatUnits(floorPairPreview, 18)} USDG — no conversion, a dollar book already quotes dollars`}
            </b>
          </div>
          <div className="dr">
            <span>raise gate at the bell</span>
            <b className="mono">
              {floorPairPreview == null
                ? '…'
                : `60% of the floor — ${
                    nativeBook
                      ? `${formatEther((floorPairPreview * 6000n) / 10_000n)} ETH`
                      : `${formatUnits((floorPairPreview * 6000n) / 10_000n, 18)} USDG`
                  }`}
            </b>
          </div>
          <p className="hint" style={{ textAlign: 'left' }}>
            under that gate at the bell the book FAILS and every bidder is
            refunded in full. nothing is kept.
          </p>
        </div>
      </div>

      <div className="win" style={{ marginTop: 12 }}>
        <div className="title">⏱ tier — sets the clock, not by hand</div>
        <div className="body95">
          <div className="btn-row">
            {LADDER_TIERS.map((t) => (
              <button
                key={t}
                type="button"
                className={`btn95${tier === t ? ' on' : ''}`}
                onClick={() => setTier(t)}
              >
                {TIER_LABEL[t]} · {formatDuration(Number(TIER_DURATION[t]))}
              </button>
            ))}
          </div>
          <div className="dr">
            <span>duration</span>
            <b className="mono">
              {TIER_DURATION[tier].toString()}s ·{' '}
              {formatDuration(Number(TIER_DURATION[tier]))} over 1000 periods
            </b>
          </div>
          <div className="dr">
            <span>lp health target</span>
            <b className="mono">
              {formatRatioWad(TIER_LP_HEALTH_WAD[tier])} — derived from the tier
            </b>
          </div>
          <div className="dr">
            <span>holdback ceiling</span>
            <b className="mono">{formatBps(holdbackCeiling)} of supply</b>
          </div>
        </div>
      </div>

      <div className="win" style={{ marginTop: 12 }}>
        <div className="title">🎚 the shape of the book</div>
        <div className="body95">
          <label>
            creator holdback (bps of total supply, 0–{holdbackCeiling})
            <input
              type="number"
              min={0}
              max={holdbackCeiling}
              value={holdbackBps}
              onChange={(e) => setHoldbackBps(Number(e.target.value))}
            />
          </label>
          <span className="hint">
            goes to the management vault, never to your wallet directly. 0 is
            allowed and reads as no team bags.
          </span>

          <label>
            cash holdback (bps of the raise, 0–{CASH_HOLDBACK_BPS_MAX})
            <input
              type="number"
              min={0}
              max={CASH_HOLDBACK_BPS_MAX}
              value={cashHoldbackBps}
              onChange={(e) => setCashHoldbackBps(Number(e.target.value))}
            />
          </label>

          <label>
            wallet cap (bps of TOTAL supply, {WALLET_CAP_BPS_MIN}–
            {WALLET_CAP_BPS_MAX})
            <input
              type="number"
              min={WALLET_CAP_BPS_MIN}
              max={WALLET_CAP_BPS_MAX}
              value={walletCapBps}
              onChange={(e) => setWalletCapBps(Number(e.target.value))}
            />
          </label>
          <span className="hint">
            10% is the hard ceiling in the constructor, and 0 is not allowed —
            every book is capped.
          </span>

          <label>
            size bonus (bps)
            <input
              type="number"
              min={0}
              max={10_000}
              value={sizeBonusBps}
              onChange={(e) => setSizeBonusBps(Number(e.target.value))}
            />
          </label>

          <label>
            max unique bidders (0 = uncapped)
            <input
              type="number"
              min={0}
              max={65_535}
              value={maxUniqueActives}
              onChange={(e) => setMaxUniqueActives(Number(e.target.value))}
            />
          </label>
        </div>
      </div>

      <div className="win" style={{ marginTop: 12 }}>
        <div className="title">🔒 decided by the protocol</div>
        <div className="body95">
          <div className="dr">
            <span>carve</span>
            <b className="mono">
              {carveBps == null
                ? '…'
                : `${formatBps(carveBps)} of the raise — protocol default`}
            </b>
          </div>
          <div className="dr">
            <span>lp share of the raise</span>
            <b className="mono">
              {lpShareWad == null
                ? '…'
                : `${formatRatioWad(lpShareWad)} — whatever carve and cash holdback leave`}
            </b>
          </div>
          <div className="dr">
            <span>side pool</span>
            <b className="mono">
              {defCreateSide === undefined
                ? '…'
                : defCreateSide
                  ? `on, ${formatBps(defSideBps ?? 0)} of lp tokens`
                  : 'off'}
            </b>
          </div>
          <div className="dr">
            <span>treasury / vault / settlement</span>
            <b className="mono">stamped by the factory</b>
          </div>
          <p className="hint" style={{ textAlign: 'left' }}>
            we send these as zero on purpose: the factory overwrites them inside
            file(), and the address you mine is hashed from the POST-stamp
            params, so what you mine is what deploys.
          </p>
        </div>
      </div>

      <button
        type="button"
        className="btn95 big go"
        style={{ marginTop: 12, width: '100%' }}
        disabled={!canSubmit}
        onClick={() => void file.run(draft)}
      >
        {file.busy
          ? 'working…'
          : (formError ??
            (allGreen ? 'FILE THE BOOK ☝' : 'precheck is red — read it first'))}
      </button>

      {(file.status || file.mineStats || file.error) && (
        <div className={file.step === 'mine' ? 'crt-mine' : 'pipeline'}>
          {file.step === 'mine' && (
            <p className="crt-line">
              AUCTION VANITY MINE · 0x4663 · ~65,536 attempts expected
            </p>
          )}
          {file.status && !file.error && (
            <p className="status">{file.status}</p>
          )}
          {file.mineStats && (
            <p className={file.step === 'mine' ? 'crt-line dim' : 'hint'}>
              {file.mineStats}
            </p>
          )}
          {file.error && <p className="check bad">{file.error}</p>}
        </div>
      )}

      <p className="hint" style={{ textAlign: 'left' }}>
        every field above is hashed into the auction's address, so editing
        anything after a mine invalidates the salt. the salt is mined at submit
        for exactly that reason — and the eth/usd rate is re-read in the same
        breath, because a stale one reverts EthUsdStampDrift.
      </p>
    </Win95Window>
  )
}
