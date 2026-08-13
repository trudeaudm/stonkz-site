import { formatEther } from 'viem'
import { env } from '../config/env'
import type { LaunchReceipt } from './useLaunch'

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function explorerToken(addr: string) {
  const base = env.explorerUrl.replace(/\/$/, '')
  return `${base}/address/${addr}`
}

export function Receipt({
  data,
  onReset,
}: {
  data: LaunchReceipt
  onReset: () => void
}) {
  const mode =
    !data.reserveFiled || data.creatorReserve === 0n
      ? 'none'
      : data.reserveMode === 0
        ? 'INSTANT (10-min timelock)'
        : `VEST (${data.vestDuration.toString()}s)`

  return (
    <div className="win receipt">
      <div className="tb">stonkz_certificate.exe</div>
      <div className="body95">
        <p className="eyebrow">express listing filed</p>
        <p>
          token{' '}
          <a href={explorerToken(data.token)} target="_blank" rel="noreferrer">
            {data.token}
          </a>
        </p>
        <p>listing {data.listing}</p>
        <p>creator {short(data.creator)}</p>
        <div className="rule" />
        <p>start mcap {formatEther(data.startMcap)} (pair units)</p>
        <p>start price {data.startPriceWad.toString()} wad</p>
        <p>start tick {data.startTick}</p>
        <div className="rule" />
        <p>
          creator reserve {data.creatorReserve.toString()} raw · delivery {mode}
        </p>
        {data.reserveFiled && data.reserveMode === 0 && (
          <p className="hint">unlockedAt {data.unlockedAt.toString()} (unix)</p>
        )}
        {data.listed !== undefined && (
          <p>listed {data.listed.toString()} · side {data.sidePoolTokens?.toString() ?? '0'}</p>
        )}
        <p>
          side pool{' '}
          {data.createSidePool
            ? `on (${data.sidePoolBps} bps)${data.sidePoolDeployed ? ', deployed' : ''}`
            : 'off'}
        </p>
        <p>
          liquidity{' '}
          {data.liquidityLocked
            ? 'locked forever'
            : 'unlocked — creator may withdraw principal'}
        </p>
        <div className="rule" />
        <p className="hint">tx {data.txHash}</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn95" onClick={onReset}>
            file another
          </button>
          <a className="btn95" href={`#/l/${data.listing}`}>
            open detail
          </a>
        </div>
      </div>
    </div>
  )
}
