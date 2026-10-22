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
| v2      | `pool.inRecoveryMode()`                                            | `true` → use the recovery exit ([E](#e-v2-recovery-mode-exit-any-pool-type-required-for-linear-and-stablephantom)). Pools from 2021/early 2022 lack the function → they have **no recovery mode at all**, only their standard exits. |
| v2      | `pool.getPausedState()` → `paused`                                 | `true` and not in recovery mode → **no exit path** until governance enables recovery mode. |
| v3      | `Vault.isPoolInRecoveryMode(pool)`                                 | `true` → `Router.removeLiquidityRecovery`.                                                |
| v3      | `Vault.isPoolPaused(pool)`, `Vault.isVaultPaused()`                | paused → anyone may call `Vault.enableRecoveryMode(pool)`, then recovery exit ([H](#h-v3-pools)). |

Linear and StablePhantom pools **only** exit in recovery mode (they have no proportional exit kind).
The 2022+ generations are all in recovery mode. The first generation (Ethereum, Dec 2021 to early
2022) has no recovery mode at all and therefore **no exit path**: `bb-a-USDT` `0x2BBf681c…`,
`bb-a-USDC` `0x652D486B…` / `0x9210F120…`, `bb-a-DAI` `0x804CdB91…` / `0xA3823e50…`,
`bb-a-USDT` `0xe6bCC79f…`, `bb-f-DAI` `0x8f406344…`, `bb-f-LUSD` `0xb0F75E97…`, `bb-f-FEI`
`0xc8C79fCD…`, and the StablePhantom `bb-a-USD` `0x4Fd63966…` / `0x7B507753…`, `bb-f-USD`
`0xD997f35c…`. Circulating supply is dust except `bb-a-USD` `0x7B507753…`.

**Other dead ends today** (Ethereum, as of October 2026; reads, re-check before relying on them):

- Paused and not in recovery mode, so neither exit kind works until governance enables recovery
  mode: ComposableStable `Affine Tripool` `0x402B3983…` and `syrupUSDC/sDAI` `0x48a5bFB5…`.
- 13 Gyroscope **GYD E-CLPs** (e.g. `ECLP-GYD-sUSDS` `0xc8398FEE…`) report `getPausedState().paused`
  and have no `inRecoveryMode()`; their pause windows run to 2033-2036. Pause and token are
  Gyroscope's, not Balancer governance's.

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

**Same address on every chain where that version is deployed** (v2: not on HyperEVM, Monad,
Plasma, X Layer; v3: not on Polygon, zkEVM, Mode, Fraxtal)

| Contract                | Address                                      |
| ----------------------- | -------------------------------------------- |
| v2 Vault                | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` |
| v3 Vault                | `0xbA1333333333a1BA1108E8412f11850A5C319bA9` |
| Multicall3              | `0xcA11bde05977b3631167028862bE2a173976CA11` |

**Ethereum only**

| Contract                | Address                                      |
| ----------------------- | -------------------------------------------- |
| v1 BFactory             | `0x9424B1412450D0f8Fc2255FAf6046b98213B76Bd` |
| v1 CRPFactory           | `0xed52D8E202401645eDAD1c0AA21e872498ce47D0` |
| BalancerMinter (BAL emissions for Ethereum gauges) | `0x239e55F427D44C3cc793f49bFB507ebe76638a2b` |

**Per chain.** The v3 Router is Router v2 (`20250307-v3-router-v2`); the older Router v1 still
works but is superseded. The L2BalancerPseudoMinter pays BAL for `ChildChainGauge` stakes
(recipe A); the gauge also reports it via `bal_pseudo_minter()`.

| Chain         | v2 BalancerQueries                           | v3 Router                                    | L2BalancerPseudoMinter                       |
| ------------- | -------------------------------------------- | -------------------------------------------- | -------------------------------------------- |
| Ethereum      | `0xe39b5e3b6d74016b2f6a9673d7d7493b6df549d5` | `0xAE563E3f8219521950555F5962419C8919758Ea2` | – (BalancerMinter above)                     |
| Arbitrum      | `0xe39b5e3b6d74016b2f6a9673d7d7493b6df549d5` | `0xEAedc32a51c510d35ebC11088fD5fF2b47aACF2E` | `0xc3ccacE87f6d3A81724075ADcb5ddd85a8A1bB68` |
| Avalanche     | `0xC128468b7Ce63eA702C1f104D55A2566b13D3ABD` | `0xf39ca6ede9bf7820a952b52f3c94af526bab9015` | `0x85a80afee867aDf27B50BdB7b76DA70f1E853062` |
| Base          | `0x300ab2038eac391f26d9f895dc61f8f66a548833` | `0x3f170631ed9821Ca51A59D996aB095162438DC10` | `0x0c5538098EBe88175078972F514C9e101D325D4F` |
| Fraxtal       | `0x4132f7acc9db7a6cf7be2dd3a9dc8b30c7e6e6c8` | –                                            | `0x9805dcfD25e6De36bad8fe9D3Fe2c9b44B764102` |
| Gnosis        | `0x0f3e0c4218b7b0108a3643cfe9d3ec0d4f57c54e` | `0x4eff2d77D9fFbAeFB4b141A3e494c085b3FF4Cb5` | `0xA8920455934Da4D853faac1f94Fe7bEf72943eF1` |
| HyperEVM      | –                                            | `0xa8920455934da4d853faac1f94fe7bef72943ef1` | –                                            |
| Mode          | `0x36cac20dd805d128c1a6dd16eea845c574b5a17c` | –                                            | `0x5cF4928a3205728bd12830E1840F7DB85c62a4B9` |
| Monad         | –                                            | `0x9da18982a33fd0c7051b19f0d7c76f2d5e7e017c` | –                                            |
| Optimism      | `0xe39b5e3b6d74016b2f6a9673d7d7493b6df549d5` | `0xe2fa4e1d17725e72dcdafe943ecf45df4b9e285b` | `0x4fb47126Fa83A8734991E41B942Ac29A3266C968` |
| Plasma        | –                                            | `0x9da18982a33fd0c7051b19f0d7c76f2d5e7e017c` | –                                            |
| Polygon       | `0xe39b5e3b6d74016b2f6a9673d7d7493b6df549d5` | –                                            | `0x47B489bf5836f83ABD928C316F8e39bC0587B020` |
| Polygon zkEVM | `0x809b79b53f18e9bc08a961ed4678b901ac93213a` | –                                            | `0x475D18169BE8a89357A9ee3Ab00ca386d20fA229` |
| X Layer       | –                                            | `0xc3ccace87f6d3a81724075adcb5ddd85a8a1bb68` | –                                            |

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

**Foundry scripts (Solidity).** Each recipe has a `forge script` example. Inside
`vm.startBroadcast()` every external call the script makes is sent as a transaction **from your
address** (`--sender $YOU` plus `--ledger` / `--private-key`), so the Vault, gauge or router sees
you as `msg.sender` exactly as with the explorer. Do not wrap these calls in a helper contract: the
Vault would then see the helper as the sender (`BAL#401`), a gauge would withdraw the helper's
(empty) balance, and the exit tokens would end up inside the helper. Setup:

```bash
forge init exit && cd exit && rm -rf src test script && mkdir script     # forge-std is installed by forge init
# save the recipe's script as script/<Name>.s.sol, then:
forge script script/<Name>.s.sol --sig "run(...)" <args> --rpc-url $RPC --sender $YOU            # dry run
forge script script/<Name>.s.sol --sig "run(...)" <args> --rpc-url $RPC --sender $YOU --ledger --broadcast
```

**viem** (`npm i viem`) is what the UI uses; all ABIs are in [`src/abis`](src/abis) and the call
sequences in [`src/lib`](src/lib). Any snippet there can be copied into a script.

**Slippage:** `min = expected − expected × 1 %` = `expected × 99 / 100` (integer math). Set the
pre-minted-BPT slot (if any) to `0`.

---

## Part 4: Exit recipes by pool type

### A. Gauges: unstake and claim

Unstaking returns the BPT to your wallet; it does **not** exit the pool. There are three gauge
types with two different `withdraw` signatures. Tell them apart with one read:
`bal_pseudo_minter()` answers only on `ChildChainGauge`.

| Gauge type (explorer name)                 | Where                        | Unstake                          | Reward tokens                       | BAL emissions                                   |
| ------------------------------------------ | ---------------------------- | -------------------------------- | ----------------------------------- | ----------------------------------------------- |
| `LiquidityGaugeV5`                         | Ethereum                     | `withdraw(uint256,bool)`         | `withdraw(amount, true)` claims     | `BalancerMinter.mint(gauge)`                    |
| `RewardsOnlyGauge` (first L2 factory, 2022) | Arbitrum, Polygon, Optimism, Gnosis | `withdraw(uint256,bool)` | `withdraw(amount, true)` claims, BAL is one of them | – (it is a reward token)          |
| `ChildChainGauge` (`version()` = 2, 2023+) | all L2s                      | **`withdraw(uint256)`** only     | `claim_rewards(you)`, separate call | `L2BalancerPseudoMinter.mint(gauge)` (Part 2, or `bal_pseudo_minter()`) |

`ChildChainGauge.withdraw` has no claim flag: its optional second argument is `_user`, so
`withdraw(uint256,bool)` **reverts** there. BAL is not in its `reward_tokens` list either
(`add_reward` forbids it); the gauge only accrues `claimable_tokens(you)` and the pseudo-minter pays
it. Claims can be made before or after unstaking; unstaking does not forfeit accrued rewards or BAL.

```
balanceOf(address), lp_token()                         // all types
withdraw(uint256 _value, bool _claim_rewards)          // LiquidityGaugeV5, RewardsOnlyGauge
withdraw(uint256 _value)                               // ChildChainGauge
claim_rewards(address _addr)                           // reward tokens (all types)
reward_count(), reward_tokens(uint256), claimable_reward(address,address)   // RewardsOnlyGauge has no reward_count(); its reward_tokens(i) has 8 slots, read until the zero address
claimable_tokens(address), bal_pseudo_minter()         // ChildChainGauge (claimable_tokens also on LiquidityGaugeV5)
Minter.mint(address gauge)                             // BalancerMinter (Ethereum) / L2BalancerPseudoMinter
```

**Explorer:** gauge → Read Contract → `balanceOf(you)`, `lp_token()` (must be your BPT),
`bal_pseudo_minter()` (present → `ChildChainGauge`). Then Write Contract:

- `LiquidityGaugeV5` / `RewardsOnlyGauge`: `withdraw(_value = balance, _claim_rewards = true)`.
  Ethereum: BalancerMinter → `mint(gauge)` for BAL.
- `ChildChainGauge`: `claim_rewards(you)` (if `claimable_reward` > 0), pseudo-minter →
  `mint(gauge)` (if `claimable_tokens(you)` > 0), then `withdraw(_value = balance)`.

**cast**

```bash
cast call $GAUGE "balanceOf(address)(uint256)" $YOU --rpc-url $RPC
cast call $GAUGE "lp_token()(address)" --rpc-url $RPC
cast call $GAUGE "bal_pseudo_minter()(address)" --rpc-url $RPC          # reverts -> V5 / RewardsOnly; address -> ChildChainGauge
# LiquidityGaugeV5 / RewardsOnlyGauge
cast send $GAUGE "withdraw(uint256,bool)" <balance> true --rpc-url $RPC --ledger
cast send 0x239e55F427D44C3cc793f49bFB507ebe76638a2b "mint(address)" $GAUGE --rpc-url $RPC --ledger   # Ethereum only
# ChildChainGauge
cast send $GAUGE "claim_rewards(address)" $YOU --rpc-url $RPC --ledger
cast send $PSEUDO_MINTER "mint(address)" $GAUGE --rpc-url $RPC --ledger
cast send $GAUGE "withdraw(uint256)" <balance> --rpc-url $RPC --ledger
```

**Foundry script** (see Part 3 for setup; `--sig "run(address)" $GAUGE`)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import "forge-std/Script.sol";

interface IGauge {
    function balanceOf(address) external view returns (uint256);
    function withdraw(uint256 _value, bool _claim_rewards) external; // LiquidityGaugeV5, RewardsOnlyGauge
    function withdraw(uint256 _value) external;                      // ChildChainGauge (L2, 2023+)
    function claim_rewards(address _addr) external;
}

interface IBalMinter {
    function mint(address gauge) external returns (uint256);         // BalancerMinter / L2BalancerPseudoMinter
}

// forge script Unstake.s.sol --sig "run(address)" $GAUGE --rpc-url $RPC --sender $YOU --ledger --broadcast
contract Unstake is Script {
    address constant BALANCER_MINTER = 0x239e55F427D44C3cc793f49bFB507ebe76638a2b; // Ethereum

    function run(address gauge) external {
        vm.startBroadcast(); // every call below is sent as a transaction from --sender
        uint256 staked = IGauge(gauge).balanceOf(msg.sender);
        (bool isChildChain, bytes memory minter) = gauge.staticcall(abi.encodeWithSignature("bal_pseudo_minter()"));
        if (isChildChain) {
            // ChildChainGauge: withdraw has no claim flag, BAL comes from the pseudo-minter
            IGauge(gauge).claim_rewards(msg.sender);
            IBalMinter(abi.decode(minter, (address))).mint(gauge);
            IGauge(gauge).withdraw(staked);
        } else {
            IGauge(gauge).withdraw(staked, true); // also pays reward tokens (BAL included on RewardsOnlyGauge)
            if (block.chainid == 1) IBalMinter(BALANCER_MINTER).mint(gauge);
        }
        vm.stopBroadcast();
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

`BPool.exitPool` keeps at least `MIN_BALANCE = 1e6` wei of every token in the pool. If you hold
(almost) the whole supply, a 100 % exit reverts with `ERR_MIN_BALANCE`: exit a bit less (e.g. 99 %,
or half, then the rest minus dust) so each token balance stays above `1e6` wei.

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

**Foundry script** (`--sig "run(address,uint256)" $POOL 100`; 100 bps = 1 % slippage)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import "forge-std/Script.sol";

interface IBPool {
    function balanceOf(address) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function getCurrentTokens() external view returns (address[] memory);
    function getBalance(address token) external view returns (uint256);
    function exitPool(uint256 poolAmountIn, uint256[] calldata minAmountsOut) external;
}

// forge script V1Exit.s.sol --sig "run(address,uint256)" $POOL 100 --rpc-url $RPC --sender $YOU --ledger --broadcast
contract V1Exit is Script {
    /// @param pool BPool or ConfigurableRightsPool (the share token you hold)
    /// @param slippageBps 100 = 1 %
    function run(address pool, uint256 slippageBps) external {
        vm.startBroadcast();
        uint256 bptIn = IBPool(pool).balanceOf(msg.sender);
        uint256 supply = IBPool(pool).totalSupply();

        // smart pools (CRP) hold their tokens in a backing BPool and round differently
        (bool isCrp, bytes memory data) = pool.staticcall(abi.encodeWithSignature("bPool()"));
        IBPool backing = isCrp ? IBPool(abi.decode(data, (address))) : IBPool(pool);

        address[] memory tokens = backing.getCurrentTokens();
        uint256[] memory mins = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; i++) {
            uint256 expected = isCrp
                ? (backing.getBalance(tokens[i]) - 1) * bptIn / (supply + 1)
                : backing.getBalance(tokens[i]) * bptIn / supply;
            mins[i] = expected * (10_000 - slippageBps) / 10_000;
        }
        IBPool(pool).exitPool(bptIn, mins);
        vm.stopBroadcast();
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

**Expected amounts:** simulate with `BalancerQueries.queryExit(poolId, you, you, request)` →
`(bptIn, amountsOut[])`; this is what the pool will actually pay. The formula
`amount_i = balance_i × bptIn / totalSupply` (`balances` from `Vault.getPoolTokens(poolId)`,
`totalSupply()` from the pool) is exact on most pools but **too high** on some, so use it only when
the query is unavailable, and lower it on `BAL#505` (`EXIT_BELOW_MIN`):

- Weighted pools from the first factory (2021) and `InvestmentPool`s settle accrued protocol fees in
  one token on exit; that token can pay several percent less than the formula.
- ManagedPool v2 pre-mints its BPT: use `getActualSupply()` instead of `totalSupply()` (same as
  recipe D).

**A paused token blocks the whole exit.** If one pool token's own contract rejects transfers (e.g.
`ERC20Pausable: token transfer while paused`), exit with `toInternalBalance = true`: the Vault then
credits all tokens to your internal balance without transferring. Afterwards withdraw each working
token with `Vault.manageUserBalance([(kind = 1 /* WITHDRAW_INTERNAL */, token, amount, you, you)])`;
the stuck token stays in your internal balance until it unpauses.

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

**Foundry script** (`--sig "run(address,uint256,uint256)" $POOL 1 100`: pool, exit kind, slippage
bps). One script covers recipes C, D (kind `2`) and E (kind `255`); the FX and Element variants
in F and G share its `V2Base`.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import "forge-std/Script.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

interface IVaultV2 {
    struct ExitPoolRequest { address[] assets; uint256[] minAmountsOut; bytes userData; bool toInternalBalance; }
    function getPoolTokens(bytes32 poolId) external view returns (address[] memory tokens, uint256[] memory balances, uint256 lastChangeBlock);
    function exitPool(bytes32 poolId, address sender, address payable recipient, ExitPoolRequest calldata request) external;
}

interface IPoolV2 {
    function getPoolId() external view returns (bytes32);
    function derivatives(uint256) external view returns (address);                      // FX
    function viewWithdraw(uint256 tokensToBurn) external view returns (uint256[] memory); // FX, derivatives order
    function bond() external view returns (address);                                     // Element
}

interface ITranche {
    function withdrawPrincipal(uint256 amount, address destination) external returns (uint256);
}

abstract contract V2Base is Script {
    IVaultV2 constant VAULT = IVaultV2(0xBA12222222228d8Ba445958a75a0704d566BF2C8);

    function exit(address pool, address[] memory tokens, uint256[] memory mins, bytes memory userData) internal {
        VAULT.exitPool(IPoolV2(pool).getPoolId(), msg.sender, payable(msg.sender),
            IVaultV2.ExitPoolRequest({ assets: tokens, minAmountsOut: mins, userData: userData, toInternalBalance: false }));
    }
}

// Recipes C, D, E.
// forge script V2Exit.s.sol:V2Exit --sig "run(address,uint256,uint256)" $POOL 1 100 --rpc-url $RPC --sender $YOU --ledger --broadcast
contract V2Exit is V2Base {
    /// @param kind 1 = Weighted/Stable/MetaStable/LBP/Managed/Gyro, 2 = ComposableStable, 255 = recovery mode
    /// @param slippageBps 100 = 1 %. The minimums come from the formula: on BAL#505 lower them (or use queryExit).
    function run(address pool, uint256 kind, uint256 slippageBps) external {
        vm.startBroadcast();
        (address[] memory tokens, uint256[] memory balances, ) = VAULT.getPoolTokens(IPoolV2(pool).getPoolId());
        uint256 bptIn = IERC20(pool).balanceOf(msg.sender);
        uint256 supply = circulatingSupply(pool, tokens, balances, kind);

        uint256[] memory mins = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; i++) {
            if (tokens[i] == pool) continue; // pre-minted BPT slot stays 0
            mins[i] = balances[i] * bptIn / supply * (10_000 - slippageBps) / 10_000;
        }
        exit(pool, tokens, mins, abi.encode(kind, bptIn));
        vm.stopBroadcast();
    }

    /// Pools that hold their own BPT (ComposableStable, ManagedPool v2) pay out of the circulating supply:
    /// getActualSupply() for normal exits, totalSupply minus the pre-minted BPT for recovery exits.
    function circulatingSupply(address pool, address[] memory tokens, uint256[] memory balances, uint256 kind)
        internal view returns (uint256 supply)
    {
        if (kind != 255) {
            (bool ok, bytes memory data) = pool.staticcall(abi.encodeWithSignature("getActualSupply()"));
            if (ok) return abi.decode(data, (uint256));
        }
        supply = IERC20(pool).totalSupply();
        for (uint256 i; i < tokens.length; i++) if (tokens[i] == pool) supply -= balances[i];
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

Everything else (explorer steps, cast) is identical to C with `1` → `2` and
`totalSupply()` → `getActualSupply()`; the Foundry script in C takes `kind = 2`. If the pool is in
recovery mode, recipe E applies and uses kind 255 instead.

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

**Expected amounts.** `BalancerQueries.queryExit` **never** works for kind 255 (it runs the pool's
normal exit hook, which does not know the recovery kind; it reverts with `BAL#001`, `BAL#998`,
"Not implemented" or the pause error), so compute by hand. The formula is exact:

```
virtualSupply = totalSupply − balances[bptIndex]     (if the pool holds its own BPT; else totalSupply)
amount_i      = balances[i] × bptIn / virtualSupply  (0 for the BPT slot)
```

`balances` from `Vault.getPoolTokens(poolId)` are the "cash" balances the recovery exit pays from.
To dry-run the real call: `cast call $VAULT "exitPool(...)" ... --from $YOU` as in recipe F.

Explorer / cast: same as C with exitKind `255` and the formula above. Foundry: the script in C with
`kind = 255`.

Nested/boosted pools (e.g. `bb-a-USD`) pay out the inner **linear-pool BPTs**. Those are new
positions: repeat recipe E on each inner pool (they are all in recovery mode) to get the underlying.
Linear pools in turn pay a **wrapped** token (e.g. Aave `waUSDC` / static aTokens, Euler `eUSDC`,
ERC-4626 vault shares) next to the main token; unwrap it on the wrapper's own contract (ERC-4626:
`redeem(shares, you, you)`; Aave static aTokens: `withdraw(you, amount, true)`; check the wrapper's
*Write Contract* tab).

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

**Foundry script** (append to the `V2Exit.s.sol` file from recipe C; `--sig "run(address,uint256)" $POOL 100`)

```solidity
// Recipe F. forge script V2Exit.s.sol:FxExit --sig "run(address,uint256)" $POOL 100 ...
contract FxExit is V2Base {
    function run(address pool, uint256 slippageBps) external {
        vm.startBroadcast();
        (address[] memory tokens, , ) = VAULT.getPoolTokens(IPoolV2(pool).getPoolId());
        uint256 bptIn = IERC20(pool).balanceOf(msg.sender);
        uint256[] memory preview = IPoolV2(pool).viewWithdraw(bptIn); // derivatives(0), derivatives(1) order
        address d0 = IPoolV2(pool).derivatives(0);

        uint256[] memory mins = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; i++) {
            uint256 expected = tokens[i] == d0 ? preview[0] : preview[1];
            mins[i] = expected * (10_000 - slippageBps) / 10_000;
        }
        exit(pool, tokens, mins, abi.encode(bptIn, tokens)); // FX: (bptIn, assets), NOT (exitKind, bptIn)
        vm.stopBroadcast();
    }
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
- **Ask for ~99 % of your share, not 100 %.** The pool's rounding computes slightly more BPT than
  the proportional amounts are worth; with a large share (tens of percent of the supply) a 100 %
  request reverts with `BAL#406` (`INSUFFICIENT_BALANCE`). Lower the request on `BAL#406` (99 %,
  then 95 %) and accept ~1 % of BPT left as dust.
- `minAmountsOut` can equal `amountsOut` (the pool pays exactly what the userData asks or reverts).
- No `queryExit` support: dry-run with `cast call --from $YOU` before sending.
- Curve-based Element pools (`…Curve…` in the symbol) pay a **Curve LP token** as the underlying
  (e.g. `ePyvCurve-MIM` → `MIM-3LP3CRV-f`), which then needs a Curve exit.

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

**Foundry script** (append to the `V2Exit.s.sol` file from recipe C; `--sig "run(address,uint256)" $POOL 99`)

```solidity
// Recipe G. forge script V2Exit.s.sol:ElementExit --sig "run(address,uint256)" $POOL 99 ...
contract ElementExit is V2Base {
    /// @param pct share of your BPT to burn, e.g. 99. Asking for 100 reverts with BAL#406 for large holders.
    function run(address pool, uint256 pct) external {
        vm.startBroadcast();
        (address[] memory tokens, uint256[] memory balances, ) = VAULT.getPoolTokens(IPoolV2(pool).getPoolId());
        uint256 bptIn = IERC20(pool).balanceOf(msg.sender) * pct / 100;
        uint256 supply = IERC20(pool).totalSupply();

        uint256[] memory amounts = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; i++) amounts[i] = balances[i] * bptIn / supply;
        // the pool burns the BPT matching `amounts` from recipient (= msg.sender)
        exit(pool, tokens, amounts, abi.encode(amounts));

        // redeem the principal token (ePyv...) 1:1 for its underlying
        address bond = IPoolV2(pool).bond();
        ITranche(bond).withdrawPrincipal(IERC20(bond).balanceOf(msg.sender), msg.sender);
        vm.stopBroadcast();
    }
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
Router.removeLiquidityRecovery(address pool, uint256 exactBptAmountIn, uint256[] minAmountsOut) → amountsOut            // pool in recovery mode
Router.queryRemoveLiquidityProportional(address pool, uint256 exactBptAmountIn, address sender, bytes userData) → amountsOut   // eth_call only
Router.queryRemoveLiquidityRecovery(address pool, uint256 exactBptAmountIn) → amountsOut                                // eth_call only
Vault.getPoolTokens(pool), Vault.isPoolInRecoveryMode(pool), Vault.isPoolPaused(pool), Vault.isVaultPaused()
Vault.enableRecoveryMode(pool)   // permissionless while the pool or the Vault is paused
```

Token order = `Vault.getPoolTokens(pool)`. `wethIsEth = false` pays WETH. `userData = 0x`. The
query's `sender` is only passed to pool hooks; the zero address is fine. Both deployed routers
(v1 and v2) have exactly these signatures.

**Which call?**

| State                                     | Call                                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| normal                                    | `removeLiquidityProportional`                                                          |
| `isPoolInRecoveryMode == true`            | `removeLiquidityRecovery`                                                              |
| paused and not in recovery mode           | `Vault.enableRecoveryMode(pool)` (anyone), then `removeLiquidityRecovery`              |

**Expected amounts:** v3 queries must be `eth_call`ed with `from = 0x000…000`, or compute
`amount_i = balance_i × bptIn / totalSupply()` from `Vault.getPoolTokenInfo(pool)` balances.

**Boosted pools pay wrapped tokens.** Aave-boosted v3 pools (e.g. `waEthUSDT`, `waEthUSDC`) pay
the ERC-4626 wrapper, not the underlying. Unwrap on the wrapper: `redeem(shares, you, you)`
(works even while the Balancer Vault is paused).

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
cast call $ROUTER "queryRemoveLiquidityProportional(address,uint256,address,bytes)(uint256[])" $POOL $BPT_IN 0x0000000000000000000000000000000000000000 0x \
  --from 0x0000000000000000000000000000000000000000 --rpc-url $RPC
cast call $ROUTER "queryRemoveLiquidityRecovery(address,uint256)(uint256[])" $POOL $BPT_IN \
  --from 0x0000000000000000000000000000000000000000 --rpc-url $RPC                        # recovery mode
# approve + exit
cast send $POOL   "approve(address,uint256)" $ROUTER $BPT_IN --rpc-url $RPC --ledger
cast send $ROUTER "removeLiquidityProportional(address,uint256,uint256[],bool,bytes)" \
  $POOL $BPT_IN "[$MIN0,$MIN1]" false 0x --rpc-url $RPC --ledger
# recovery variants
cast send $VAULT3 "enableRecoveryMode(address)" $POOL --rpc-url $RPC --ledger        # only if paused
cast send $ROUTER "removeLiquidityRecovery(address,uint256,uint256[])" $POOL $BPT_IN "[$MIN0,$MIN1]" --rpc-url $RPC --ledger
```

**Foundry script** (`--sig "run(address,address,uint256)" $ROUTER $POOL 100`)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import "forge-std/Script.sol";

interface IERC20 {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

interface IVaultV3 {
    struct TokenInfo { uint8 tokenType; address rateProvider; bool paysYieldFees; }
    function getPoolTokenInfo(address pool) external view returns (address[] memory tokens, TokenInfo[] memory tokenInfo, uint256[] memory balancesRaw, uint256[] memory lastBalancesLiveScaled18);
    function isPoolInRecoveryMode(address pool) external view returns (bool);
    function isPoolPaused(address pool) external view returns (bool);
    function isVaultPaused() external view returns (bool);
    function enableRecoveryMode(address pool) external;
}

interface IRouterV3 {
    function removeLiquidityProportional(address pool, uint256 exactBptAmountIn, uint256[] memory minAmountsOut, bool wethIsEth, bytes memory userData) external payable returns (uint256[] memory);
    function removeLiquidityRecovery(address pool, uint256 exactBptAmountIn, uint256[] memory minAmountsOut) external payable returns (uint256[] memory);
}

// forge script V3Exit.s.sol --sig "run(address,address,uint256)" $ROUTER $POOL 100 --rpc-url $RPC --sender $YOU --ledger --broadcast
contract V3Exit is Script {
    IVaultV3 constant VAULT = IVaultV3(0xbA1333333333a1BA1108E8412f11850A5C319bA9);

    function run(IRouterV3 router, address pool, uint256 slippageBps) external {
        vm.startBroadcast();
        uint256 bptIn = IERC20(pool).balanceOf(msg.sender);
        (, , uint256[] memory balances, ) = VAULT.getPoolTokenInfo(pool);
        uint256 supply = IERC20(pool).totalSupply();
        uint256[] memory mins = new uint256[](balances.length);
        for (uint256 i; i < balances.length; i++) {
            mins[i] = balances[i] * bptIn / supply * (10_000 - slippageBps) / 10_000;
        }

        IERC20(pool).approve(address(router), bptIn); // the Router pulls BPT from msg.sender

        if (VAULT.isPoolInRecoveryMode(pool)) {
            router.removeLiquidityRecovery(pool, bptIn, mins);
        } else if (VAULT.isPoolPaused(pool) || VAULT.isVaultPaused()) {
            VAULT.enableRecoveryMode(pool); // permissionless while paused
            router.removeLiquidityRecovery(pool, bptIn, mins);
        } else {
            router.removeLiquidityProportional(pool, bptIn, mins, false, "");
        }
        vm.stopBroadcast();
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

// Approval, option A: ERC-20 approve of the BPT to the Router the SDK will call (what this UI does).
// Approve `call.to`, not an address from elsewhere: the SDK targets Router v2 (Part 2), and an
// approval to a different router reverts with ERC20InsufficientAllowance.
const call = removeLiquidity.buildCall({ ...queryOutput, slippage, wethIsEth: false, userData: '0x' })
await walletClient.writeContract({
  account, address: poolState.address, abi: erc20Abi, functionName: 'approve', args: [call.to, bptBalance],
})

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
// LiquidityGaugeV5 / RewardsOnlyGauge:
await walletClient.writeContract({ account, address: gauge, abi: childChainGaugeV2Abi, functionName: 'withdraw', args: [stakedBalance, true] })
// ChildChainGauge (bal_pseudo_minter() answers): no claim flag
await walletClient.writeContract({ account, address: gauge, abi: childChainGaugeV2Abi, functionName: 'withdraw', args: [stakedBalance] })
```

and [`src/lib/v1.ts`](src/lib/v1.ts), [`src/lib/v2.ts`](src/lib/v2.ts) (`quoteCustomExit` for FX /
Element), [`src/lib/element.ts`](src/lib/element.ts) for the rest. Each exported function is a
self-contained viem call.
