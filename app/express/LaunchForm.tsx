import { useEffect, useMemo, useState } from 'react'
import { formatEther, parseEther, zeroAddress, type Address } from 'viem'
import { useAccount, useBalance, useReadContract, useReadContracts } from 'wagmi'
import { expressFactoryAbi, type ListingParams } from '../abi/expressFactory'
import { env } from '../config/env'
import { useOnCorrectChain } from '../gate/ChainGuard'
import { utf8DeclaredUse } from '../mining/create2'
import { Stamp } from '../shell/Stamp'
import { useToast } from '../shell/Toast'
import { Win95Window } from '../shell/Window'
import { useWindowManager } from '../shell/windowManager'
import { Receipt } from './Receipt'
import { listEthBufferWei, useLaunch } from './useLaunch'

const TIER_4K = 4000n * 10n ** 18n
const TIER_8K = 8000n * 10n ** 18n
const DEFAULT_SUPPLY = 1_000_000n * 10n ** 18n
const SIDE_POOL_BPS_MAX = 2000
const CREATOR_RESERVE_BPS_MAX = 10_000 // NOTES.md 0h — bps of total supply; no named on-chain max
/** Gas headroom for balance precheck (not a fee quote). */
const GAS_HEADROOM_WEI = parseEther('0.02')

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
  const { open, close: closeWin } = useWindowManager()
  const balance = useBalance({ address, query: { enabled: Boolean(address) } })
  const bufferWei = listEthBufferWei()
  const bufferEth = env.listEthBuffer

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
      const need = bufferWei + GAS_HEADROOM_WEI
      const bal = balance.data?.value
      const funded = bal !== undefined && bal >= need
      list.push({
        ok: funded,
        label: 'ethBufferBalance',
        detail: funded
          ? `balance covers ${bufferEth} ETH buffer + gas headroom`
          : `need ≥ ${bufferEth} ETH buffer + ${formatEther(GAS_HEADROOM_WEI)} ETH gas headroom (have ${bal !== undefined ? formatEther(bal) : '—'})`,
      })
    }

    return list
  }, [
    deploysEnabled,
    allowlistCount,
    allowed.data,
    address,
    pairToken,
    createSidePool,
    sideTokenRef,
    refConfigured.data,
    bufferWei,
    bufferEth,
    balance.data?.value,
  ])

  const allGreen = checks.every((c) => c.ok)
  const pairHardFail = pairToken !== undefined && pairToken !== zeroAddress
  const busy = !['idle', 'done', 'error'].includes(launch.step)
  const canSubmit =
    onCorrectChain &&
    formValid &&
    allGreen &&
    !pairHardFail &&
    !busy &&
    Boolean(address) &&
    Boolean(factoryAddr)

  useEffect(() => {
    if (launch.step === 'mine') toast.push('mining vanity salt…', 'info')
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
    // Stamped fields: factory overwrites at list/initCodeHash (NOTES.md 0f).
    // We still send current form values; chain stamps createSidePool/sidePoolBps/
    // liquidityLocked/refPriceWad from DeployControls defaults.
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
                <p>this launch sends {bufferEth} ETH as a settle buffer</p>
                <p className="hint">
                  excess is not recoverable — adapter refunds unused ETH to the
                  listing contract; the listing has no ETH withdrawal path
                  (NOTES.md 0j). default buffer stays {bufferEth} ETH (fork
                  tests); the trace does not yield a smaller sufficient amount.
                </p>
              </div>
            )}

            <button
              type="button"
              className="btn95 go"
              disabled={!canSubmit}
              onClick={() => void launch.run(buildParams())}
            >
              {busy ? 'working…' : 'mine + list'}
            </button>

            {(mining || launch.status || launch.mineStats || launch.selfTestLine || launch.error) && (
              <div className={mining ? 'crt-mine' : 'pipeline'}>
                {mining && (
                  <p className="crt-line">
                    VANITY MINE · attempts {attempts ?? '…'}
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
