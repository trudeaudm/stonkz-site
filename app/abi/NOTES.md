# Express vanity / salt recon

Source: `C:\Users\david\stonkz-project\stonkz` at `HEAD` = `302834ff1c1404d856760ca0caa0ef9363613ae8`
(`git -C C:\Users\david\stonkz-project\stonkz show HEAD:<path>` only; dirty tree not read).

**Stop-condition verdict: CONTINUE.** VanityPrefixMismatch is enforced
unconditionally on `list()`. Salt + CREATE2 are fully replicable client-side from
`(deployer, userSalt, initCodeHash)` with deployer = factory address.

---

## 0a. `StonkzExpressFactory.list` — full body + vanity guard

```129:151:contracts/src/StonkzExpressFactory.sol
    function list(StonkzDirectListing.ListingParams memory p, bytes32 userSalt)
        external
        payable
        returns (StonkzDirectListing listing)
    {
        _requireDeployAllowed(msg.sender);
        _stampListingParams(p);
        bytes32 salt = listingSalt(msg.sender, userSalt);
        bytes32 initHash = keccak256(
            abi.encodePacked(
                type(StonkzDirectListing).creationCode,
                abi.encode(poolManager, feeLocker, hook, accumulator, ctoGovernor, pairToken, sideTokenRef, p)
            )
        );
        address predicted = Vanity.predict(address(this), salt, initHash);
        Vanity.requirePrefix(predicted);

        listing = new StonkzDirectListing{salt: salt, value: msg.value}(
            poolManager, feeLocker, hook, accumulator, ctoGovernor, pairToken, sideTokenRef, p
        );
        assert(address(listing) == predicted);
        emit ExpressListed(address(listing), address(listing.token()), p.creator, userSalt, salt);
    }
```

Vanity helper:

```21:23:contracts/src/Vanity.sol
    function requirePrefix(address predicted) internal pure {
        if (!matches(predicted)) revert VanityPrefixMismatch(predicted);
    }
```

**Statement:** `VanityPrefixMismatch` is enforced **UNCONDITIONALLY** on every
`list()` call. There is no `if`, flag, or DeployControls gate around
`Vanity.requirePrefix(predicted)` — it always runs after predict.

NatSpec confirms:

```126:126:contracts/src/StonkzExpressFactory.sol
    ///      Reverts VanityPrefixMismatch if predicted address top bytes != 0x4663.
```

---

## 0b. `listingSalt(deployer, userSalt)` — full body + preimage

```97:100:contracts/src/StonkzExpressFactory.sol
    /// @notice CREATE2 salt binding deployer → prevents salt grief across allowlisted callers.
    function listingSalt(address deployer, bytes32 userSalt) public pure returns (bytes32) {
        return keccak256(abi.encode(deployer, userSalt));
    }
```

**Preimage layout:** `keccak256(abi.encode(deployer, userSalt))` —
**`abi.encode`** (32-byte padded address + 32-byte userSalt), **not**
`encodePacked`. Field order: `deployer` then `userSalt`.

Vanity.mine mirrors the same encode:

```45:46:contracts/src/Vanity.sol
            userSalt = bytes32(i);
            bytes32 salt = keccak256(abi.encode(caller, userSalt));
```

---

## 0c. `listingInitCodeHash(p)` — full body

```102:112:contracts/src/StonkzExpressFactory.sol
    /// @notice Init-code hash for a listing AFTER factory stamps (vanity miner input).
    /// @dev Must match the bytecode `list` deploys — stamps applied here identically.
    function listingInitCodeHash(StonkzDirectListing.ListingParams memory p) public view returns (bytes32) {
        _stampListingParams(p);
        return keccak256(
            abi.encodePacked(
                type(StonkzDirectListing).creationCode,
                abi.encode(poolManager, feeLocker, hook, accumulator, ctoGovernor, pairToken, sideTokenRef, p)
            )
        );
    }
```

**What is hashed:** `keccak256(abi.encodePacked(creationCode, abi.encode(...)))` where:

1. `type(StonkzDirectListing).creationCode` — runtime creation bytecode
2. concatenated with `abi.encode(poolManager, feeLocker, hook, accumulator, ctoGovernor, pairToken, sideTokenRef, p)` — constructor args

Stamps applied first (`_stampListingParams`) so the hash matches what `list` deploys.
Client miners **must not** rebuild this locally from bytecode; they call
`listingInitCodeHash(p)` on-chain (then mine with that hash).

---

## 0d. `predictListingAddress` — full body + CREATE2 deployer

```114:122:contracts/src/StonkzExpressFactory.sol
    /// @notice Predict CREATE2 address for a listing given init-code hash (vanity miner input).
    function predictListingAddress(address deployer, bytes32 userSalt, bytes32 initCodeHash)
        public
        view
        returns (address predicted)
    {
        bytes32 salt = listingSalt(deployer, userSalt);
        predicted = Vanity.predict(address(this), salt, initCodeHash);
    }
```

