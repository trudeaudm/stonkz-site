import { useAccount, useDisconnect } from 'wagmi'
import { env } from '../config/env'
import { Win95Window } from './Window'

export function AccountWindow({ onClose }: { onClose?: () => void }) {
  const { address } = useAccount()
  const { disconnect } = useDisconnect()
  if (!address) return null

  return (
    <Win95Window
      id="account"
      title="account.exe"
      width={360}
      onClose={onClose}
    >
      <p className="mono break">{address}</p>
      <div className="btn-row">
        <button
          type="button"
          className="btn95"
          onClick={() => void navigator.clipboard.writeText(address)}
        >
          copy address
        </button>
        <a
          className="btn95"
          href={`${env.explorerUrl.replace(/\/$/, '')}/address/${address}`}
          target="_blank"
          rel="noreferrer"
        >
          explorer
        </a>
        <button
          type="button"
          className="btn95 no"
          onClick={() => {
            disconnect()
            onClose?.()
          }}
        >
          disconnect
        </button>
      </div>
    </Win95Window>
  )
}
