# Manual exit guide

How to withdraw legacy Balancer positions **without this UI**, directly against the contracts.
Everything the UI does is a handful of contract calls; this document lists them per pool type so
you can reproduce them from Etherscan (or any block explorer), from Foundry `cast`, from Solidity,
or from the Balancer TypeScript SDK (`@balancer/sdk`).

Covered: Balancer **v1** (Ethereum only), **v2** (all pool types in this repo, including Xave FX and
Element pools), **v3**, and **gauge** unstaking. Everything is a *proportional* exit: you burn BPT
and receive every pool token pro rata.

> Safety first
> - Only ever interact with the addresses listed in [`src/config/registry.json`](src/config/registry.json)
>   or verified by the checks in [Part 1](#part-1-identify-what-you-hold). Never approve anything to an
>   address you did not verify.
> - Simulate (query) before you send. Set `minAmountsOut` from the simulation minus ~1 % slippage.
>   Zero minimums are a last resort ("emergency mode" in the UI).
> - Exits pay out the tokens the vault holds (e.g. WETH, not ETH).

---

## Table of contents

- [Part 1: Identify what you hold](#part-1-identify-what-you-hold)
  - [1.1 Find your position tokens](#11-find-your-position-tokens)
  - [1.2 Is it staked? (gauge vs. BPT)](#12-is-it-staked-gauge-vs-bpt)
  - [1.3 Which protocol version?](#13-which-protocol-version)
  - [1.4 Which pool type? (v2)](#14-which-pool-type-v2)
  - [1.5 Is the pool paused or in recovery mode?](#15-is-the-pool-paused-or-in-recovery-mode)
  - [1.6 Decision table](#16-decision-table)
- [Part 2: Addresses](#part-2-addresses)
- [Part 3: Tooling notes](#part-3-tooling-notes)
- [Part 4: Exit recipes by pool type](#part-4-exit-recipes-by-pool-type)
  - [A. Gauges: unstake and claim](#a-gauges-unstake-and-claim)
  - [B. v1 core pools (BPool) and smart pools (CRP)](#b-v1-core-pools-bpool-and-smart-pools-crp)
  - [C. v2 Weighted, Stable, MetaStable, LBP, Managed, Gyro](#c-v2-weighted-stable-metastable-lbp-managed-gyro)
  - [D. v2 ComposableStable](#d-v2-composablestable)
  - [E. v2 recovery-mode exit (any pool type; required for Linear and StablePhantom)](#e-v2-recovery-mode-exit-any-pool-type-required-for-linear-and-stablephantom)
  - [F. v2 Xave FX pools](#f-v2-xave-fx-pools)
  - [G. v2 Element pools and Element principal tokens](#g-v2-element-pools-and-element-principal-tokens)
  - [H. v3 pools](#h-v3-pools)
- [Part 5: Balancer SDK (TypeScript)](#part-5-balancer-sdk-typescript)

---

## Part 1: Identify what you hold

### 1.1 Find your position tokens

1. Open your address on the chain's explorer (e.g. `https://etherscan.io/address/<you>`), tab
   **Token Holdings** / **ERC-20 Token Txns**.
2. Balancer positions are ERC-20 tokens. Typical names / symbols:

   | Symbol / name pattern                          | What it is                                       |
   | ---------------------------------------------- | ------------------------------------------------ |
   | `BPT` / "Balancer Pool Token"                  | v1 core pool share (BPool)                       |
   | anything else created by the v1 CRP factory    | v1 smart pool share (ConfigurableRightsPool)     |
   | `B-…`, `…-BPT`, `bb-…`, `…-LP`, pool names     | v2 or v3 pool share                              |
   | `bb-a-…`, `bb-e-…`, `bb-g-…`, `bb-y-…`         | v2 Linear pool share (boosted inner pool)        |
   | `LP-…` from Xave (e.g. `LP-EURS-USDC`)         | v2 Xave FX pool share                            |
   | `LPePyv…` ("LP Element Principal Token …")     | v2 Element pool share                            |
   | `ePyv…` (no `LP` prefix)                       | Element **principal token**, not a pool (see G)  |
   | `<pool symbol>-gauge`, "Balancer … Gauge Deposit" | gauge deposit receipt: you are **staked**     |

3. Cross-check the address against the bundled lists in
   [`src/config/data/<chain>.json`](src/config/data). Each file has `v1Pools[]`, `v2Pools[]`
   (with `poolType`, `poolId`, `tokens[]`), `v3Pools[]` and `gauges[]` (with `lpToken`). A hit there
   tells you version, type, pool ID and token order in one go. Search the file for your token
   address (case-insensitive).

### 1.2 Is it staked? (gauge vs. BPT)

Staked BPT sits inside a gauge contract; your wallet holds a gauge token instead of the BPT.

- **From the list:** find `gauges[]` entries in `src/config/data/<chain>.json` whose `lpToken` is your
  pool address, then read `balanceOf(you)` on each gauge.
- **From the explorer:** look for ERC-20 transfers of the BPT from your address to a contract. On
  that contract, **Read Contract → `lp_token()`** must return the BPT address and
  `balanceOf(you)` must be > 0. Gauge contract names on explorers: `LiquidityGaugeV5`
  (Ethereum), `ChildChainGauge` / `RewardsOnlyGauge` (other chains).
- **Verify the gauge** came from a Balancer gauge factory: `registry.json → <chain>.v2.gaugeFactories`
  and the gauge's creation transaction (**Contract Creator** on the explorer) should match.

If staked: unstake first ([A](#a-gauges-unstake-and-claim)), then exit the pool.

### 1.3 Which protocol version?

Open the pool/BPT contract on the explorer and use **Read Contract**:

| Check                                   | v1                                  | v2                                             | v3                                             |
| --------------------------------------- | ----------------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| `getVault()`                            | *(function absent)*                 | `0xBA12222222228d8Ba445958a75a0704d566BF2C8`   | `0xbA1333333333a1BA1108E8412f11850A5C319bA9`   |
| `getPoolId()`                           | absent                              | returns `bytes32` (starts with pool address)   | absent                                         |
| `getCurrentTokens()` / `getController()`| present (BPool)                     | absent                                         | absent                                         |
| `bPool()`                               | present on smart pools (CRP)        | absent                                         | absent                                         |
| Explorer "Contract Name"                | `BPool`, `ConfigurableRightsPool`   | `WeightedPool`, `ComposableStablePool`, `FXPool`, `ConvergentCurvePool`, … | `WeightedPool`, `StablePool`, `StableSurgePool`, `ReClammPool`, … |
| Chain                                   | Ethereum only                       | see registry                                   | see registry                                   |

The `getVault()` address is the definitive answer for v2 vs v3 (contract names overlap). v1 is the
only one without a vault. You can also confirm via the factories:
`BFactory.isBPool(pool)` / `CRPFactory.isCrp(pool)` for v1, and for v3
`Vault.isPoolRegistered(pool)`.

### 1.4 Which pool type? (v2)

v3 pools and v1 pools all share one exit path each; only **v2** needs the pool type.

**Option 1: the bundled list.** `v2Pools[].poolType` in `src/config/data/<chain>.json` is one of
`weighted`, `stable`, `composableStable`, `phantomStable`, `linear`, `gyro`, `lbp`, `managed`,
`fx`, `element`.

**Option 2: the factory.** On the explorer, the pool's **Contract Creator** is the factory. Match it
against `registry.json → <chain>.v2.factories[]`, each entry has `name` and `poolType`.

**Option 3: contract name + feature probes** (Read Contract tab):

| Explorer contract name                                              | poolType           | Probe that succeeds                      |
| ------------------------------------------------------------------- | ------------------ | ---------------------------------------- |
| `WeightedPool`, `WeightedPool2Tokens`                               | `weighted`         | `getNormalizedWeights()`                 |
| `StablePool`, `MetaStablePool`                                      | `stable`           | `getAmplificationParameter()`, no `getBptIndex()` |
| `ComposableStablePool`                                              | `composableStable` | `getBptIndex()`, `getActualSupply()`     |
| `StablePhantomPool`                                                 | `phantomStable`    | `getBptIndex()`, `getVirtualSupply()`, no `getActualSupply()` |
| `AaveLinearPool`, `ERC4626LinearPool`, `EulerLinearPool`, `GearboxLinearPool`, `SiloLinearPool`, `YearnLinearPool` | `linear` | `getMainToken()`, `getWrappedToken()` |
| `LiquidityBootstrappingPool`, `NoProtocolFeeLiquidityBootstrappingPool` | `lbp`          | `getSwapEnabled()`, `getNormalizedWeights()` |
| `InvestmentPool`, `ManagedPool`                                     | `managed`          | `getManagementSwapFeePercentage()` / `getManagementAumFeeParams()` |
| `Gyro2V2Pool`, `Gyro3Pool`, `GyroECLPPool`                          | `gyro`             | `getSqrtParameters()` / `getECLPParams()` |
| `FXPool`                                                            | `fx`               | `derivatives(0)`, `viewWithdraw(uint256)` |
| `ConvergentCurvePool`                                               | `element`          | `bond()`, `underlying()`, `expiration()` |

**Does the pool hold its own BPT?** Composable, phantom-stable, linear and ManagedPool-v2 pools
register their own BPT as a pool token ("pre-minted BPT"). Check with
`Vault.getPoolTokens(poolId)`: if the pool address appears in `tokens`, remember its index; that slot
always gets `minAmountsOut = 0` and receives nothing.

### 1.5 Is the pool paused or in recovery mode?

| Version | Read call                                                          | Meaning                                                                                   |
| ------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| v2      | `pool.inRecoveryMode()`                                            | `true` → use the recovery exit ([E](#e-v2-recovery-mode-exit-any-pool-type-required-for-linear-and-stablephantom)). Very old pools lack the function → not in recovery mode. |
| v2      | `pool.getPausedState()` → `paused`                                 | `true` and not in recovery mode → **no exit path** until governance enables recovery mode. |
| v3      | `Vault.isPoolInRecoveryMode(pool)`                                 | `true` → `Router.removeLiquidityRecovery`.                                                |
| v3      | `Vault.isPoolPaused(pool)`, `Vault.isVaultPaused()`                | paused → anyone may call `Vault.enableRecoveryMode(pool)`, then recovery exit ([H](#h-v3-pools)). |

Linear and StablePhantom pools **only** exit in recovery mode (they have no proportional exit kind).
All deprecated ones are in recovery mode; if you find one that is not, it cannot be exited
proportionally.

### 1.6 Decision table

| You hold                                  | Go to                                                           |
| ----------------------------------------- | --------------------------------------------------------------- |
| gauge token (staked)                      | [A](#a-gauges-unstake-and-claim), then the row for the BPT      |
| v1 BPool / CRP share                      | [B](#b-v1-core-pools-bpool-and-smart-pools-crp)                 |
| v2 `weighted`/`stable`/`lbp`/`managed`/`gyro`, not in recovery mode | [C](#c-v2-weighted-stable-metastable-lbp-managed-gyro) |
| v2 `composableStable`, not in recovery mode | [D](#d-v2-composablestable)                                   |
| v2 any type **in recovery mode**, or `linear` / `phantomStable` | [E](#e-v2-recovery-mode-exit-any-pool-type-required-for-linear-and-stablephantom) |
| v2 `fx`                                   | [F](#f-v2-xave-fx-pools)                                        |
| v2 `element`, or an `ePyv…` principal token | [G](#g-v2-element-pools-and-element-principal-tokens)         |
| v3 pool                                   | [H](#h-v3-pools)                                                |

---

## Part 2: Addresses

All from [`src/config/registry.json`](src/config/registry.json) (machine-generated from the official
Balancer subgraph/backend configs). Verify there before use.

**Same on every chain**

| Contract                | Address                                      |
| ----------------------- | -------------------------------------------- |
| v2 Vault                | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` |
| v3 Vault                | `0xbA1333333333a1BA1108E8412f11850A5C319bA9` |
| Multicall3              | `0xcA11bde05977b3631167028862bE2a173976CA11` |

**Ethereum only (v1)**

| Contract                | Address                                      |
| ----------------------- | -------------------------------------------- |
| v1 BFactory             | `0x9424B1412450D0f8Fc2255FAf6046b98213B76Bd` |
| v1 CRPFactory           | `0xed52D8E202401645eDAD1c0AA21e872498ce47D0` |
| BalancerMinter (BAL emissions for Ethereum gauges) | `0x239e55F427D44C3cc793f49bFB507ebe76638a2b` |

**Per chain**

| Chain         | v2 BalancerQueries                           | v3 Router                                    |
| ------------- | -------------------------------------------- | -------------------------------------------- |
| Ethereum      | `0xe39b5e3b6d74016b2f6a9673d7d7493b6df549d5` | `0x5c6fb490bdfd3246eb0bb062c168decaf4bd9fdd` |
| Arbitrum      | `0xe39b5e3b6d74016b2f6a9673d7d7493b6df549d5` | `0x0f08eef2c785aa5e7539684af04755dec1347b7c` |
| Avalanche     | `0xe39b5e3b6d74016b2f6a9673d7d7493b6df549d5` | `0xf39ca6ede9bf7820a952b52f3c94af526bab9015` |
| Base          | `0x300ab2038eac391f26d9f895dc61f8f66a548833` | `0x76578ecf9a141296ec657847fb45b0585bcda3a6` |
| Fraxtal       | `0x4132f7acc9db7a6cf7be2dd3a9dc8b30c7e6e6c8` | –                                            |
| Gnosis        | `0x0f3e0c4218b7b0108a3643cfe9d3ec0d4f57c54e` | `0x84813aa3e079a665c0b80f944427ee83cba63617` |
| HyperEVM      | –                                            | `0xa8920455934da4d853faac1f94fe7bef72943ef1` |
| Mode          | `0x36cac20dd805d128c1a6dd16eea845c574b5a17c` | –                                            |
| Monad         | –                                            | `0x9da18982a33fd0c7051b19f0d7c76f2d5e7e017c` |
| Optimism      | `0xe39b5e3b6d74016b2f6a9673d7d7493b6df549d5` | `0xe2fa4e1d17725e72dcdafe943ecf45df4b9e285b` |
| Plasma        | –                                            | `0x9da18982a33fd0c7051b19f0d7c76f2d5e7e017c` |
| Polygon       | `0xe39b5e3b6d74016b2f6a9673d7d7493b6df549d5` | –                                            |
| Polygon zkEVM | `0x809b79b53f18e9bc08a961ed4678b901ac93213a` | –                                            |
| X Layer       | –                                            | `0xc3ccace87f6d3a81724075adcb5ddd85a8a1bb68` |

---

## Part 3: Tooling notes

**Explorer "Write Contract"** (Etherscan, Arbiscan, Polygonscan, …): open the contract, tab
*Contract → Write Contract → Connect to Web3*, fill the fields, *Write*. Notes:

- `uint256` amounts are entered in raw units (wei). 1.5 BPT with 18 decimals = `1500000000000000000`.
- Arrays are entered as JSON: `["0xabc…","0xdef…"]`, `[0,0]`.
- Tuples (the v2 `ExitPoolRequest`) are entered as a JSON array of the fields in order:
  `[["0xToken0","0xToken1"],["123","456"],"0x<userData>",false]`.
- `bytes` fields (`userData`) are hex strings. For the standard v2 encodings you can build them by
  hand: `0x` + each `uint256` as 64 hex characters, left-padded with zeros (see the recipes).
- v3 Vault calls like `getPoolTokens`, `isPoolInRecoveryMode`, `enableRecoveryMode` live in the
  Vault's extension contracts behind a fallback; the explorer's Vault page does not list them. Use
  `cast` / the SDK for those, or the explorer's *custom ABI* feature on the Vault address.
- `queryExit` (v2) and the v3 `query…` router functions are not `view`, so explorers won't *read*
  them. Use `cast call` (below) or compute the amounts by hand (each recipe shows the formula).

**Foundry `cast`** (`curl -L https://foundry.paradigm.xyz | bash && foundryup`):

```bash
export RPC=https://ethereum-rpc.publicnode.com      # any RPC for the chain
cast call  $ADDR "sig(types)(returns)" args --rpc-url $RPC            # read / simulate
cast send  $ADDR "sig(types)" args --rpc-url $RPC --ledger            # or --private-key / --trezor / --interactive
cast abi-encode "f(uint256,uint256)" 1 1500000000000000000            # build userData
```

**viem** (`npm i viem`) is what the UI uses; all ABIs are in [`src/abis`](src/abis) and the call
sequences in [`src/lib`](src/lib). Any snippet there can be copied into a script.

**Slippage:** `min = expected − expected × 1 %` = `expected × 99 / 100` (integer math). Set the
pre-minted-BPT slot (if any) to `0`.

---

## Part 4: Exit recipes by pool type

### A. Gauges: unstake and claim

Applies to Ethereum `LiquidityGaugeV5` gauges and child-chain `ChildChainGauge` /
`RewardsOnlyGauge` gauges alike. Unstaking returns the BPT to your wallet; it does **not** exit the
pool.

```
withdraw(uint256 _value, bool _claim_rewards)   // _value = gauge balanceOf(you); true = also claim reward tokens
claim_rewards(address _addr)                     // claim reward tokens only
balanceOf(address), lp_token(), reward_count(), reward_tokens(uint256), claimable_reward(address,address)
```

On **Ethereum**, BAL emissions are *not* a gauge reward token; mint them from the BalancerMinter:
`BalancerMinter.mint(address gauge)` (`0x239e55F427D44C3cc793f49bFB507ebe76638a2b`). Claim before
or after unstaking; unstaking does not forfeit accrued BAL. On other chains BAL is a regular reward
token and `withdraw(amount, true)` claims it.

**Explorer:** gauge → Read Contract → `balanceOf(you)`, `lp_token()` (must be your BPT) → Write
Contract → `withdraw(_value = balance, _claim_rewards = true)`. Then Ethereum: BalancerMinter →
`mint(gauge)`.

**cast**

```bash
cast call $GAUGE "balanceOf(address)(uint256)" $YOU --rpc-url $RPC
cast call $GAUGE "lp_token()(address)" --rpc-url $RPC
cast send $GAUGE "withdraw(uint256,bool)" <balance> true --rpc-url $RPC --ledger
cast send 0x239e55F427D44C3cc793f49bFB507ebe76638a2b "mint(address)" $GAUGE --rpc-url $RPC --ledger   # Ethereum only
```

**Solidity**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ILiquidityGauge {
    function balanceOf(address) external view returns (uint256);
    function lp_token() external view returns (address);
    function withdraw(uint256 _value, bool _claim_rewards) external;
    function claim_rewards(address _addr) external;
}

interface IBalancerMinter {
    function mint(address gauge) external returns (uint256);
}

// Call from the EOA that staked, e.g. via a Foundry script using vm.startBroadcast().
contract UnstakeExample {
    function unstakeAll(ILiquidityGauge gauge) external {
        uint256 bal = gauge.balanceOf(msg.sender);
        gauge.withdraw(bal, true); // returns BPT + reward tokens to msg.sender
    }
}
```

> A gauge withdraws to `msg.sender`, so the call must come from the staking address itself (an EOA
> via a script/explorer, or the contract that staked). A helper contract cannot unstake on your behalf.

**viem** — [`src/lib/gauges.ts`](src/lib/gauges.ts) is the exact call the UI sends.

---

### B. v1 core pools (BPool) and smart pools (CRP)

Ethereum only. v1 pools are standalone contracts: you call the pool share token directly, there is no
vault and no approval.

```
BPool / ConfigurableRightsPool:
  exitPool(uint256 poolAmountIn, uint256[] minAmountsOut)
  getCurrentTokens() → address[]       (CRP: call on bPool())
  getBalance(address token) → uint256  (CRP: call on bPool())
  totalSupply() → uint256              (call on the share token you hold)
```

**Expected amounts** (exact v1 math, rounding aside):

- core: `amount_i = getBalance(token_i) × poolAmountIn / totalSupply`
- smart (CRP): `amount_i = (getBalance(token_i) − 1) × poolAmountIn / (totalSupply + 1)`; balances
  are read on the backing `bPool()`, `totalSupply` on the CRP.

`minAmountsOut` must be in `getCurrentTokens()` order. Exit fee is zero on factory pools.

**Explorer**

1. Pool → Read Contract: `getCurrentTokens()`, `getBalance(token)` for each, `totalSupply()`.
   For a CRP, first read `bPool()` and run the token/balance reads on that address.
2. Pool → Write Contract → `exitPool(poolAmountIn = your balance, minAmountsOut = [99 % of each expected amount])`.

**cast**

```bash
cast call $POOL "getCurrentTokens()(address[])" --rpc-url $RPC
cast call $POOL "getBalance(address)(uint256)" $TOKEN --rpc-url $RPC
cast call $POOL "totalSupply()(uint256)" --rpc-url $RPC
# dry run exactly what you will send:
cast call $POOL "exitPool(uint256,uint256[])" $BPT_IN "[$MIN0,$MIN1]" --from $YOU --rpc-url $RPC
cast send $POOL "exitPool(uint256,uint256[])" $BPT_IN "[$MIN0,$MIN1]" --rpc-url $RPC --ledger
```

**Solidity**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IBPool {
    function getCurrentTokens() external view returns (address[] memory);
    function getBalance(address token) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function exitPool(uint256 poolAmountIn, uint256[] calldata minAmountsOut) external;
}

interface ICRP is IBPool {
    function bPool() external view returns (IBPool);
}

contract V1ExitExample {
    /// @dev Call from the BPT holder (Foundry script + vm.startBroadcast). Burns `bptIn` and
    ///      sends the underlying tokens to msg.sender.
    function exitCore(IBPool pool, uint256 bptIn, uint256 slippageBps) external {
        address[] memory tokens = pool.getCurrentTokens();
        uint256 supply = pool.totalSupply();
        uint256[] memory mins = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; i++) {
            uint256 expected = pool.getBalance(tokens[i]) * bptIn / supply;
            mins[i] = expected * (10_000 - slippageBps) / 10_000;
        }
        pool.exitPool(bptIn, mins);
    }

    function exitSmart(ICRP crp, uint256 bptIn, uint256 slippageBps) external {
        IBPool backing = crp.bPool();
        address[] memory tokens = backing.getCurrentTokens();
        uint256 supply = crp.totalSupply();
        uint256[] memory mins = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; i++) {
            uint256 expected = (backing.getBalance(tokens[i]) - 1) * bptIn / (supply + 1);
            mins[i] = expected * (10_000 - slippageBps) / 10_000;
        }
        crp.exitPool(bptIn, mins);
    }
}
```

**SDK:** not supported (`@balancer/sdk` covers v2/v3 only). Use the viem code in
[`src/lib/v1.ts`](src/lib/v1.ts).

---

### C. v2 Weighted, Stable, MetaStable, LBP, Managed, Gyro

All v2 exits go through the **Vault**: `Vault.exitPool(poolId, sender, recipient, request)`. The
Vault burns your BPT directly; **no approval needed**. `sender` and `recipient` are both you.

```solidity
struct ExitPoolRequest {
    address[] assets;        // exactly Vault.getPoolTokens(poolId).tokens, same order
    uint256[] minAmountsOut; // same length/order
    bytes userData;          // pool-type specific, see below
    bool toInternalBalance;  // false
}
```

**userData for this group:** `abi.encode(uint256 exitKind = 1, uint256 bptAmountIn)`
(`EXACT_BPT_IN_FOR_TOKENS_OUT`). By hand:

```
0x
0000000000000000000000000000000000000000000000000000000000000001   ← exitKind 1
00000000000000000000000000000000000000000000000014d1120d7b160000   ← bptIn (1.5e18 here), 64 hex chars
```

(ManagedPool v2 pools list their own BPT in `assets`; give that slot `minAmountsOut = 0`.)

**Expected amounts:** `amount_i = balance_i × bptIn / totalSupply`, with `balances` from
`Vault.getPoolTokens(poolId)` and `totalSupply()` from the pool. Or simulate with
`BalancerQueries.queryExit(poolId, you, you, request)` → `(bptIn, amountsOut[])`.

**Explorer**

1. Pool → Read Contract → `getPoolId()`, `totalSupply()`, `inRecoveryMode()` (if present; `true` → recipe E).
2. Vault → Read Contract → `getPoolTokens(poolId)` → `tokens[]`, `balances[]`.
3. Compute `minAmountsOut` (99 % of expected, in token order).
4. Vault → Write Contract → `exitPool`:
   - `poolId`: from step 1
   - `sender`, `recipient`: your address
   - `request`: `[["<token0>","<token1>",…],["<min0>","<min1>",…],"0x<userData>",false]`

**cast**

```bash
POOL_ID=$(cast call $POOL "getPoolId()(bytes32)" --rpc-url $RPC)
cast call $VAULT "getPoolTokens(bytes32)(address[],uint256[],uint256)" $POOL_ID --rpc-url $RPC
USERDATA=$(cast abi-encode "f(uint256,uint256)" 1 $BPT_IN)
# simulate
cast call $QUERIES "queryExit(bytes32,address,address,(address[],uint256[],bytes,bool))(uint256,uint256[])" \
  $POOL_ID $YOU $YOU "([$T0,$T1],[0,0],$USERDATA,false)" --rpc-url $RPC
# send
cast send $VAULT "exitPool(bytes32,address,address,(address[],uint256[],bytes,bool))" \
  $POOL_ID $YOU $YOU "([$T0,$T1],[$MIN0,$MIN1],$USERDATA,false)" --rpc-url $RPC --ledger
```

**Solidity**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IVaultV2 {
    struct ExitPoolRequest { address[] assets; uint256[] minAmountsOut; bytes userData; bool toInternalBalance; }
    function getPoolTokens(bytes32 poolId) external view returns (address[] memory tokens, uint256[] memory balances, uint256 lastChangeBlock);
    function exitPool(bytes32 poolId, address sender, address payable recipient, ExitPoolRequest calldata request) external;
}

interface IBasePoolV2 {
    function getPoolId() external view returns (bytes32);
    function totalSupply() external view returns (uint256);
}

contract V2ExitExample {
    IVaultV2 constant VAULT = IVaultV2(0xBA12222222228d8Ba445958a75a0704d566BF2C8);

    /// @dev msg.sender must hold the BPT. The Vault burns it from `sender`; a contract may only
    ///      pass sender == itself (or be approved as a relayer), so run this from the holder.
    function exitProportional(address pool, uint256 bptIn, uint256 slippageBps) external {
        bytes32 poolId = IBasePoolV2(pool).getPoolId();
        (address[] memory tokens, uint256[] memory balances, ) = VAULT.getPoolTokens(poolId);
        uint256 supply = IBasePoolV2(pool).totalSupply();

        uint256[] memory mins = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; i++) {
            if (tokens[i] == pool) continue; // pre-minted BPT slot (ManagedPool v2): min 0
            mins[i] = balances[i] * bptIn / supply * (10_000 - slippageBps) / 10_000;
        }

        VAULT.exitPool(poolId, msg.sender, payable(msg.sender), IVaultV2.ExitPoolRequest({
            assets: tokens,
            minAmountsOut: mins,
            userData: abi.encode(uint256(1), bptIn), // EXACT_BPT_IN_FOR_TOKENS_OUT
            toInternalBalance: false
        }));
    }
}
```

**SDK:** see [Part 5, v2](#v2-pools-weighted-stable-metastable-gyro-composablestable). Supported
types: Weighted, Stable, MetaStable, Gyro2/3/E, ComposableStable. **LBP and Managed are not
supported by the SDK**: use the contract path above (the encoding is identical to Weighted).

---

### D. v2 ComposableStable

Same as C with two differences:

1. `assets` includes the pool's own BPT (at `getBptIndex()`); set that slot's `minAmountsOut` to 0.
2. `userData = abi.encode(uint256 exitKind = 2, uint256 bptAmountIn)` (`EXACT_BPT_IN_FOR_ALL_TOKENS_OUT`).
   Kind 1 means something else on composable pools (`BPT_IN_FOR_EXACT_TOKENS_OUT`) and will revert
   or misbehave.

```
0x
0000000000000000000000000000000000000000000000000000000000000002   ← exitKind 2
00000000000000000000000000000000000000000000000014d1120d7b160000   ← bptIn
```

**Expected amounts:** `amount_i = balance_i × bptIn / getActualSupply()` for every non-BPT token
(`getActualSupply()` on the pool is the circulating supply excluding pre-minted BPT; the first
ComposableStable factory version only has `getVirtualSupply()`, use that instead). Or
`BalancerQueries.queryExit`.

Everything else (explorer steps, cast, Solidity) is identical to C with `1` → `2` and
`totalSupply()` → `getActualSupply()`. If the pool is in recovery mode, recipe E applies and uses
kind 255 instead.

**SDK:** supported (`PoolType.ComposableStable`), see Part 5.

---

### E. v2 recovery-mode exit (any pool type; required for Linear and StablePhantom)

When `pool.inRecoveryMode()` is `true`, every v2 pool type accepts one special exit:
`userData = abi.encode(uint256 exitKind = 255, uint256 bptAmountIn)` (`RECOVERY_MODE_EXIT_KIND`).
It bypasses pool math (and the pause check), so it also works on **paused** pools that are in
recovery mode. Linear and StablePhantom pools have **no other** exit kind.

```
0x
00000000000000000000000000000000000000000000000000000000000000ff   ← exitKind 255
00000000000000000000000000000000000000000000000014d1120d7b160000   ← bptIn
```

**Expected amounts** (`BalancerQueries.queryExit` reverts on paused pools, so compute by hand):

```
virtualSupply = totalSupply − balances[bptIndex]     (if the pool holds its own BPT; else totalSupply)
amount_i      = balances[i] × bptIn / virtualSupply  (0 for the BPT slot)
```

`balances` from `Vault.getPoolTokens(poolId)` are the "cash" balances the recovery exit pays from.

Explorer / cast / Solidity: same as C with exitKind `255` and the formula above. The Solidity
example in C becomes:

```solidity
userData: abi.encode(uint256(255), bptIn) // RECOVERY_MODE_EXIT_KIND
// and compute mins with virtualSupply = supply - balances[bptIndex]
```

Nested/boosted pools (e.g. `bb-a-USD`) pay out the inner **linear-pool BPTs**. Those are new
positions: repeat recipe E on each inner pool (they are all in recovery mode) to get the underlying.

**SDK:** `RemoveLiquidityKind.Recovery` is supported for the SDK pool types (Weighted, Stable,
MetaStable, Gyro, ComposableStable). Linear / StablePhantom are not SDK pool types: use the
contract path.

---

### F. v2 Xave FX pools

FX pools (`FXPool`, factories named `FXPoolFactory…` in the registry) use their own `userData` and
do **not** support `BalancerQueries.queryExit`.

- `userData = abi.encode(uint256 bptAmountIn, address[] assets)` — bptIn **first**, then the
  token list (same order as `getPoolTokens`). The older FXPool version only decodes the first
  word, the newer one both; this encoding works for both.
- **Never** send the standard `(exitKind, bptIn)` encoding: the pool would read the exit kind as
  the BPT amount and burn 1 wei for nothing.
- Expected amounts: `pool.viewWithdraw(bptIn)` → `uint256[2]` in **`derivatives(0)`, `derivatives(1)`**
  order, which may differ from the Vault's token order. Map by address. Amounts are converted via
  the pool's price-oracle assimilators; if an oracle is dead the exit reverts.

**Explorer**

1. Pool → Read: `getPoolId()`, `derivatives(0)`, `derivatives(1)`, `viewWithdraw(bptIn)`.
2. Vault → Read: `getPoolTokens(poolId)`; align `viewWithdraw` output to that order.
3. Build `userData`: `0x` + bptIn (64 hex) + `0000…0040` (offset 64, as 64 hex chars) + array length
   (`0000…0002`) + each address left-padded to 64 hex chars. Easier: `cast abi-encode "f(uint256,address[])" $BPT_IN "[$T0,$T1]"`.
4. Vault → Write → `exitPool(poolId, you, you, [[tokens],[mins],"0x<userData>",false])`.

**cast**

```bash
USERDATA=$(cast abi-encode "f(uint256,address[])" $BPT_IN "[$T0,$T1]")
cast call $POOL "viewWithdraw(uint256)(uint256[])" $BPT_IN --rpc-url $RPC
# dry run from your address (no queryExit support on FX):
cast call $VAULT "exitPool(bytes32,address,address,(address[],uint256[],bytes,bool))" \
  $POOL_ID $YOU $YOU "([$T0,$T1],[0,0],$USERDATA,false)" --from $YOU --rpc-url $RPC
cast send $VAULT "exitPool(bytes32,address,address,(address[],uint256[],bytes,bool))" \
  $POOL_ID $YOU $YOU "([$T0,$T1],[$MIN0,$MIN1],$USERDATA,false)" --rpc-url $RPC --ledger
```

**Solidity** (uses `IVaultV2` from recipe C)

```solidity
interface IFXPool {
    function getPoolId() external view returns (bytes32);
    function derivatives(uint256) external view returns (address);
    function viewWithdraw(uint256 tokensToBurn) external view returns (uint256[] memory); // derivatives order
}

function exitFx(IFXPool pool, uint256 bptIn, uint256 slippageBps) external {
    bytes32 poolId = pool.getPoolId();
    (address[] memory tokens, , ) = VAULT.getPoolTokens(poolId);
    uint256[] memory preview = pool.viewWithdraw(bptIn);
    address d0 = pool.derivatives(0);

    uint256[] memory mins = new uint256[](tokens.length);
    for (uint256 i; i < tokens.length; i++) {
        uint256 expected = tokens[i] == d0 ? preview[0] : preview[1];
        mins[i] = expected * (10_000 - slippageBps) / 10_000;
    }

    VAULT.exitPool(poolId, msg.sender, payable(msg.sender), IVaultV2.ExitPoolRequest({
        assets: tokens,
        minAmountsOut: mins,
        userData: abi.encode(bptIn, tokens), // FX: (bptIn, assets), NOT (exitKind, bptIn)
        toInternalBalance: false
    }));
}
```

**SDK:** not supported for remove liquidity (no v2 `FX` handler). Use the contract path or
[`src/lib/v2.ts`](src/lib/v2.ts) `quoteCustomExit`.

---

### G. v2 Element pools and Element principal tokens

Element pools (`ConvergentCurvePool`, symbol `LPePyv…`) hold a **principal token** (`ePyv…`, the
"bond", `pool.bond()`) and its underlying. Exiting pays out both. The principal tokens are long
matured and redeem 1:1 for the underlying via their Tranche contract (the `ePyv…` token itself).

**Step 1: exit the pool**

- `userData = abi.encode(uint256[] amountsOut)`: the amounts you want, in `getPoolTokens` order.
  The pool computes the matching BPT and **burns it from `recipient`**, so `recipient` must be you
  (and must hold the BPT). There is no exit kind and no `bptIn` field.
- Expected amounts: `amount_i = balance_i × bptIn / totalSupply` (`balances` from
  `Vault.getPoolTokens`, `totalSupply` from the pool). Use these as `amountsOut` in `userData`; if
  you ask for slightly less than proportional, the pool burns correspondingly less BPT.
- `minAmountsOut` can equal `amountsOut` (the pool pays exactly what the userData asks or reverts).
- No `queryExit` support: dry-run with `cast call --from $YOU` before sending.

```bash
USERDATA=$(cast abi-encode "f(uint256[])" "[$AMOUNT0,$AMOUNT1]")
cast call $VAULT "exitPool(bytes32,address,address,(address[],uint256[],bytes,bool))" \
  $POOL_ID $YOU $YOU "([$T0,$T1],[$AMOUNT0,$AMOUNT1],$USERDATA,false)" --from $YOU --rpc-url $RPC
cast send $VAULT "exitPool(bytes32,address,address,(address[],uint256[],bytes,bool))" \
  $POOL_ID $YOU $YOU "([$T0,$T1],[$AMOUNT0,$AMOUNT1],$USERDATA,false)" --rpc-url $RPC --ledger
```

Explorer: Vault → Write → `exitPool(poolId, you, you, [[tokens],[amounts],"0x<userData>",false])`
with `userData` = `cast abi-encode "f(uint256[])" "[a0,a1]"` (by hand: `0x` + offset `…0020` +
length `…0002` + each amount as 64 hex chars).

**Step 2: redeem the principal token (`ePyv…`)**

The `ePyv…` token is an Element `Tranche`. After `unlockTimestamp()` (all have passed) call:

```
Tranche.withdrawPrincipal(uint256 _amount, address _destination) → uint256 underlyingOut
```

No approval needed; it burns your `ePyv…` and sends the underlying. Dust below ~0.0001 tokens
reverts with `Not enough underlying`; leave it.

```bash
cast call $TRANCHE "unlockTimestamp()(uint256)" --rpc-url $RPC
cast call $TRANCHE "withdrawPrincipal(uint256,address)(uint256)" $AMOUNT $YOU --from $YOU --rpc-url $RPC
cast send $TRANCHE "withdrawPrincipal(uint256,address)" $AMOUNT $YOU --rpc-url $RPC --ledger
```

Explorer: `ePyv…` token → Write Contract → `withdrawPrincipal(_amount = balance, _destination = you)`.

**Solidity** (uses `IVaultV2` from recipe C)

```solidity
interface IElementPool { function getPoolId() external view returns (bytes32); function totalSupply() external view returns (uint256); function bond() external view returns (address); }
interface ITranche { function withdrawPrincipal(uint256 amount, address destination) external returns (uint256); }

function exitElement(IElementPool pool, uint256 bptIn) external {
    bytes32 poolId = pool.getPoolId();
    (address[] memory tokens, uint256[] memory balances, ) = VAULT.getPoolTokens(poolId);
    uint256 supply = pool.totalSupply();
    uint256[] memory amounts = new uint256[](tokens.length);
    for (uint256 i; i < tokens.length; i++) amounts[i] = balances[i] * bptIn / supply;

    // recipient must be the BPT holder: the pool burns the BPT it computes from `amounts` there
    VAULT.exitPool(poolId, msg.sender, payable(msg.sender), IVaultV2.ExitPoolRequest({
        assets: tokens, minAmountsOut: amounts, userData: abi.encode(amounts), toInternalBalance: false
    }));
    // then, from the holder: ITranche(pool.bond()).withdrawPrincipal(balance, holder);
}
```

**SDK:** not supported. Use the contract path or [`src/lib/v2.ts`](src/lib/v2.ts) /
[`src/lib/element.ts`](src/lib/element.ts).

---

### H. v3 pools

v3 exits go through the **Router** (per-chain address in Part 2), which pulls BPT from you. Unlike
v2 you must **approve the BPT to the Router** first (plain ERC-20 `approve` on the pool token; the
SDK can use a permit signature instead).

```
Router.removeLiquidityProportional(address pool, uint256 exactBptAmountIn, uint256[] minAmountsOut, bool wethIsEth, bytes userData) → amountsOut
Router.removeLiquidityRecovery(address pool, uint256 exactBptAmountIn, uint256[] minAmountsOut) → amountsOut   // pool in recovery mode
Router.queryRemoveLiquidityProportional(address pool, uint256 exactBptAmountIn, bytes userData) → amountsOut   // eth_call only
Router.queryRemoveLiquidityRecovery(address pool, uint256 exactBptAmountIn) → amountsOut                       // eth_call only
Vault.getPoolTokens(pool), Vault.isPoolInRecoveryMode(pool), Vault.isPoolPaused(pool), Vault.isVaultPaused()
Vault.enableRecoveryMode(pool)   // permissionless while the pool or the Vault is paused
```

Token order = `Vault.getPoolTokens(pool)`. `wethIsEth = false` pays WETH. `userData = 0x`.

**Which call?**

| State                                     | Call                                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| normal                                    | `removeLiquidityProportional`                                                          |
| `isPoolInRecoveryMode == true`            | `removeLiquidityRecovery` (a few early routers only have the 2-arg form without mins)  |
| paused and not in recovery mode           | `Vault.enableRecoveryMode(pool)` (anyone), then `removeLiquidityRecovery`              |

**Expected amounts:** v3 queries must be `eth_call`ed with `from = 0x000…000`, or compute
`amount_i = balance_i × bptIn / totalSupply()` from `Vault.getPoolTokenInfo(pool)` balances.

**Explorer**

1. Pool → Write Contract → `approve(spender = Router, amount = your balance)`.
2. Router → Write Contract → `removeLiquidityProportional(pool, exactBptAmountIn, minAmountsOut = [..], wethIsEth = false, userData = 0x)`,
   or `removeLiquidityRecovery(pool, exactBptAmountIn, minAmountsOut)`.
   The explorer's Vault page does not list `getPoolTokens` / `isPoolInRecoveryMode` /
   `enableRecoveryMode` (they sit behind the Vault's fallback); use `cast` for those, or read the
   token list from the pool's `getTokens()`.

**cast**

```bash
cast call $VAULT3 "getPoolTokens(address)(address[])" $POOL --rpc-url $RPC
cast call $VAULT3 "isPoolInRecoveryMode(address)(bool)" $POOL --rpc-url $RPC
cast call $VAULT3 "isPoolPaused(address)(bool)" $POOL --rpc-url $RPC
# query (must come from the zero address)
cast call $ROUTER "queryRemoveLiquidityProportional(address,uint256,bytes)(uint256[])" $POOL $BPT_IN 0x \
  --from 0x0000000000000000000000000000000000000000 --rpc-url $RPC
# approve + exit
cast send $POOL   "approve(address,uint256)" $ROUTER $BPT_IN --rpc-url $RPC --ledger
cast send $ROUTER "removeLiquidityProportional(address,uint256,uint256[],bool,bytes)" \
  $POOL $BPT_IN "[$MIN0,$MIN1]" false 0x --rpc-url $RPC --ledger
# recovery variants
cast send $VAULT3 "enableRecoveryMode(address)" $POOL --rpc-url $RPC --ledger        # only if paused
cast send $ROUTER "removeLiquidityRecovery(address,uint256,uint256[])" $POOL $BPT_IN "[$MIN0,$MIN1]" --rpc-url $RPC --ledger
```

**Solidity**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IERC20 { function approve(address, uint256) external returns (bool); function balanceOf(address) external view returns (uint256); function totalSupply() external view returns (uint256); }

interface IVaultV3 {
    function getPoolTokens(address pool) external view returns (address[] memory);
    struct TokenInfo { uint8 tokenType; address rateProvider; bool paysYieldFees; }
    function getPoolTokenInfo(address pool) external view returns (address[] memory tokens, TokenInfo[] memory tokenInfo, uint256[] memory balancesRaw, uint256[] memory lastBalancesLiveScaled18);
    function isPoolInRecoveryMode(address pool) external view returns (bool);
    function isPoolPaused(address pool) external view returns (bool);
    function enableRecoveryMode(address pool) external;
}

interface IRouterV3 {
    function removeLiquidityProportional(address pool, uint256 exactBptAmountIn, uint256[] memory minAmountsOut, bool wethIsEth, bytes memory userData) external payable returns (uint256[] memory);
    function removeLiquidityRecovery(address pool, uint256 exactBptAmountIn, uint256[] memory minAmountsOut) external payable returns (uint256[] memory);
}

contract V3ExitExample {
    IVaultV3 constant VAULT = IVaultV3(0xbA1333333333a1BA1108E8412f11850A5C319bA9);

    /// @dev Run from the BPT holder (Foundry script): the Router pulls BPT from msg.sender.
    function exit(IRouterV3 router, address pool, uint256 bptIn, uint256 slippageBps) external {
        (, , uint256[] memory balances, ) = VAULT.getPoolTokenInfo(pool);
        uint256 supply = IERC20(pool).totalSupply();
        uint256[] memory mins = new uint256[](balances.length);
        for (uint256 i; i < balances.length; i++) {
            mins[i] = balances[i] * bptIn / supply * (10_000 - slippageBps) / 10_000;
        }

        IERC20(pool).approve(address(router), bptIn);

        if (VAULT.isPoolInRecoveryMode(pool)) {
            router.removeLiquidityRecovery(pool, bptIn, mins);
        } else if (VAULT.isPoolPaused(pool)) {
            VAULT.enableRecoveryMode(pool); // permissionless while paused
            router.removeLiquidityRecovery(pool, bptIn, mins);
        } else {
            router.removeLiquidityProportional(pool, bptIn, mins, false, "");
        }
    }
}
```

**SDK:** supported (Proportional and Recovery), see [Part 5, v3](#v3-pools).

---

## Part 5: Balancer SDK (TypeScript)

```bash
npm i @balancer/sdk viem
```

`@balancer/sdk` (b-sdk) covers v2 pool types **Weighted, Stable, MetaStable, Gyro2/Gyro3/GyroE,
ComposableStable** and all **v3** pools, with `RemoveLiquidityKind.Proportional` and
`RemoveLiquidityKind.Recovery`. It does **not** cover v1, LBP, Managed, Linear, StablePhantom, FX,
Element, or gauges; for those use the contract recipes above (or the viem code in `src/lib`).

Pool state normally comes from the Balancer API. Deprecated pools may disappear from it, so the
examples also show how to build `PoolState` by hand from on-chain data (`Vault.getPoolTokens`).

Common setup:

```ts
import {
  BalancerApi, RemoveLiquidity, RemoveLiquidityKind, Slippage, PermitHelper,
  type PoolState, type RemoveLiquidityInput,
} from '@balancer/sdk'
import { createWalletClient, custom, erc20Abi, publicActions } from 'viem'
import { mainnet } from 'viem/chains'

const chainId = 1
const rpcUrl = 'https://ethereum-rpc.publicnode.com'
const walletClient = createWalletClient({ chain: mainnet, transport: custom(window.ethereum) }).extend(publicActions)
const [account] = await walletClient.getAddresses()
const slippage = Slippage.fromPercentage('1')

// Option 1: pool state from the Balancer API (v2 pools use the poolId, v3 pools the address)
const api = new BalancerApi('https://api-v3.balancer.fi/', chainId)
const poolState: PoolState = await api.pools.fetchPoolState(poolIdOrAddress)

// Option 2: pool state by hand (works when the API no longer lists the pool)
const manualPoolState: PoolState = {
  id: '0x…poolId…',           // v2: bytes32 poolId; v3: the pool address
  address: '0x…pool…',
  type: 'Weighted',           // 'Weighted' | 'Stable' | 'MetaStable' | 'Gyro2' | 'Gyro3' | 'GyroE' | 'ComposableStable' | v3 types
  protocolVersion: 2,         // 2 or 3
  tokens: [                   // exactly Vault.getPoolTokens order, incl. the pool's own BPT for composable pools
    { address: '0x…', decimals: 18, index: 0 },
    { address: '0x…', decimals: 6,  index: 1 },
  ],
}
```

### v2 pools (Weighted, Stable, MetaStable, Gyro, ComposableStable)

```ts
const bptBalance = await walletClient.readContract({
  address: poolState.address, abi: erc20Abi, functionName: 'balanceOf', args: [account],
})

const inRecoveryMode = await walletClient
  .readContract({
    address: poolState.address,
    abi: [{ type: 'function', name: 'inRecoveryMode', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] }],
    functionName: 'inRecoveryMode',
  })
  .catch(() => false) // very old pools lack the function

const input: RemoveLiquidityInput = {
  chainId,
  rpcUrl,
  kind: inRecoveryMode ? RemoveLiquidityKind.Recovery : RemoveLiquidityKind.Proportional,
  bptIn: { address: poolState.address, decimals: 18, rawAmount: bptBalance },
}

const removeLiquidity = new RemoveLiquidity()
const queryOutput = await removeLiquidity.query(input, poolState)   // queryOutput.amountsOut: TokenAmount[]

// v2 needs sender/recipient (no approval: the Vault burns BPT from `sender`)
const call = removeLiquidity.buildCall({
  ...queryOutput,
  slippage,
  sender: account,
  recipient: account,
  toInternalBalance: false,
})
// call.to === v2 Vault, call.minAmountsOut is what the UI shows as "minimum"

const hash = await walletClient.sendTransaction({ account, to: call.to, data: call.callData, value: call.value })
```

For a pool the SDK rejects with `Unsupported pool type` (LBP, Managed, Linear, FX, Element, …) fall
back to the recipes in Part 4; the viem equivalents are in [`src/lib/v2.ts`](src/lib/v2.ts).

### v3 pools

```ts
import { vaultV3Abi } from './src/abis/vaultV3'   // or any ABI with isPoolInRecoveryMode(address)

const vaultV3 = '0xbA1333333333a1BA1108E8412f11850A5C319bA9'
const routerAddress = '0x…'   // Part 2 / registry.json <chain>.v3.router

const inRecoveryMode = await walletClient.readContract({
  address: vaultV3, abi: vaultV3Abi, functionName: 'isPoolInRecoveryMode', args: [poolState.address],
})

const input: RemoveLiquidityInput = {
  chainId,
  rpcUrl,
  kind: inRecoveryMode ? RemoveLiquidityKind.Recovery : RemoveLiquidityKind.Proportional,
  bptIn: { address: poolState.address, decimals: 18, rawAmount: bptBalance },
}

const removeLiquidity = new RemoveLiquidity()
const queryOutput = await removeLiquidity.query(input, poolState)

// Approval, option A: ERC-20 approve of the BPT to the Router (what this UI does), then buildCall
await walletClient.writeContract({
  account, address: poolState.address, abi: erc20Abi, functionName: 'approve', args: [routerAddress, bptBalance],
})
const call = removeLiquidity.buildCall({ ...queryOutput, slippage, wethIsEth: false, userData: '0x' })

// Approval, option B: permit signature, single transaction (no separate approve)
const permit = await PermitHelper.signRemoveLiquidityApproval({
  ...queryOutput, slippage, client: walletClient, owner: account,
})
const callWithPermit = removeLiquidity.buildCallWithPermit(
  { ...queryOutput, slippage, wethIsEth: false, userData: '0x' },
  permit,
)

const hash = await walletClient.sendTransaction({ account, to: call.to, data: call.callData, value: call.value })
```

A paused pool that is not in recovery mode first needs `Vault.enableRecoveryMode(pool)`
(permissionless, see recipe H); the SDK has no helper for it, use
[`src/lib/v3.ts`](src/lib/v3.ts) `enableV3RecoveryMode`.

### Gauges, v1, FX, Element

No SDK support. Use viem with the ABIs in [`src/abis`](src/abis):

```ts
import { childChainGaugeV2Abi } from './src/abis/childChainGaugeV2'
await walletClient.writeContract({ account, address: gauge, abi: childChainGaugeV2Abi, functionName: 'withdraw', args: [stakedBalance, true] })
```

and [`src/lib/v1.ts`](src/lib/v1.ts), [`src/lib/v2.ts`](src/lib/v2.ts) (`quoteCustomExit` for FX /
Element), [`src/lib/element.ts`](src/lib/element.ts) for the rest. Each exported function is a
self-contained viem call.
