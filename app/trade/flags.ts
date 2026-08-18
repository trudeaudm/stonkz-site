/**
 * Main-pool sells via the in-app UR path.
 *
 * StonkzFeeHook.beforeSwap takes abs(amountSpecified) * hookFeeBps in the
 * PAIR currency on BOTH directions. On a sell, absSpec is the token amount,
 * so a 10_000-token sell tries to take ~100 ETH and reverts SafeCastOverflow.
 * Buys (ETH specified) are correct.
 *
 * Flip this to true — the only site-side change — once the hook is
 * redeployed with a sell-side fee that is actually in token/pair units
 * that match the specified currency. Not an env var: this tracks a
 * contract fact, not config.
 */
export const MAIN_POOL_SELLS_ENABLED = false
