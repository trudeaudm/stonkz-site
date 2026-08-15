import { useEffect, useMemo, useState } from 'react'
import { formatEther, zeroAddress, type Address } from 'viem'
import {
  useAccount,
  useBalance,
  usePublicClient,
  useReadContract,
  useReadContracts,
} from 'wagmi'
import { expressFactoryAbi, type ListingParams } from '../abi/expressFactory'
import { env } from '../config/env'
import { useOnCorrectChain } from '../gate/ChainGuard'
import { utf8DeclaredUse } from '../mining/create2'
import { verifyTokenVanityParity } from '../mining/mineVanity'
import { Stamp } from '../shell/Stamp'
import { useToast } from '../shell/Toast'
import { Win95Window } from '../shell/Window'
import { useWindowManager } from '../shell/windowManager'
import { Receipt } from './Receipt'
import {
  FACTORY_V2_FAIL_COPY,
  factoryV3PassCopy,
  fingerprintExpressFactoryV3,
} from './factoryFingerprint'
import {
  formatEthSig,
  getListCostEstimate,
  type ListCostEstimate,
} from './gasEstimate'
import { listBufferWei, useLaunch } from './useLaunch'

const TIER_4K = 4000n * 10n ** 18n
const TIER_8K = 8000n * 10n ** 18n
const DEFAULT_SUPPLY = 1_000_000n * 10n ** 18n
const SIDE_POOL_BPS_MAX = 2000
const CREATOR_RESERVE_BPS_MAX = 10_000 // NOTES.md 0h — bps of total supply; no named on-chain max

function factory(): Address | undefined {
  return env.addrExpressFactory
}

type Check = { ok: boolean; label: string; detail: string }

