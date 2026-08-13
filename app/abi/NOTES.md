# Express vanity / salt recon

Source: `C:\Users\david\stonkz` at `HEAD` = `302834ff1c1404d856760ca0caa0ef9363613ae8`
(`git -C C:\Users\david\stonkz show HEAD:<path>` only; dirty tree not read).

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
carry value** — an ETH settle buffer. Fork tests use `ETH_LIST_BUFFER = 1 ether`
(`contracts/test/ForkCanonPhase4.t.sol:130`). Adapter refunds unused dust.
Mock-PM unit tests often call `list` with 0 value; real PM needs the buffer.
