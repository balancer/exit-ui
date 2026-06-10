/**
 * One-off codegen: builds src/config/registry.json from sibling repos.
 * Addresses are machine-extracted (never hand-typed) from:
 *   - balancer-subgraph-v2/networks.json   (v2 vault + pool factories + start blocks)
 *   - balancer-subgraph-v3/networks.json   (v3 vault + start block)
 *   - gauges-subgraph/subgraph.<chain>.yaml (child-chain gauge factories)
 *   - backend/config/<chain>.ts            (chain id, rpc, queries, v3 router, multicall3)
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

// Public RPC fallbacks for chains whose backend config uses env-keyed (dRPC) URLs
const PUBLIC_RPC = {
  mainnet: 'https://ethereum-rpc.publicnode.com',
  polygon: 'https://polygon-rpc.com',
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
  mainnet:   { v2: 'mainnet', v3: 'mainnet', gauges: 'subgraph.yaml', backend: 'mainnet.ts', name: 'Ethereum', explorer: 'https://etherscan.io' },
  polygon:   { v2: 'polygon', v3: null, gauges: 'subgraph.polygon.yaml', backend: 'polygon.ts', name: 'Polygon', explorer: 'https://polygonscan.com' },
  arbitrum:  { v2: 'arbitrum', v3: 'arbitrum-one', gauges: 'subgraph.arbitrum.yaml', backend: 'arbitrum.ts', name: 'Arbitrum', explorer: 'https://arbiscan.io' },
  gnosis:    { v2: 'gnosis', v3: 'gnosis', gauges: 'subgraph.gnosis.yaml', backend: 'gnosis.ts', name: 'Gnosis', explorer: 'https://gnosisscan.io' },
  optimism:  { v2: 'optimism', v3: 'optimism', gauges: 'subgraph.optimism.yaml', backend: 'optimism.ts', name: 'Optimism', explorer: 'https://optimistic.etherscan.io' },
  avalanche: { v2: 'avalanche', v3: 'avalanche', gauges: 'subgraph.avalanche.yaml', backend: 'avalanche.ts', name: 'Avalanche', explorer: 'https://snowtrace.io' },
  base:      { v2: 'base', v3: 'base', gauges: 'subgraph.base.yaml', backend: 'base.ts', name: 'Base', explorer: 'https://basescan.org' },
  zkevm:     { v2: 'polygon-zkevm', v3: null, gauges: 'subgraph.polygon-zkevm.yaml', backend: 'zkevm.ts', name: 'Polygon zkEVM', explorer: 'https://zkevm.polygonscan.com', deprecated: true, logsMaxRange: 1000 },
  mode:      { v2: 'mode', v3: null, gauges: 'subgraph.mode.yaml', backend: 'mode.ts', name: 'Mode', explorer: 'https://explorer.mode.network', deprecated: true },
  fraxtal:   { v2: 'frax', v3: null, gauges: 'subgraph.fraxtal.yaml', backend: 'fraxtal.ts', name: 'Fraxtal', explorer: 'https://fraxscan.com', deprecated: true },
  hyperevm:  { v2: null, v3: 'hyperevm', gauges: null, backend: 'hyperevm.ts', name: 'HyperEVM', explorer: 'https://hyperevmscan.io' },
  plasma:    { v2: null, v3: 'plasma', gauges: null, backend: 'plasma.ts', name: 'Plasma', explorer: 'https://plasmascan.to' },
  xlayer:    { v2: null, v3: 'xlayer', gauges: null, backend: 'xlayer.ts', name: 'X Layer', explorer: 'https://www.oklink.com/xlayer' },
  monad:     { v2: null, v3: 'monad', gauges: null, backend: 'monad.ts', name: 'Monad', explorer: 'https://monadexplorer.com' },
  sepolia:   { v2: 'sepolia', v3: 'sepolia', gauges: 'subgraph.sepolia.yaml', backend: 'sepolia.ts', name: 'Sepolia', explorer: 'https://sepolia.etherscan.io' },
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

  if (meta.v2 && V2_NETWORKS[meta.v2]) {
    const net = V2_NETWORKS[meta.v2]
    const factories = []
    for (const [cname, val] of Object.entries(net)) {
      if (cname === 'network' || !val?.address) continue
      const poolType = classifyFactory(cname)
      if (!poolType) continue
      factories.push({ name: cname, address: val.address, startBlock: val.startBlock, poolType })
    }
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
