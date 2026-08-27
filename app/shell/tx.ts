import type { Hex, PublicClient, TransactionReceipt } from 'viem'

/**
 * Await a receipt and THROW if the transaction reverted.
 *
 * `waitForTransactionReceipt` resolves for a reverted transaction — it rejects only on timeout — so awaiting
 * it proves INCLUSION, not success. Every write path in this app treated it as success, so a transaction that
 * reverted still ran the happy path: the ladder bid reported `bid in — 0.05 ETH committed` and the trade panel
 * fired the confetti and said `bought`.
 *
 * Measured on an anvil fork: a `placeBid` that died with `EvmError: OutOfGas` at period 169 (status 0x0, the
 * full 24,739,986 gas consumed) was reported to the user as committed. No funds were lost — the revert
 * returned them — but the UI asserted the opposite of what happened, which is worse than an error.
 *
 * `gasUsed === the gas the tx was sent with` is the signature of running out of gas rather than hitting a
 * revert, so it is worth calling out: those two need different fixes from the user's side (raise the limit
 * vs. do not retry).
 */
export async function waitForSuccess(
  client: PublicClient,
  hash: Hex,
  what: string,
): Promise<TransactionReceipt> {
  const receipt = await client.waitForTransactionReceipt({ hash })
  if (receipt.status === 'success') return receipt

  let hint = ''
  try {
    const tx = await client.getTransaction({ hash })
    if (tx.gas === receipt.gasUsed) {
      hint = ' — it ran OUT OF GAS, so retrying with a higher gas limit may work'
    }
  } catch {
    // Best-effort only: the revert itself is the message that matters.
  }
  throw new Error(
    `${what} reverted on-chain${hint}. nothing was committed. gas used ${receipt.gasUsed.toString()}.`,
  )
}
