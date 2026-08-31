# Balancer Legacy Exit UI

Standalone static website for withdrawing legacy Balancer positions.
Currently enabled: Balancer **v1 on Ethereum mainnet**, plus Balancer **v2/v3** on
**Mode**, **Fraxtal**, and **Polygon zkEVM**.

- Connect an injected wallet (MetaMask, Rabby, ...) or watch any address read-only
- Optionally configure a custom RPC URL per chain (persisted in localStorage)
- Scan for pool (BPT) and gauge (staked) positions via Multicall3 against a bundled pool list
- Unstake from gauges (`withdraw(amount, claim_rewards=true)`) and claim rewards
- Proportionally exit v1 core and smart pools (`BPool.exitPool` / `CRP.exitPool`)
- Proportionally exit v2 pools (`Vault.exitPool`) and v3 pools (`Router.removeLiquidityProportional`)
- Exits are simulated first; minimum amounts = expected − slippage (default 1%).
  An opt-in **emergency mode** submits with zero minimums.
- Recovery-mode pools (incl. paused and linear pools) exit via the recovery path automatically;
  expected amounts are computed client-side (`cashBalance × bptIn / virtualSupply`) because
  `BalancerQueries.queryExit` reverts on paused pools while the real recovery exit succeeds.

The site is fully static: no backend, no subgraph — it only talks to the RPC you configure.

## Run locally

```bash
npm install
npm run dev      # http://localhost:3001
npm run build    # static output in dist/
```

Dependencies: react, react-dom, viem. That's all.

## How discovery works

Positions are scanned against per-chain pool/gauge lists committed in `src/config/data/<chain>.json`.
These lists are generated once (chains are deprecated; the lists don't change) by:

```bash
npm run discover -- --chain mode [--rpc <url>] [--to-block <n>]
```

The script enumerates:
- v1 pools: `LOG_NEW_POOL` events from the Ethereum `BFactory`. Like the official V1 subgraph,
  it classifies `event.caller` with `CRPFactory.isCrp`: a recognized caller is the user-facing
  smart-pool share token and the emitted pool is its backing BPool.
- v2 pools: `PoolCreated` events from every pool factory (from `src/config/registry.json`)
- v3 pools: `PoolRegistered` events from the v3 Vault (covers all v3 factories)
- gauges: `GaugeCreated` events from the child-chain gauge factories

and enriches everything (poolId, tokens, symbols, decimals, phantom-BPT detection) via Multicall3.
`eth_getLogs` is chunked adaptively and respects strict public RPCs (zkEVM caps at 1k blocks).

Ethereum V1 discovery can be run independently with an archive-capable RPC:

```bash
npm run discover -- --chain mainnet --protocol v1 --rpc <archive-rpc-url>
```

Pools missing from a list can always be added in the UI by pasting the pool address.

## Chain registry

`src/config/registry.json` holds config for **all** Balancer chains (Ethereum v1 factories,
v2 vault + pool factories +
gauge factories + start blocks, v3 vault + router, BalancerQueries, Multicall3, default RPC).
It is machine-generated from sibling repos — never hand-edit it; regenerate instead:

```bash
node tools/extract-registry.mjs --repos <dir containing the 4 repos below>
```

Sources: the archived Balancer V1 address docs and V1 subgraph,
`balancer-subgraph-v2/networks.json`, `balancer-subgraph-v3/networks.json`,
`gauges-subgraph/subgraph.<chain>.yaml`, `backend/config/<chain>.ts`.

## Deprecating another chain

1. Regenerate the registry if factory lists changed: `node tools/extract-registry.mjs`
2. Set `"deprecated": true` for the chain in `src/config/registry.json`
   (or mark it in `tools/extract-registry.mjs` and regenerate)
3. Run discovery: `npm run discover -- --chain <key>`
4. Smoke test the exits: `node tools/smoke-test.mjs --chain <key>`
5. Build and deploy

Chains that are not deprecated are hidden in the UI but visible in dev mode
(`npm run dev` or append `?dev=1` to the URL). Base is included as a v3 test chain.

## Verification tools

```bash
node tools/smoke-test.mjs --chain mode
```

Headless test against the live chain (no funds needed): uses each gauge contract as a pseudo-user
(gauges hold the staked BPT), simulates the exact exit calls the UI would send, and for
recovery-mode pools verifies the client-side math by simulating the real `exitPool` with
0.5%-tight minimums.

For end-to-end testing with real transactions, fork a chain with
`anvil --fork-url <rpc>`, set the UI's RPC to `http://localhost:8545`, and impersonate a holder.

## Notes / limitations

- Exits always pay out wrapped native tokens (no auto-unwrap), matching vault registration.
- V1 was deployed only on Ethereum mainnet. V1 has no gauge discovery or unstaking path here.
- V1 discovery intentionally watches only `BFactory`, matching the V1 subgraph; `CRPFactory`
  is used to classify factory-event callers and recover the smart-pool share-token address.
- No USD pricing — deprecated chains have no reliable price source; amounts are token quantities.
- Linear pools (zkEVM) can only exit while in recovery mode (they all are, post-deprecation);
  the UI blocks them otherwise instead of implementing batch swaps.
- Nested/boosted pools (e.g. bb-o-USD on zkEVM) pay out the inner BPTs (linear pool tokens).
  Rescan after exiting — the inner BPTs show up as new positions and exit via the recovery path.
- v3 exits require a one-time BPT approval to the v3 Router (plain ERC20 approve, no permit2).
- Child-chain BAL rewards are distributed as regular gauge reward tokens and are included in
  `claim_rewards`.
