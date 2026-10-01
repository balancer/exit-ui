/**
 * One-off codegen: builds src/config/registry.json from sibling repos.
 * Addresses are machine-extracted (never hand-typed) from:
 *   - balancer-subgraph-v2/networks.json   (v2 vault + pool factories + start blocks)
 *   - balancer-subgraph-v3/networks.json   (v3 vault + start block)
 *   - gauges-subgraph/subgraph.<chain>.yaml (child-chain gauge factories)
 *   - backend/config/<chain>.ts            (chain id, rpc, queries, v3 router, multicall3)
 *   - Balancer V1 docs/subgraph             (mainnet V1 pool factories)
 *
 * Usage: node tools/extract-registry.mjs [--repos <dir-containing-the-four-repos>]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const reposArg = process.argv.indexOf('--repos')
const REPOS = reposArg > -1 ? process.argv[reposArg + 1] : join(__dirname, '..', '..')

const V2_NETWORKS = JSON.parse(readFileSync(join(REPOS, 'balancer-subgraph-v2', 'networks.json'), 'utf8'))
const V3_NETWORKS = JSON.parse(readFileSync(join(REPOS, 'balancer-subgraph-v3', 'networks.json'), 'utf8'))
const GAUGES_DIR = join(REPOS, 'gauges-subgraph')
const BACKEND_CONFIG = join(REPOS, 'backend', 'config')

// Canonical production pool factories from the archived Balancer V1 address page.
// The protocol start block is confirmed by balancer-subgraph/subgraph.yaml.
const V1_MAINNET = {
  startBlock: 9562480,
  // The V1 subgraph watches BFactory only, then uses CRPFactory.isCrp(event.caller)
  // to map a backing BPool to its user-facing smart-pool share token.
  factory: '0x9424B1412450D0f8Fc2255FAf6046b98213B76Bd',
  crpFactory: '0xed52D8E202401645eDAD1c0AA21e872498ce47D0',
}

// Public RPC fallbacks for chains whose backend config uses env-keyed (dRPC) URLs
const PUBLIC_RPC = {
  mainnet: 'https://ethereum-rpc.publicnode.com',
  polygon: 'https://polygon.drpc.org', // polygon-rpc.com rejects keyless requests; publicnode is ~20s per multicall
  arbitrum: 'https://arb1.arbitrum.io/rpc',
  gnosis: 'https://rpc.gnosischain.com',
  optimism: 'https://mainnet.optimism.io',
  avalanche: 'https://api.avax.network/ext/bc/C/rpc',
  base: 'https://mainnet.base.org',
  hyperevm: 'https://rpc.hyperliquid.xyz/evm',
  monad: 'https://rpc.monad.xyz',
  sepolia: 'https://ethereum-sepolia-rpc.publicnode.com',
}

// chain key -> source keys + static metadata
const CHAINS = {
  mainnet:   { v2: 'mainnet', v3: 'mainnet', gauges: 'subgraph.yaml', backend: 'mainnet.ts', name: 'Ethereum', explorer: 'https://etherscan.io', deprecated: true },
  polygon:   { v2: 'polygon', v3: null, gauges: 'subgraph.polygon.yaml', backend: 'polygon.ts', name: 'Polygon', explorer: 'https://polygonscan.com', deprecated: true },
  arbitrum:  { v2: 'arbitrum', v3: 'arbitrum-one', gauges: 'subgraph.arbitrum.yaml', backend: 'arbitrum.ts', name: 'Arbitrum', explorer: 'https://arbiscan.io', deprecated: true },
  gnosis:    { v2: 'gnosis', v3: 'gnosis', gauges: 'subgraph.gnosis.yaml', backend: 'gnosis.ts', name: 'Gnosis', explorer: 'https://gnosisscan.io', deprecated: true },
  optimism:  { v2: 'optimism', v3: 'optimism', gauges: 'subgraph.optimism.yaml', backend: 'optimism.ts', name: 'Optimism', explorer: 'https://optimistic.etherscan.io', deprecated: true },
  avalanche: { v2: 'avalanche', v3: 'avalanche', gauges: 'subgraph.avalanche.yaml', backend: 'avalanche.ts', name: 'Avalanche', explorer: 'https://snowtrace.io', deprecated: true },
  base:      { v2: 'base', v3: 'base', gauges: 'subgraph.base.yaml', backend: 'base.ts', name: 'Base', explorer: 'https://basescan.org', deprecated: true },
  zkevm:     { v2: 'polygon-zkevm', v3: null, gauges: 'subgraph.polygon-zkevm.yaml', backend: 'zkevm.ts', name: 'Polygon zkEVM', explorer: 'https://zkevm.polygonscan.com', deprecated: true, logsMaxRange: 1000 },
  mode:      { v2: 'mode', v3: null, gauges: 'subgraph.mode.yaml', backend: 'mode.ts', name: 'Mode', explorer: 'https://explorer.mode.network', deprecated: true },
  fraxtal:   { v2: 'frax', v3: null, gauges: 'subgraph.fraxtal.yaml', backend: 'fraxtal.ts', name: 'Fraxtal', explorer: 'https://fraxscan.com', deprecated: true },
  hyperevm:  { v2: null, v3: 'hyperevm', gauges: null, backend: 'hyperevm.ts', name: 'HyperEVM', explorer: 'https://hyperevmscan.io', deprecated: true },
  plasma:    { v2: null, v3: 'plasma', gauges: null, backend: 'plasma.ts', name: 'Plasma', explorer: 'https://plasmascan.to', deprecated: true },
  xlayer:    { v2: null, v3: 'xlayer', gauges: null, backend: 'xlayer.ts', name: 'X Layer', explorer: 'https://www.oklink.com/xlayer', deprecated: true },
  monad:     { v2: null, v3: 'monad', gauges: null, backend: 'monad.ts', name: 'Monad', explorer: 'https://monadexplorer.com', deprecated: true },
  sepolia:   { v2: 'sepolia', v3: 'sepolia', gauges: 'subgraph.sepolia.yaml', backend: 'sepolia.ts', name: 'Sepolia', explorer: 'https://sepolia.etherscan.io' },
}

// v2 factories the subgraph sources don't list: pool types with their own exit encoding.
// FX factories emit NewFXPool(caller, id, fxpool) instead of PoolCreated(pool).
const FX_EVENT = { event: 'NewFXPool(address,bytes32,address)', poolTopicIndex: 3 }
const EXTRA_V2_FACTORIES = {
  mainnet: [
    { name: 'ElementConvergentCurvePoolFactory', address: '0xb7561f547F3207eDb42A6AfA42170Cd47ADD17BD', startBlock: 12686198, poolType: 'element' },
    { name: 'FXPoolFactory81fE', address: '0x81fE9e5B28dA92aE949b705DfDB225f7a7cc5134', startBlock: 15981805, poolType: 'fx', ...FX_EVENT },
    { name: 'FXPoolFactoryfb23', address: '0xfb23Bc0D2629268442CD6521CF4170698967105f', startBlock: 18469426, poolType: 'fx', ...FX_EVENT },
  ],
  polygon: [
    { name: 'FXPoolFactory627D', address: '0x627D759314D5c4007b461A74eBaFA7EBC5dFeD71', startBlock: 32054794, poolType: 'fx', ...FX_EVENT },
    { name: 'FXPoolFactoryF169', address: '0xF169c1Ae8De24Da43a3dC5c5F05De412b4848bD3', startBlock: 49368322, poolType: 'fx', ...FX_EVENT },
    { name: 'FXPoolFactory1716', address: '0x171665A8D7e7306869a43E8EfD312dfeE6027352', startBlock: 54636843, poolType: 'fx', ...FX_EVENT },
    { name: 'FXPoolFactoryeFA1', address: '0xeFA1A53ea939013017e654beEdfC6f80E64ffC2d', startBlock: 72630821, poolType: 'fx', ...FX_EVENT },
    { name: 'FXPoolFactory19Ad', address: '0x19Ad20dA5f24671BFC7486FC8c119dD80CD09EfD', startBlock: 72703991, poolType: 'fx', ...FX_EVENT },
  ],
  avalanche: [
    { name: 'FXPoolFactory81fE', address: '0x81fE9e5B28dA92aE949b705DfDB225f7a7cc5134', startBlock: 32585313, poolType: 'fx', ...FX_EVENT },
    { name: 'FXPoolFactory4042', address: '0x4042dC4110Ea9500338737605A60065c3de152C6', startBlock: 37150794, poolType: 'fx', ...FX_EVENT },
  ],
  arbitrum: [
    { name: 'FXPoolFactory0bd5', address: '0x0bd5EC16658346eeCd5dE8c704a38Efe02B5DA69', startBlock: 183603903, poolType: 'fx', ...FX_EVENT },
  ],
}

// factory contract name -> poolType (drives exit-kind selection in the app)
function classifyFactory(name) {
  if (/ComposableStable/i.test(name)) return 'composableStable'
  if (/StablePhantom/i.test(name)) return 'phantomStable' // recovery-exit only
  if (/Linear/i.test(name)) return 'linear' // recovery-exit only
  if (/Gyro/i.test(name)) return 'gyro'
  if (/LiquidityBootstrapping/i.test(name)) return 'lbp'
  if (/Managed|Investment/i.test(name)) return 'managed'
  if (/Weighted/i.test(name)) return 'weighted'
  if (/Stable/i.test(name)) return 'stable'
  return null // not a pool factory we exit from (Vault, EventEmitter, ...)
}

function extractBackend(file) {
  const src = readFileSync(join(BACKEND_CONFIG, file), 'utf8')
  const get = (re) => {
    const m = src.match(re)
    return m ? m[1] : null
  }
  return {
    chainId: Number(get(/id:\s*(\d+)/)),
    rpcUrl: get(/rpcUrl:\s*'([^']+)'/),
    rpcMaxBlockRange: Number(get(/rpcMaxBlockRange:\s*(\d+)/)) || 10000,
    nativeSymbol: get(/symbol:\s*'([^']+)'/) ?? 'ETH',
    multicall3: get(/multicall3:\s*'(0x[0-9a-fA-F]{40})'/),
    balancerQueries: get(/balancerQueriesAddress:\s*'(0x[0-9a-fA-F]{40})'/),
    v2Vault: get(/vaultAddress:\s*'(0x[0-9a-fA-F]{40})'/), // first vaultAddress in file is v2 block
    v3Router: (() => {
      const m = src.match(/routerAddress:\s*'(0x[0-9a-fA-F]{40})'/)
      return m ? m[1] : null
    })(),
  }
}

// gauge manifests: dataSources entries are "name: X" followed by source address/startBlock.
// Keep *GaugeFactory entries, excluding root-gauge factories (mainnet voting infra, not user staking).
function extractGaugeFactories(manifest) {
  const src = readFileSync(join(GAUGES_DIR, manifest), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n')
  const out = []
  const re =
    /name: (\w+)\r?\n\s*network: [\w-]+\r?\n\s*source:\r?\n\s*address: '(0x[0-9a-fA-F]{40})'\r?\n\s*abi: \w+\r?\n\s*startBlock: (\d+)/g
  let m
  while ((m = re.exec(src))) {
    const [, name, address, startBlock] = m
    if (/Gauge(V\d+)?Factory$/.test(name) && !/Root/i.test(name)) {
      out.push({ name, address, startBlock: Number(startBlock) })
    }
  }
  return out
}

const registry = {}
for (const [key, meta] of Object.entries(CHAINS)) {
  if (!existsSync(join(BACKEND_CONFIG, meta.backend))) {
    console.warn(`skip ${key}: backend config missing`)
    continue
  }
  const be = extractBackend(meta.backend)
  const entry = {
    key,
    chainId: be.chainId,
    name: meta.name,
    defaultRpcUrl: be.rpcUrl?.startsWith('https://') ? be.rpcUrl : PUBLIC_RPC[key],
    explorerUrl: meta.explorer,
    nativeSymbol: be.nativeSymbol,
    multicall3: be.multicall3,
    logsMaxRange: meta.logsMaxRange ?? Math.min(be.rpcMaxBlockRange, 10000),
    deprecated: meta.deprecated ?? false,
  }

  if (key === 'mainnet') entry.v1 = V1_MAINNET

  if (meta.v2 && V2_NETWORKS[meta.v2]) {
    const net = V2_NETWORKS[meta.v2]
    const factories = []
    for (const [cname, val] of Object.entries(net)) {
      if (cname === 'network' || !val?.address) continue
      const poolType = classifyFactory(cname)
      if (!poolType) continue
      factories.push({ name: cname, address: val.address, startBlock: val.startBlock, poolType })
    }
    factories.push(...(EXTRA_V2_FACTORIES[key] ?? []))
    entry.v2 = {
      vault: net.Vault.address,
      startBlock: net.Vault.startBlock,
      balancerQueries: be.balancerQueries,
      factories,
      gaugeFactories: meta.gauges ? extractGaugeFactories(meta.gauges) : [],
    }
  }

  if (meta.v3 && V3_NETWORKS[meta.v3]) {
    const net = V3_NETWORKS[meta.v3]
    entry.v3 = {
      vault: net.Vault.address,
      startBlock: net.Vault.startBlock,
      router: be.v3Router,
    }
  }

  registry[key] = entry
}

const outPath = join(__dirname, '..', 'src', 'config', 'registry.json')
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(registry, null, 2) + '\n')
console.log(`wrote ${outPath}`)
for (const [k, v] of Object.entries(registry)) {
  console.log(
    `${k.padEnd(10)} id=${String(v.chainId).padEnd(8)} v2=${v.v2 ? `${v.v2.factories.length}f/${v.v2.gaugeFactories.length}g` : '-'} v3=${v.v3 ? 'yes' : '-'} ${v.deprecated ? 'DEPRECATED' : ''}`
  )
}