```25:28:contracts/src/Vanity.sol
    /// @notice CREATE2 predict: address(keccak256(0xff ++ deployer ++ salt ++ initCodeHash)).
    function predict(address deployer, bytes32 salt, bytes32 initCodeHash) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash)))));
    }
```

**Yes — standard CREATE2.** Deployer address used in the formula is
**`address(this)` = the Express factory**, not the caller / library. The `deployer`
argument to `predictListingAddress` / `listingSalt` is the **allowlisted caller**
bound into the salt preimage only.

Client formula:

```
salt      = keccak256(abi.encode(caller, userSalt))
predicted = address(uint160(uint256(keccak256(0xff ++ factory ++ salt ++ initCodeHash))))
```

---

## 0e. `Vanity.sol` — prefix constant + match check

```7:18:contracts/src/Vanity.sol
    /// @dev 0x4663 — Robinhood chain id / brand prefix.
    uint16 internal constant PREFIX = 0x4663;

    error VanityPrefixMismatch(address predicted);

    /// @notice Top two bytes of a 20-byte address (explorer truncation: 0x4663…).
    function prefixOf(address a) internal pure returns (uint16) {
        return uint16(uint160(a) >> 144);
    }

    function matches(address a) internal pure returns (bool) {
        return prefixOf(a) == PREFIX;
    }
```

**Compared:** top **2 bytes** = **4 hex nibbles** (`0x4663`).
`uint160(a) >> 144` isolates those high bits. Match is against constant
`PREFIX = 0x4663`.

---

## 0f. `ListingParams` — exact field ORDER (ABI encoding)

```94:112:contracts/src/StonkzDirectListing.sol
    struct ListingParams {
        uint256 startMcap; // TIER_4K or TIER_8K only
        uint256 totalSupply;
        uint16 creatorReserveBps; // of total supply (§0)
        uint8 deliveryMode; // 0 INSTANT | 1 VEST (§8.4)
        uint64 vestDuration; // seconds (VEST only)
        bytes32 declaredUse; // optional transparency (§8.5)
        address creator;
        string name;
        string symbol;
        /// @dev Factory path overwrites from DeployControls defaults. Direct tests set explicitly.
        bool createSidePool;
        /// @dev Unit: bps of listing supply (after creatorReserve). Bounds [0, 2000].
        uint16 sidePoolBps;
        /// @dev Factory stamps defaultLiquidityLocked. Direct tests: true = legacy lock.
        bool liquidityLocked;
        /// @dev Unit: pair-wei per STONKZ token, WAD. Factory stamps from DeployControls; 0 if !createSidePool.
        uint256 refPriceWad;
    }
```

Order (ABI): `startMcap, totalSupply, creatorReserveBps, deliveryMode,
vestDuration, declaredUse, creator, name, symbol, createSidePool, sidePoolBps,
liquidityLocked, refPriceWad`.

Factory stamp overwrite on Express path:

```153:159:contracts/src/StonkzExpressFactory.sol
    function _stampListingParams(StonkzDirectListing.ListingParams memory p) internal view {
        p.createSidePool = defaultCreateSidePool;
        p.sidePoolBps = defaultSidePoolBps;
        p.liquidityLocked = defaultLiquidityLocked;
        // Ref: required when createSidePool; never a silent fallback (RefPriceUnset).
        p.refPriceWad = p.createSidePool ? _requireRefPrice(sideTokenRef, pairToken) : 0;
    }
```

`declaredUse`: present in the struct (hence in constructor calldata / init-code
hash) but **not** assigned to any storage and **not** in `DirectListed` —
calldata-only on the Express path.

---

## 0g. Constructor require/revert order (form precheck order)

```159:166:contracts/src/StonkzDirectListing.sol
        if (p.startMcap != TIER_4K && p.startMcap != TIER_8K) revert BadTier();
        if (p.totalSupply == 0) revert BadSupply();
        if (p.sidePoolBps > SIDE_POOL_BPS_MAX) revert SidePoolBpsOutOfBounds(p.sidePoolBps);
        if (p.createSidePool) {
            if (sideTokenRef_ == address(0)) revert SideTokenRefUnset();
            if (p.refPriceWad == 0) revert RefPriceUnset();
            _validateRefPriceBounds(pairToken_, p.refPriceWad);
        }
```

```386:391:contracts/src/StonkzDirectListing.sol
    function _validateRefPriceBounds(address pair, uint256 priceWad) internal pure {
        if (pair == address(0)) {
            if (priceWad < 1e8 || priceWad > 1e17) revert RefPriceOutOfBounds(priceWad);
        } else if (priceWad < 1e12 || priceWad > 1e21) {
            revert RefPriceOutOfBounds(priceWad);
        }
    }
```

