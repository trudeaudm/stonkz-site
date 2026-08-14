import type { Address } from 'viem'
import { useAccount } from 'wagmi'
import { MarketGrid } from '../market/MarketGrid'
import { Win95Window } from './Window'

export function MyStuffWindow({
  onOpen,
  onClose,
}: {
  onOpen: (listing: Address) => void
  onClose: () => void
}) {
  const { address } = useAccount()

  return (
    <Win95Window
      id="my_stuff"
      title="my_stuff.exe"
      width={720}
      onClose={onClose}
    >
      <p className="eyebrow">your launches</p>
      {!address ? (
        <p className="hint">connect a wallet to see your filings.</p>
      ) : (
        <MarketGrid
          onOpen={onOpen}
          filterCreator={address}
          emptyCopy="you have launched nothing. yet."
        />
      )}
    </Win95Window>
  )
}
