/**
 * Fast build-time snapshot of Balancer pool and gauge metadata from the official API.
 * The produced files remain fully static at runtime. For direct on-chain discovery use
 * scripts/discover.mjs instead.
 *
 * Usage: node scripts/sync-api-data.mjs --chain mainnet
 *        node scripts/sync-api-data.mjs --all
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { request } from 'node:https'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DATA_DIR = join(ROOT, 'src', 'config', 'data')
const REGISTRY = JSON.parse(readFileSync(join(ROOT, 'src', 'config', 'registry.json'), 'utf8'))
const API_URL = 'https://api-v3.balancer.fi/'
const PAGE_SIZE = 10000

const API_CHAINS = {
  mainnet: 'MAINNET',
  polygon: 'POLYGON',
  arbitrum: 'ARBITRUM',
  gnosis: 'GNOSIS',
  optimism: 'OPTIMISM',
  avalanche: 'AVALANCHE',
  base: 'BASE',
  zkevm: 'ZKEVM',
  mode: 'MODE',
  fraxtal: 'FRAXTAL',
  hyperevm: 'HYPEREVM',
  plasma: 'PLASMA',
  xlayer: 'XLAYER',
  monad: 'MONAD',
  sepolia: 'SEPOLIA',
}

const API_POOL_TYPES = {
  COMPOSABLE_STABLE: 'composableStable',
  PHANTOM_STABLE: 'phantomStable',
  LIQUIDITY_BOOTSTRAPPING: 'lbp',
  INVESTMENT: 'managed',
  GYRO: 'gyro',
  GYRO3: 'gyro',
  GYROE: 'gyro',
  STABLE: 'stable',
  META_STABLE: 'stable',
  ELEMENT: 'stable',
  FX: 'stable',
  WEIGHTED: 'weighted',
  QUANT_AMM_WEIGHTED: 'weighted',
  COW_AMM: 'weighted',
}

const QUERY = `
  query Pools($first: Int!, $skip: Int!, $where: GqlPoolFilter!) {
    poolGetPools(first: $first, skip: $skip, where: $where) {
      address
      id
      factory
      name
      symbol
      type
      protocolVersion
      poolTokens { address symbol decimals index }
      staking { gauge { gaugeAddress otherGauges { gaugeAddress } } }
    }
  }
`

function arg(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : null
}

async function fetchPage(chain, versions, skip) {
  const payload = JSON.stringify({
      query: QUERY,
      variables: {
        first: PAGE_SIZE,
        skip,
        where: { chainIn: [chain], protocolVersionIn: versions },
      },
  })
  const body = await new Promise((resolve, reject) => {
    const req = request(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      },
    }, (response) => {
      let data = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { data += chunk })
      response.on('end', () => {
        if ((response.statusCode ?? 500) >= 400) {
          reject(new Error(`Balancer API returned HTTP ${response.statusCode}`))
          return
        }
        try { resolve(JSON.parse(data)) } catch (error) { reject(error) }
      })
    })
    req.on('error', reject)
    req.end(payload)
  })
  if (body.errors?.length) throw new Error(body.errors.map((error) => error.message).join('; '))
  return body.data.poolGetPools
}

async function fetchPools(chain, versions) {
  const pools = []
  while (true) {
    const page = await fetchPage(chain, versions, pools.length)
    pools.push(...page)
    process.stdout.write(`\r  fetched ${pools.length} pools`)
    if (page.length < PAGE_SIZE) break
  }
  process.stdout.write('\n')
  return pools
}

function existingV1Pools(chainKey) {
  const path = join(DATA_DIR, `${chainKey}.json`)
  if (!existsSync(path)) return []
  return JSON.parse(readFileSync(path, 'utf8')).v1Pools ?? []
}

async function syncChain(chainKey) {
  const chain = REGISTRY[chainKey]
  const apiChain = API_CHAINS[chainKey]
  if (!chain) throw new Error(`unknown chain: ${chainKey}`)
  if (!apiChain) throw new Error(`the Balancer API does not expose ${chainKey}; use scripts/discover.mjs`)

  const versions = [chain.v2 && 2, chain.v3 && 3].filter(Boolean)
  if (!versions.length) throw new Error(`no v2/v3 deployment configured for ${chainKey}`)
  console.log(`${chainKey}: syncing v${versions.join('/v')} metadata from the Balancer API`)
  const pools = await fetchPools(apiChain, versions)
  const factoryTypes = new Map(
    (chain.v2?.factories ?? []).map((factory) => [factory.address.toLowerCase(), factory.poolType])
  )

  const v2Pools = pools
    .filter((pool) => pool.protocolVersion === 2)
    .map((pool) => ({
      address: pool.address,
      poolId: pool.id,
      poolType: factoryTypes.get(pool.factory?.toLowerCase()) ?? API_POOL_TYPES[pool.type],
      symbol: pool.symbol,
      name: pool.name,
      tokens: [...pool.poolTokens]
        .sort((a, b) => a.index - b.index)
        .map((token) => ({
          address: token.address,
          symbol: token.symbol,
          decimals: token.decimals,
          isPhantomBpt: token.address.toLowerCase() === pool.address.toLowerCase(),
        })),
    }))
    .filter((pool) => pool.poolType)
  const v3Pools = pools
    .filter((pool) => pool.protocolVersion === 3)
    .map((pool) => ({
      address: pool.address,
      symbol: pool.symbol,
      name: pool.name,
      tokens: [...pool.poolTokens]
        .sort((a, b) => a.index - b.index)
        .map((token) => ({
          address: token.address,
          symbol: token.symbol,
          decimals: token.decimals,
        })),
    }))

  const gauges = new Map()
  const includedPools = new Set(
    [...v2Pools, ...v3Pools].map((pool) => pool.address.toLowerCase())
  )
  for (const pool of pools.filter((candidate) => includedPools.has(candidate.address.toLowerCase()))) {
    const gauge = pool.staking?.gauge
    for (const address of [gauge?.gaugeAddress, ...(gauge?.otherGauges ?? []).map((item) => item.gaugeAddress)]) {
      if (address) gauges.set(address.toLowerCase(), { address, lpToken: pool.address, symbol: pool.symbol })
    }
  }

  v2Pools.sort((a, b) => a.address.localeCompare(b.address))
  v3Pools.sort((a, b) => a.address.localeCompare(b.address))
  const gaugeList = [...gauges.values()].sort((a, b) => a.address.localeCompare(b.address))
  const out = {
    meta: {
      chainKey,
      scannedAtBlock: 0,
      generatedAt: new Date().toISOString(),
      source: 'balancer-api',
    },
    v1Pools: existingV1Pools(chainKey),
    v2Pools,
    v3Pools,
    gauges: gaugeList,
  }

  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(join(DATA_DIR, `${chainKey}.json`), JSON.stringify(out, null, 2) + '\n')
  console.log(`  wrote ${v2Pools.length} v2 pools, ${v3Pools.length} v3 pools, ${gaugeList.length} gauges`)
}

const selected = arg('chain')
const chainKeys = process.argv.includes('--all')
  ? Object.keys(REGISTRY).filter((key) => REGISTRY[key].enabled && API_CHAINS[key])
  : selected
    ? [selected]
    : []
if (!chainKeys.length) {
  console.error('--chain <key> or --all is required')
  process.exit(1)
}

for (const chainKey of chainKeys) await syncChain(chainKey)