`LiquidityDust` is **later**, during side-pool deploy (not in the opening
require block):

```350:353:contracts/src/StonkzDirectListing.sol
        uint128 liq = tokIs0
            ? LiquidityAmounts.getLiquidityForAmount0(sa, sb, tokens)
            : LiquidityAmounts.getLiquidityForAmount1(sa, sb, tokens);
        if (liq == 0) revert LiquidityDust(bytes32("side"), tokens);
```

**Precheck order matching chain:**

1. `BadTier` — startMcap ∈ {4000e18, 8000e18}
2. `BadSupply` — totalSupply ≠ 0
3. `SidePoolBpsOutOfBounds` — sidePoolBps ≤ 2000
4. (if createSidePool) `SideTokenRefUnset` — sideTokenRef ≠ 0
5. (if createSidePool) `RefPriceUnset` — refPriceWad ≠ 0
6. (if createSidePool) `RefPriceOutOfBounds` — ETH pair: [1e8, 1e17]
7. `LiquidityDust` — only if side liq rounds to 0 (geometry; not a form field check)

---

## 0h. `creatorReserveBps` bound

**No on-chain max `require`/`revert` for `creatorReserveBps` in the constructor.**
It is typed `uint16` and used as bps of total supply:

```97:97:contracts/src/StonkzDirectListing.sol
        uint16 creatorReserveBps; // of total supply (§0)
```

```187:188:contracts/src/StonkzDirectListing.sol
        // creatorReserve holdback + delivery filing (spec §8.4 / §8.5).
        creatorReserve = FixedPointMathLib.mulDiv(p.totalSupply, p.creatorReserveBps, 10_000);
```

Spec language (mechanism-spec §1): `creatorReserve | % of total supply, default 0`.
**Form bound:** `[0, 10000]` bps (0–100% of total supply). 0 is allowed.
Values > 10000 would compute a reserve larger than supply and underflow
`listingSupply = totalSupply - creatorReserve` — treat as invalid client-side
even though the chain has no named error for it.

INSTANT timelock (for form copy):

```9:9:contracts/src/CreatorReserveLib.sol
    uint256 internal constant INSTANT_TIMELOCK = 10 minutes;
```

---

## 0i. `msg.value` in `list()` / listing constructor

`list` is `payable`. The listing is created with the full call value:

```128:128:contracts/src/StonkzExpressFactory.sol
    /// @dev Native pair: pass msg.value as ETH settle buffer for real PM (adapter refunds dust).
```

```146:148:contracts/src/StonkzExpressFactory.sol
        listing = new StonkzDirectListing{salt: salt, value: msg.value}(
            poolManager, feeLocker, hook, accumulator, ctoGovernor, pairToken, sideTokenRef, p
        );
```

Listing constructor is also `payable` (`StonkzDirectListing.sol:158`) and has
`receive() external payable`.

**Form implication:** for ETH pair (`pairToken == address(0)`), the tx **must
carry value** — an ETH settle buffer. Fork tests historically used
`ETH_LIST_BUFFER = 1 ether` (`contracts/test/ForkCanonPhase4.t.sol:130`); site
default is now `VITE_LIST_BUFFER_WEI=1000000` (measured ~103k–146k wei
consumption at fork block 35828651). Adapter refunds unused dust to the listing.
Mock-PM unit tests often call `list` with 0 value; real PM needs the buffer.

---

## 0j. ETH buffer lifecycle

⚠ STUCK-BUFFER — excess settle buffer above what the real PM consumes is returned
to the **listing** contract and has **no recovery path** at HEAD. Flag for the
contracts repo (not a site fix).

### 0a. Trace (real PoolManager / V4Adapter path)

**1. Value enters the listing.** Factory forwards full `msg.value`:

```146:148:contracts/src/StonkzExpressFactory.sol
        listing = new StonkzDirectListing{salt: salt, value: msg.value}(
            poolManager, feeLocker, hook, accumulator, ctoGovernor, pairToken, sideTokenRef, p
        );
```

**2. During main-pool construction the listing forwards its entire ETH balance
to the adapter** (native pair only):

```269:280:contracts/src/StonkzDirectListing.sol
        // Native pair: forward ETH for any amount0 settle dust (real PM); adapter refunds remainder.
        uint256 ethVal = pairToken == address(0) ? address(this).balance : 0;
        poolManager.modifyLiquidity{value: ethVal}(
            mainPoolKey,
            IPoolManager.ModifyLiquidityParams({
                tickLower: lowerTick,
                tickUpper: topTick,
                liquidityDelta: int256(uint256(liq)),
                salt: salt
            }),
            ""
        );
```