/** Hosts make_coin.exe + precheck.exe (+ certificate) with shared form state. */
export function LaunchHost({
  formOpen,
  precheckOpen,
  onCloseForm,
  onClosePrecheck,
  onReceiptOpen,
  onCloseCertificate,
}: {
  formOpen: boolean
  precheckOpen: boolean
  onCloseForm: () => void
  onClosePrecheck: () => void
  onReceiptOpen: () => void
  onCloseCertificate: () => void
}) {
  const { address } = useAccount()
  const onCorrectChain = useOnCorrectChain()
  const factoryAddr = factory()
  const launch = useLaunch()
  const toast = useToast()
  const publicClient = usePublicClient()
  const { open, close: closeWin } = useWindowManager()
  const balance = useBalance({ address, query: { enabled: Boolean(address) } })
  const bufferWei = listBufferWei()
  const [gasEst, setGasEst] = useState<ListCostEstimate | null>(null)
  const [gasFetchFailed, setGasFetchFailed] = useState(false)
  const [liveEthUsdWad, setLiveEthUsdWad] = useState<bigint | null>(null)
  const [vanityParityOk, setVanityParityOk] = useState<boolean | null>(null)
  const [vanityParityDetail, setVanityParityDetail] = useState<string>('')
  const [vanityParityRan, setVanityParityRan] = useState(false)
  /** null = probing; bigint = V3 band bps; false = stale factory */
  const [factoryBandBps, setFactoryBandBps] = useState<bigint | null | false>(
    null,
  )

  useEffect(() => {
    if (!formOpen && !precheckOpen) return
    if (!publicClient || !factoryAddr) {
      setFactoryBandBps(null)
      return
    }
    let cancelled = false
    void (async () => {
      const band = await fingerprintExpressFactoryV3(publicClient, factoryAddr)
      if (!cancelled) setFactoryBandBps(band == null ? false : band)
    })()
    return () => {
      cancelled = true
    }
  }, [formOpen, precheckOpen, publicClient, factoryAddr])

  useEffect(() => {
    if (!formOpen && !precheckOpen) return
    if (!publicClient) return
    let cancelled = false
    const refresh = async () => {
      try {
        const est = await getListCostEstimate(publicClient, bufferWei)
        if (!cancelled) {
          setGasEst(est)
          setGasFetchFailed(false)
        }
      } catch {
        if (!cancelled) {
          setGasEst(null)
          setGasFetchFailed(true)
        }
      }
      if (factoryAddr) {
        try {
          const wad = await publicClient.readContract({
            address: factoryAddr,
            abi: expressFactoryAbi,
            functionName: 'currentEthUsdWad',
          })
          if (!cancelled) setLiveEthUsdWad(wad)
        } catch {
          if (!cancelled) setLiveEthUsdWad(null)
        }
      }
    }
    void refresh()
    const id = window.setInterval(() => void refresh(), 30_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [formOpen, precheckOpen, publicClient, bufferWei, factoryAddr])

  // One-time token-vanity triple parity (worker/RLP ↔ viem ↔ factory eth_call).
  useEffect(() => {
    if (!formOpen || vanityParityRan || !publicClient || !factoryAddr || !address) {
      return
    }
    let cancelled = false
    void (async () => {
      try {
        // Minimal params for initCodeHash — stamps overwrite on-chain.
        const p: ListingParams = {
          startMcap: TIER_4K,
          totalSupply: DEFAULT_SUPPLY,
          creatorReserveBps: 0,
          deliveryMode: 0,
          vestDuration: 0n,
          declaredUse: ('0x' + '00'.repeat(32)) as `0x${string}`,
          creator: address,
          name: 'parity',
          symbol: 'PRTY',
          createSidePool: true,
          sidePoolBps: 500,
          liquidityLocked: true,
          refPriceWad: 0n,
          ethUsdWad: 0n,
        }
        const initCodeHash = await publicClient.readContract({
          address: factoryAddr,
          abi: expressFactoryAbi,
          functionName: 'listingInitCodeHash',
          args: [p],
        })
        const result = await verifyTokenVanityParity({
          factory: factoryAddr,
          deployer: address,
          initCodeHash,
          publicClient,
        })
        if (cancelled) return
        setVanityParityRan(true)
        setVanityParityOk(result.ok)
        setVanityParityDetail(result.detail)
      } catch (err) {
        if (cancelled) return
        setVanityParityRan(true)
        setVanityParityOk(false)
        setVanityParityDetail(
          err instanceof Error ? err.message : String(err),
        )
      }
    })()
    return () => {
      cancelled = true
    }
  }, [formOpen, vanityParityRan, publicClient, factoryAddr, address])

  const [name, setName] = useState('STONK')
  const [symbol, setSymbol] = useState('STNK')
  const [supplyHuman, setSupplyHuman] = useState('1000000')
  const [tier, setTier] = useState<'4k' | '8k'>('4k')
  const [creatorReserveBps, setCreatorReserveBps] = useState(0)
  const [delivery, setDelivery] = useState<'instant' | 'vest'>('instant')
  const [vestDays, setVestDays] = useState(30)
  const [createSidePool, setCreateSidePool] = useState(true)
  const [sidePoolBps, setSidePoolBps] = useState(500)
  const [liquidityLocked, setLiquidityLocked] = useState(true)
  const [declaredUseText, setDeclaredUseText] = useState('')
  const [defaultsLoaded, setDefaultsLoaded] = useState(false)

  const enabled = Boolean(factoryAddr)

  const reads = useReadContracts({
    contracts: factoryAddr
      ? [
          {
            address: factoryAddr,
            abi: expressFactoryAbi,
            functionName: 'deploysEnabled',
          },
          {
            address: factoryAddr,
            abi: expressFactoryAbi,
            functionName: 'pairToken',
          },
          {
            address: factoryAddr,
            abi: expressFactoryAbi,
            functionName: 'sideTokenRef',
          },
          {
            address: factoryAddr,
            abi: expressFactoryAbi,
            functionName: 'defaultCreateSidePool',
          },
          {
            address: factoryAddr,
            abi: expressFactoryAbi,
            functionName: 'defaultSidePoolBps',
          },
          {
            address: factoryAddr,
            abi: expressFactoryAbi,
            functionName: 'defaultLiquidityLocked',
          },
          {
            address: factoryAddr,
            abi: expressFactoryAbi,
            functionName: 'allowlistCount',
          },
        ]
      : [],
    query: { enabled },
  })

  const deploysEnabled = reads.data?.[0]?.result as boolean | undefined
  const pairToken = reads.data?.[1]?.result as Address | undefined
  const sideTokenRef = reads.data?.[2]?.result as Address | undefined
  const defCreateSide = reads.data?.[3]?.result as boolean | undefined
  const defSideBps = reads.data?.[4]?.result as number | undefined
  const defLock = reads.data?.[5]?.result as boolean | undefined
  const allowlistCount = reads.data?.[6]?.result as bigint | undefined

  useEffect(() => {
    if (defaultsLoaded) return
    if (defCreateSide === undefined || defSideBps === undefined || defLock === undefined) {
      return
    }
    setCreateSidePool(defCreateSide)
    setSidePoolBps(defSideBps)
    setLiquidityLocked(defLock)
    setDefaultsLoaded(true)
  }, [defCreateSide, defSideBps, defLock, defaultsLoaded])

  const allowed = useReadContract({
    address: factoryAddr,
    abi: expressFactoryAbi,
    functionName: 'isDeployerAllowed',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(factoryAddr && address) },
  })

  const refConfigured = useReadContract({
    address: factoryAddr,
    abi: expressFactoryAbi,
    functionName: 'refPriceConfigured',
    args:
      factoryAddr && sideTokenRef !== undefined && pairToken !== undefined
        ? [sideTokenRef, pairToken]
        : undefined,
    query: {
      enabled: Boolean(
        factoryAddr && createSidePool && sideTokenRef && pairToken !== undefined,
      ),
    },
  })

  const totalSupply = useMemo(() => {
    const n = Number(supplyHuman.replace(/,/g, ''))
    if (!Number.isFinite(n) || n <= 0) return 0n
    try {
      return BigInt(Math.floor(n)) * 10n ** 18n
    } catch {
      return 0n
    }
  }, [supplyHuman])

  const formValid = useMemo(() => {
    if (!name.trim() || name.length > 32) return false
    if (!symbol.trim() || symbol.length > 12) return false
    if (totalSupply === 0n) return false
    if (creatorReserveBps < 0 || creatorReserveBps > CREATOR_RESERVE_BPS_MAX) {
      return false
    }
    if (sidePoolBps < 0 || sidePoolBps > SIDE_POOL_BPS_MAX) return false
    if (delivery === 'vest' && vestDays <= 0) return false
    return true
  }, [name, symbol, totalSupply, creatorReserveBps, sidePoolBps, delivery, vestDays])

  const checks: Check[] = useMemo(() => {
    const list: Check[] = []

    if (factoryAddr) {
      if (factoryBandBps === null) {
        list.push({
          ok: false,
          label: 'factoryFingerprint',
          detail: 'probing factory fingerprint…',
        })
      } else if (factoryBandBps === false) {
        list.push({
          ok: false,
          label: 'factoryFingerprint',
          detail: FACTORY_V2_FAIL_COPY,
        })
      } else {
        list.push({
          ok: true,
          label: 'factoryFingerprint',
          detail: factoryV3PassCopy(factoryAddr, factoryBandBps),
        })
      }
    }

    list.push({
      ok: deploysEnabled === true,
      label: 'deploysEnabled',
      detail:
        deploysEnabled === true
          ? 'launches open'
          : 'launches are gated (soft launch)',
    })

    const count = allowlistCount ?? 0n
    const isAllowed =
      count === 0n
        ? deploysEnabled === true
        : allowed.data === true
    list.push({
      ok: Boolean(address) && isAllowed,
      label: 'isDeployerAllowed',
      detail: !address
        ? 'connect wallet'
        : isAllowed
          ? 'wallet on launch allowlist'
          : 'this wallet is not launch-allowlisted. browsing access ≠ launch access; launch filing requires the on-chain allowlist.',
    })

    const pairOk = pairToken === zeroAddress
    list.push({
      ok: pairOk,
      label: 'pairToken',
      detail: pairOk
        ? 'ETH pair (address(0))'
        : 'unexpected pair configuration',
    })

    if (createSidePool) {
      const sideOk = Boolean(sideTokenRef && sideTokenRef !== zeroAddress)
      list.push({
        ok: sideOk,
        label: 'sideTokenRef',
        detail: sideOk ? `side ref ${sideTokenRef}` : 'sideTokenRef unset',
      })
      list.push({
        ok: refConfigured.data === true,
        label: 'refPriceConfigured',
        detail:
          refConfigured.data === true
            ? 'ref price configured'
            : 'ref price not configured for side/pair',
      })
    }

    if (pairToken === zeroAddress) {
      if (gasFetchFailed) {
        list.push({
          ok: false,
          label: 'gasPrice',
          detail: 'could not read gas price',
        })
      } else if (!gasEst) {
        list.push({
          ok: false,
          label: 'ethCostEstimate',
          detail: 'estimating settle + gas cost…',
        })
      } else {
        const bal = balance.data?.value
        const funded = bal !== undefined && bal >= gasEst.requiredWei
        const have =
          bal !== undefined ? formatEther(bal) : '—'
        list.push({
          ok: funded,
          label: 'ethCostEstimate',
          detail: `need ≈ ${formatEthSig(gasEst.requiredWei)} ETH (settle buffer ${bufferWei.toString()} wei + gas ≈ ${formatEthSig(gasEst.gasCostWei)} ETH at current prices) — have ${have} ETH · estimate`,
        })
      }
    }

    return list
  }, [
    factoryAddr,
    factoryBandBps,
    deploysEnabled,
    allowlistCount,
    allowed.data,
    address,
    pairToken,
    createSidePool,
    sideTokenRef,
    refConfigured.data,
    bufferWei,
    balance.data?.value,
    gasEst,
    gasFetchFailed,
  ])

  const allGreen = checks.every((c) => c.ok)
  const pairHardFail = pairToken !== undefined && pairToken !== zeroAddress
  const busy = !['idle', 'done', 'error'].includes(launch.step)
  const canSubmit =
    onCorrectChain &&
    formValid &&
    allGreen &&
    typeof factoryBandBps === 'bigint' &&
    !pairHardFail &&
    !busy &&
    Boolean(address) &&
    Boolean(factoryAddr)

  useEffect(() => {
    if (launch.step === 'mine') toast.push('mining your 0x4663 token address…', 'info')
    else if (launch.step === 'simulate') toast.push('simulating list()…', 'info')
    else if (launch.step === 'write') toast.push('awaiting wallet…', 'info')
    else if (launch.step === 'receipt') toast.push('waiting for receipt…', 'info')
    else if (launch.step === 'done') toast.push('listing filed', 'ok')
    else if (launch.step === 'error' && launch.error) {
      toast.push(launch.error.slice(0, 80), 'err')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toast on step edges
  }, [launch.step])

  useEffect(() => {
    if (launch.receipt) {
      open('certificate', 'certificate.exe')
      onReceiptOpen()
    }
  }, [launch.receipt, open, onReceiptOpen])

  useEffect(() => {
    if (launch.receipt && formOpen) {
      closeWin('make_coin')
    }
  }, [launch.receipt, formOpen, closeWin])

  function buildParams(): ListingParams {
    if (!address) throw new Error('no address')
    // Stamped fields: factory overwrites createSidePool/sidePoolBps/
    // liquidityLocked/refPriceWad from DeployControls defaults at list/initCodeHash.
    // ethUsdWad is caller-supplied on V3 — useLaunch reads currentEthUsdWad() and
    // overlays it before mining (form value is a placeholder only).
    return {
      startMcap: tier === '4k' ? TIER_4K : TIER_8K,
      totalSupply,
      creatorReserveBps,
      deliveryMode: delivery === 'instant' ? 0 : 1,
      vestDuration:
        delivery === 'vest' ? BigInt(vestDays) * 86400n : 0n,
      declaredUse: utf8DeclaredUse(declaredUseText) as `0x${string}`,
      creator: address,
      name: name.trim(),
      symbol: symbol.trim().toUpperCase(),
      createSidePool,
      sidePoolBps,
      liquidityLocked,
      refPriceWad: 0n, // stamped when createSidePool
      ethUsdWad: liveEthUsdWad ?? 0n, // useLaunch re-reads + overlays at run
    }
  }

  const mining = launch.step === 'mine'
  const attemptMatch = launch.mineStats?.match(/(\d[\d,]*)\s*attempts/i)
  const attempts = attemptMatch?.[1]

  return (
    <>
      {precheckOpen && (
        <Win95Window
          id="precheck"
          title="precheck.exe"
          titleTone="amber"
          width={320}
          onClose={onClosePrecheck}
        >
          {!factoryAddr && (
            <p className="check bad">VITE_ADDR_EXPRESS_FACTORY unset</p>
          )}
          {pairHardFail && (
            <p className="check bad">unexpected pair configuration</p>
          )}
          {checks.map((c) => (
            <p key={c.label} className={c.ok ? 'check ok' : 'check bad'}>
              ● {c.detail}
            </p>
          ))}
          {!onCorrectChain && (
            <p className="check bad">wrong network — switch before launch</p>
          )}
        </Win95Window>
      )}

      {formOpen && !launch.receipt && (
        <Win95Window
          id="make_coin"
          title="make_coin.exe"
          width={480}
          onClose={onCloseForm}
        >
          <div className={`launch-form ${!onCorrectChain ? 'disabled-surface' : ''}`}>
            <label>
              name
              <input
                value={name}
                maxLength={32}
                onChange={(e) => setName(e.target.value)}
                disabled={!onCorrectChain}
              />
            </label>
            <label>
              symbol
              <input
                value={symbol}
                maxLength={12}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                disabled={!onCorrectChain}
              />
            </label>
            <label>
              total supply (tokens)
              <input
                value={supplyHuman}
                onChange={(e) => setSupplyHuman(e.target.value.replace(/[^\d]/g, ''))}
                disabled={!onCorrectChain}
              />
              <span className="hint">
                raw: {totalSupply.toString()} · human:{' '}
                {formatEther(totalSupply || DEFAULT_SUPPLY)}
              </span>
            </label>

            <fieldset disabled={!onCorrectChain}>
              <legend>start mcap tier</legend>
              <label className="row">
                <input
                  type="radio"
                  checked={tier === '4k'}
                  onChange={() => setTier('4k')}
                />
                $4,000
              </label>
              <label className="row">
                <input
                  type="radio"
                  checked={tier === '8k'}
                  onChange={() => setTier('8k')}
                />
                $8,000
              </label>
            </fieldset>

            <label>
              creator reserve (bps of total supply, 0–10000)
              <input
                type="number"
                min={0}
                max={CREATOR_RESERVE_BPS_MAX}
                value={creatorReserveBps}
                onChange={(e) => setCreatorReserveBps(Number(e.target.value))}
                disabled={!onCorrectChain}
              />
            </label>

            <fieldset disabled={!onCorrectChain}>
              <legend>delivery</legend>
              <label className="row">
                <input
                  type="radio"
                  checked={delivery === 'instant'}
                  onChange={() => setDelivery('instant')}
                />
                INSTANT (10-minute timelock before claim)
              </label>
              <label className="row">
                <input
                  type="radio"
                  checked={delivery === 'vest'}
                  onChange={() => setDelivery('vest')}
                />
                VEST
              </label>
              {delivery === 'vest' && (
                <label>
                  vest duration (days)
                  <input
                    type="number"
                    min={1}
                    value={vestDays}
                    onChange={(e) => setVestDays(Number(e.target.value))}
                  />
                </label>
              )}
            </fieldset>

            <fieldset disabled={!onCorrectChain}>
              <legend>side pool</legend>
              <p className="hint">
                factory stamps createSidePool / sidePoolBps / refPrice at list
                (NOTES.md 0f). defaults loaded from chain; toggles follow those
                stamped values.
              </p>
              <label className="row">
                <input
                  type="checkbox"
                  checked={createSidePool}
                  onChange={(e) => setCreateSidePool(e.target.checked)}
                />
                create side pool
              </label>
              <label>
                side pool bps (0–2000)
                <input
                  type="number"
                  min={0}
                  max={SIDE_POOL_BPS_MAX}
                  value={sidePoolBps}
                  onChange={(e) => setSidePoolBps(Number(e.target.value))}
                />
              </label>
            </fieldset>

            <fieldset disabled={!onCorrectChain}>
              <legend>liquidity lock</legend>
              <label className="row">
                <input
                  type="checkbox"
                  checked={liquidityLocked}
                  onChange={(e) => setLiquidityLocked(e.target.checked)}
                />
                liquidity locked
              </label>
              <p className="hint">
                {liquidityLocked
                  ? 'locked forever — no principal withdraw path while stamp is true.'
                  : 'creator can withdraw LP principal (unlockRecipient = creator).'}
              </p>
            </fieldset>

            <label>
              declared use (recorded in calldata only)
              <input
                value={declaredUseText}
                maxLength={64}
                onChange={(e) => setDeclaredUseText(e.target.value)}
                disabled={!onCorrectChain}
                placeholder="optional — keccak256(utf8) into bytes32"
              />
              <span className="hint">
                not stored or emitted on Express; only in constructor calldata /
                init-code hash.
              </span>
            </label>

            {pairToken === zeroAddress && (
              <div className="pipeline">
                <p>
                  this launch sends {bufferWei.toString()} wei as a settle
                  buffer (goes to the pool manager; measured, not guessed)
                </p>
                {gasEst && (
                  <p className="hint">
                    estimate total ≈ {formatEthSig(gasEst.requiredWei)} ETH
                    (buffer {bufferWei.toString()} wei + gas ≈{' '}
                    {formatEthSig(gasEst.gasCostWei)} ETH at current prices,
                    1.5× gas margin)
                  </p>
                )}
                {gasFetchFailed && (
                  <p className="check bad">could not read gas price</p>
                )}
                {liveEthUsdWad !== null &&
                  typeof factoryBandBps === 'bigint' && (
                  <p className="hint">
                    tier conversion at $
                    {(Number(liveEthUsdWad) / 1e18).toFixed(2)}
                    /ETH — you are filing this rate; the chain accepts it
                    within ±{Number(factoryBandBps) / 100}% of its own
                    reading.
                  </p>
                )}
                {liveEthUsdWad === null && formOpen && (
                  <p className="hint">
                    reading live ETH/USD from the factory…
                  </p>
                )}
                <p className="hint">
                  excess above actual consumption stays on the listing contract
                  — the default carries ~10x margin, so worst-case excess is
                  less than 1e6 wei.
                </p>
              </div>
            )}

            {vanityParityOk === false && (
              <p className="check bad">
                token vanity self-test failed — mining disabled. {vanityParityDetail}
              </p>
            )}

            <button
              type="button"
              className="btn95 go"
              disabled={!canSubmit || vanityParityOk === false}
              onClick={() => void launch.run(buildParams())}
            >
              {busy ? 'working…' : 'mine + list'}
            </button>

            {(mining || launch.status || launch.mineStats || launch.selfTestLine || launch.error) && (
              <div className={mining ? 'crt-mine' : 'pipeline'}>
                {mining && (
                  <p className="crt-line">
                    TOKEN VANITY MINE · attempts {attempts ?? '…'}
                  </p>
                )}
                {launch.status && <p className="status">{launch.status}</p>}
                {launch.mineStats && !mining && (
                  <p className="hint">{launch.mineStats}</p>
                )}
                {launch.mineStats && mining && (
                  <p className="crt-line dim">{launch.mineStats}</p>
                )}
                {launch.selfTestLine && (
                  <p className="hint">{launch.selfTestLine}</p>
                )}
                {vanityParityOk && vanityParityDetail && (
                  <p className="hint">{vanityParityDetail}</p>
                )}
                {launch.error && <p className="check bad">{launch.error}</p>}
              </div>
            )}
          </div>
        </Win95Window>
      )}

      {launch.receipt && (
        <Win95Window
          id="certificate"
          title="certificate.exe"
          titleTone="green"
          width={480}
          onClose={() => {
            launch.reset()
            onCloseCertificate()
          }}
        >
          <div className="cert-stamp-row">
            <Stamp variant="stonkz">STONKZ</Stamp>
          </div>
          <Receipt data={launch.receipt} onReset={launch.reset} chrome={false} />
        </Win95Window>
      )}
    </>
  )
}