Who is paid / how much consumed: `V4Adapter.modifyLiquidity` unlocks the
canonical PM with `payer: msg.sender` (= the listing). Negative delta currencies
are settled from that payer (`_settleDelta`); for a single-sided **token** range
above spot, ETH debt is typically dust/zero — any ETH that was sent rides on the
adapter until refund.

```114:141:contracts/src/v4/V4Adapter.sol
    function modifyLiquidity(PoolKey memory key, ModifyLiquidityParams memory params, bytes calldata hookData)
        external
        payable
        returns (BalanceDelta callerDelta, BalanceDelta feesAccrued)
    {
        bytes memory raw = manager.unlock(
            abi.encode(
                ModCallback({
                    action: Action.ModifyLiquidity,
                    payer: msg.sender,
                    ...
                })
            )
        );
        ...
        _refundDustEth(msg.sender);
    }
```

```392:399:contracts/src/v4/V4Adapter.sol
    function _settleDelta(CanonPoolKey memory ckey, CanonDelta delta, address payer) internal {
        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();
        if (d0 < 0) ckey.currency0.settle(manager, payer, uint256(uint128(-d0)), false);
        if (d1 < 0) ckey.currency1.settle(manager, payer, uint256(uint128(-d1)), false);
        if (d0 > 0) ckey.currency0.take(manager, payer, uint256(uint128(d0)), false);
        if (d1 > 0) ckey.currency1.take(manager, payer, uint256(uint128(d1)), false);
    }
```

**3. "Adapter refunds dust" — to the listing (tx caller of modifyLiquidity), not
the EOA / factory:**

```411:417:contracts/src/v4/V4Adapter.sol
    function _refundDustEth(address to) internal {
        uint256 bal = address(this).balance;
        if (bal > 0) {
            (bool ok,) = to.call{value: bal}("");
            require(ok, "eth refund");
        }
    }
```

`to` = `msg.sender` of `modifyLiquidity` = **the listing**. Transfer is
`to.call{value: bal}("")` of the adapter's full remaining ETH balance.

**4. Listing can receive the refund; no ETH recovery function exists.**

```147:147:contracts/src/StonkzDirectListing.sol
    receive() external payable {}
```

`withdrawMainLiquidity` / `withdrawSideLiquidity` / `claimCreatorReserve` move
LP principal or creatorReserve **tokens** only — no ETH `call{value}` /
`transfer` out of the listing at HEAD.

**Conclusion:** excess buffer above PM consumption is returned to the **listing**
and is **STUCK** on the listing (not recoverable).

Measured settle consumption at fork block 35828651: **103160 wei** ($4k tier) /
**145658 wei** ($8k tier), paid to the canonical PoolManager. Default
`VITE_LIST_BUFFER_WEI=1000000` (~7–10× margin). Excess above consumption stays
on the listing — keep the buffer small.

### 0b. Step-6 `useLaunch` value audit (as built)

Yes — both simulate and write attached value for the ETH-pair path. Historically
hardcoded to `10n ** 18n`, then a decimal-ETH env var. Current:
`BigInt(env.listBufferWei)` (`VITE_LIST_BUFFER_WEI`, default `"1000000"`).

```ts
// app/express/useLaunch.ts
const value = pairToken === zeroAddress ? listBufferWei() : 0n
// … simulateContract({ … value })
// … writeContractAsync({ … value })
```

---

## CORRECTION 2026-08-14: deployed != HEAD

Authority: `C:\Users\david\stonkz-project\reports\stonkz-deployed-truth.md` (read-only; not in this repo).

Live **ExpressFactory**, **LadderFactory**, and **FeeHook** bytecode match the
contracts repo's **dirty working-tree (disk) build**, not git HEAD. Broadcast
`commit` stamps record HEAD while Foundry deployed from uncommitted sources
(SSTORE2 listing/auction creation chunks; FeeHook 4-arg constructor).

**Decode impact (this site):** failed CREATE2 on the live Express factory
reverts `ListingCreateFailed()` (selector `0x08586462`), not HEAD's
`assert(address(listing) == predicted)` / Panic(`0x01`). The Part-0a quote of
that `assert` describes **HEAD source only** — corrected by reference here;
do not treat it as live behavior.

**Encode path unchanged:** `listingSalt` / `listingInitCodeHash` /
`predictListingAddress` / `list` signatures and NOTES sections **0b–0f** and
**0j** (measured wei consumption numbers) remain valid as verified by fork.
Site ABI adds ptr getters + `ListingCreateFailed` + CreationCodeStore
bubbled errors + shared `AuctionCreateFailed` for future ladder decode.

See `stonkz-deployed-truth.md` Parts 2–3 for bytecode and ABI checklists.
