/**
 * Build-time discovery: enumerates Balancer v1 pools (factory creation events),
 * v2 pools (factory PoolCreated events),
 * v3 pools (vault PoolRegistered events) and child-chain gauges (GaugeCreated events),
 * enriches them via multicall, and writes src/config/data/<chain>.json.
 *
 * Usage:
 *   node scripts/discover.mjs --chain mode [--protocol v1|v2|v3|all] [--rpc <url>] [--to-block <n>]
 *
 * All factories + the v3 vault are swept in ONE chunked eth_getLogs pass (address array +
 * topic0 array), so wall time is independent of the factory count. Chunks adapt: start
 * large, halve on RPC errors, floor at the chain's logsMaxRange (zkEVM caps at 1k blocks).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, http, toEventSelector, getAddress } from 'viem'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REGISTRY = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'config', 'registry.json'), 'utf8'))

const POOL_CREATED = toEventSelector('PoolCreated(address)')
const GAUGE_CREATED = toEventSelector('GaugeCreated(address)')
const V1_CORE_POOL_CREATED = toEventSelector('LOG_NEW_POOL(address,address)')
// v3 Vault.PoolRegistered — signature from balancer-subgraph-v3/subgraphs/v3-vault manifests
const POOL_REGISTERED = toEventSelector(
  'PoolRegistered(address,address,(address,uint8,address,bool)[],uint256,uint32,(address,address,address),(bool,bool,bool,bool,bool,bool,bool,bool,bool,bool,address),(bool,bool,bool,bool))'
)

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : fallback
}

const chainKey = arg('chain')
if (!chainKey || !REGISTRY[chainKey]) {
  console.error(`--chain required. Known: ${Object.keys(REGISTRY).join(', ')}`)
  process.exit(1)
}
const chain = REGISTRY[chainKey]
const rpcUrl = arg('rpc', chain.defaultRpcUrl)
const protocol = arg('protocol', 'all')
if (!['v1', 'v2', 'v3', 'all'].includes(protocol)) {
  console.error('--protocol must be one of: v1, v2, v3, all')
  process.exit(1)
}
const include = (version) => protocol === 'all' || protocol === version

// Discovery has its own adaptive retry/range logic; transport-level retries would make a
// rejected historical range stall several times before the script can shrink it.
const client = createPublicClient({ transport: http(rpcUrl, { timeout: 60_000, retryCount: 0 }) })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * One chunked eth_getLogs sweep over ALL sources (address array, topic0 array).
 * sources: [{ address, topic0, topicIndex, callerTopicIndex?, key }]
 */
async function sweep(sources, fromBlock, toBlock) {
  const byAddrTopic = new Map(
    sources.map((s) => [`${s.address.toLowerCase()}:${s.topic0}`, s])
  )
  const found = new Map(sources.map((s) => [s.key, []]))
  const callers = new Map()
  const addresses = sources.map((s) => s.address)
  const topics = [[...new Set(sources.map((s) => s.topic0))]]

  const floor = BigInt(chain.logsMaxRange)
  const ceiling = 1_000_000n > floor ? 1_000_000n : floor
  let chunk = ceiling
  let from = BigInt(fromBlock)
  const to = BigInt(toBlock)
  let total = 0

  while (from <= to) {
    const until = from + chunk - 1n > to ? to : from + chunk - 1n
    try {
      const logs = await client.request({
        method: 'eth_getLogs',
        params: [
          {
            address: addresses,
            topics,
            fromBlock: `0x${from.toString(16)}`,
            toBlock: `0x${until.toString(16)}`,
          },
        ],
      })
      for (const log of logs) {
        const source = byAddrTopic.get(`${log.address.toLowerCase()}:${log.topics[0]}`)
        if (source === undefined) continue
        const topic = log.topics[source.topicIndex ?? 1]
        if (!topic) continue
        const address = getAddress('0x' + topic.slice(26))
        found.get(source.key).push(address)
        if (source.callerTopicIndex !== undefined) {
          const callerTopic = log.topics[source.callerTopicIndex]
          if (callerTopic) {
            callers.set(`${source.key}:${address.toLowerCase()}`, getAddress('0x' + callerTopic.slice(26)))
          }
        }
        total++
      }
      from = until + 1n
      if (chunk < ceiling) chunk *= 2n // recover after shrink
      process.stdout.write(`\r  blocks ${from}/${to} (chunk ${chunk}) — ${total} events        `)
      await sleep(60)
    } catch (e) {
      const msg = [e.shortMessage, e.details, e.message, e.cause?.message].filter(Boolean).join(' | ')
      const isRangeError = /range|too large|too many (logs|results)|response size|exceed/i.test(msg)
      if (isRangeError && chunk > floor) {
        chunk = chunk / 2n > floor ? chunk / 2n : floor
        continue
      }
      if (/rate|429|over rate|timeout|busy|503/i.test(msg)) {
        process.stdout.write(`\r  rate limited, backing off...                    `)
        await sleep(4000)
        continue
      }
      if (chunk > floor) {
        chunk = chunk / 2n > floor ? chunk / 2n : floor
        continue
      }
      throw e
    }
  }
  process.stdout.write('\n')
  for (const [k, v] of found) found.set(k, [...new Set(v)])
  return { found, callers }
}

/** multicall with allowFailure over chunks of 100 */
async function multicall(calls) {
  const results = []
  for (let i = 0; i < calls.length; i += 100) {
    const batch = calls.slice(i, i + 100)
    results.push(
      ...(await client.multicall({
        contracts: batch,
        multicallAddress: chain.multicall3,
        allowFailure: true,
      }))
    )
    await sleep(60)
  }
  return results.map((r) => (r.status === 'success' ? r.result : null))
}

const erc20Abi = [
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
]
const erc20Bytes32Abi = [
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
]
const poolAbi = [
  { type: 'function', name: 'getPoolId', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
]
const poolV1Abi = [
  { type: 'function', name: 'getCurrentTokens', stateMutability: 'view', inputs: [], outputs: [{ type: 'address[]' }] },
]
const crpFactoryV1Abi = [
  { type: 'function', name: 'isCrp', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }] },
]
const vaultV2Abi = [
  {
    type: 'function',
    name: 'getPoolTokens',
    stateMutability: 'view',
    inputs: [{ type: 'bytes32' }],
    outputs: [{ type: 'address[]' }, { type: 'uint256[]' }, { type: 'uint256' }],
  },
]
const vaultV3Abi = [
  {
    type: 'function',
    name: 'getPoolTokens',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'address[]' }],
  },
]
const gaugeAbi = [
  { type: 'function', name: 'lp_token', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
]

const tokenMetaCache = new Map()
async function getTokenMeta(addresses) {
  const missing = [...new Set(addresses)].filter((a) => !tokenMetaCache.has(a))
  if (missing.length) {
    const symbols = await multicall(missing.map((a) => ({ address: a, abi: erc20Abi, functionName: 'symbol' })))
    const byteSymbols = await multicall(
      missing.map((a) => ({ address: a, abi: erc20Bytes32Abi, functionName: 'symbol' }))
    )
    const decimals = await multicall(missing.map((a) => ({ address: a, abi: erc20Abi, functionName: 'decimals' })))
    missing.forEach((a, i) => {
      const bytesSymbol = byteSymbols[i]
      const legacySymbol =
        typeof bytesSymbol === 'string'
          ? Buffer.from(bytesSymbol.slice(2).replace(/(?:00)+$/, ''), 'hex').toString('utf8')
          : ''
      tokenMetaCache.set(a, {
        symbol: (symbols[i] ?? legacySymbol) || a.slice(0, 8),
        decimals: decimals[i] !== null ? Number(decimals[i]) : 18,
      })
    })
  }
  return addresses.map((a) => tokenMetaCache.get(a))
}

const latestBlock = arg('to-block') ? BigInt(arg('to-block')) : await client.getBlockNumber()
console.log(`chain=${chainKey} rpc=${rpcUrl} latest=${latestBlock}`)

// Build the combined source list
const sources = []
if (include('v1') && chain.v1) {
  sources.push({
    address: chain.v1.factory,
    topic0: V1_CORE_POOL_CREATED,
    topicIndex: 2,
    callerTopicIndex: 1,
    key: 'v1:factory',
    startBlock: chain.v1.startBlock,
  })
}
if (include('v2') && chain.v2) {
  for (const f of chain.v2.factories) {
    sources.push({ address: f.address, topic0: POOL_CREATED, key: `v2:${f.name}`, startBlock: f.startBlock })
  }
  for (const gf of chain.v2.gaugeFactories) {
    sources.push({ address: gf.address, topic0: GAUGE_CREATED, key: `gauge:${gf.name}`, startBlock: gf.startBlock })
  }
}
if (include('v3') && chain.v3) {
  sources.push({ address: chain.v3.vault, topic0: POOL_REGISTERED, key: 'v3:vault', startBlock: chain.v3.startBlock })
}
if (!sources.length) {
  console.error(`No ${protocol} discovery sources configured for ${chainKey}`)
  process.exit(1)
}

const fromBlock = Math.min(...sources.map((s) => s.startBlock))
console.log(`sweeping ${sources.length} sources from block ${fromBlock}`)
const events = await sweep(sources, fromBlock, latestBlock)

const out = {
  meta: { chainKey, scannedAtBlock: Number(latestBlock), generatedAt: new Date().toISOString() },
  v1Pools: [],
  v2Pools: [],
  v3Pools: [],
  gauges: [],
}

// ---------- v1 pools ----------
if (include('v1') && chain.v1) {
  const pools = events.found.get('v1:factory') ?? []
  console.log(`v1 BFactory: ${pools.length} backing pools`)
  if (pools.length) {
    // Match the V1 subgraph: a BFactory event caller recognized by CRPFactory is the
    // user-facing share token; the event's pool remains the backing liquidity pool.
    const callers = pools.map((pool) => events.callers.get(`v1:factory:${pool.toLowerCase()}`))
    const isCrps = await multicall(
      callers.map((caller) => ({
        address: chain.v1.crpFactory,
        abi: crpFactoryV1Abi,
        functionName: 'isCrp',
        args: [caller],
      }))
    )
    const shareTokens = pools.map((pool, i) => (isCrps[i] ? callers[i] : pool))

    const tokenLists = await multicall(
      pools.map((pool) => ({ address: pool, abi: poolV1Abi, functionName: 'getCurrentTokens' }))
    )
    const symbols = await multicall(
      shareTokens.map((address) => ({ address, abi: erc20Abi, functionName: 'symbol' }))
    )
    const names = await multicall(
      shareTokens.map((address) => ({ address, abi: erc20Abi, functionName: 'name' }))
    )
    const allTokens = tokenLists.flatMap((tokens) => tokens ?? [])
    await getTokenMeta(allTokens)

    pools.forEach((backingPool, i) => {
      if (!tokenLists[i]?.length || !shareTokens[i]) return
      const smart = isCrps[i] === true
      out.v1Pools.push({
        address: shareTokens[i],
        poolKind: smart ? 'smart' : 'core',
        ...(smart ? { underlyingPool: backingPool } : {}),
        symbol: symbols[i] ?? '',
        name: names[i] ?? '',
        tokens: tokenLists[i].map((token) => ({
          address: token,
          symbol: tokenMetaCache.get(token)?.symbol ?? token.slice(0, 8),
          decimals: tokenMetaCache.get(token)?.decimals ?? 18,
        })),
      })
    })
  }
}

// ---------- v2 pools ----------
if (include('v2') && chain.v2) {
  for (const factory of chain.v2.factories) {
    const pools = events.found.get(`v2:${factory.name}`) ?? []
    console.log(`v2 ${factory.name} (${factory.poolType}): ${pools.length} pools`)
    if (!pools.length) continue

    const poolIds = await multicall(pools.map((p) => ({ address: p, abi: poolAbi, functionName: 'getPoolId' })))
    const valid = pools
      .map((address, i) => ({ address, poolId: poolIds[i] }))
      .filter((p) => p.poolId !== null)
    if (valid.length < pools.length) {
      console.log(`  skipped ${pools.length - valid.length} pools without getPoolId (never registered)`)
    }

    const tokenLists = await multicall(
      valid.map((p) => ({
        address: chain.v2.vault,
        abi: vaultV2Abi,
        functionName: 'getPoolTokens',
        args: [p.poolId],
      }))
    )
    const symbols = await multicall(valid.map((p) => ({ address: p.address, abi: erc20Abi, functionName: 'symbol' })))
    const names = await multicall(valid.map((p) => ({ address: p.address, abi: erc20Abi, functionName: 'name' })))

    const allTokens = tokenLists.flatMap((t) => (t ? t[0] : []))
    await getTokenMeta(allTokens)

    valid.forEach((p, i) => {
      if (!tokenLists[i]) return // not registered with vault
      const tokens = tokenLists[i][0].map((addr) => ({
        address: addr,
        symbol: tokenMetaCache.get(addr)?.symbol ?? addr.slice(0, 8),
        decimals: tokenMetaCache.get(addr)?.decimals ?? 18,
        isPhantomBpt: addr.toLowerCase() === p.address.toLowerCase(),
      }))
      out.v2Pools.push({
        address: p.address,
        poolId: p.poolId,
        poolType: factory.poolType,
        symbol: symbols[i] ?? '',
        name: names[i] ?? '',
        tokens,
      })
    })
  }
}

// ---------- v3 pools ----------
if (include('v3') && chain.v3) {
  const pools = events.found.get('v3:vault') ?? []
  console.log(`v3 vault: ${pools.length} pools`)
  if (pools.length) {
    const tokenLists = await multicall(
      pools.map((p) => ({ address: chain.v3.vault, abi: vaultV3Abi, functionName: 'getPoolTokens', args: [p] }))
    )
    const symbols = await multicall(pools.map((p) => ({ address: p, abi: erc20Abi, functionName: 'symbol' })))
    const names = await multicall(pools.map((p) => ({ address: p, abi: erc20Abi, functionName: 'name' })))
    const allTokens = tokenLists.flatMap((t) => t ?? [])
    await getTokenMeta(allTokens)

    pools.forEach((p, i) => {
      if (!tokenLists[i]) return
      out.v3Pools.push({
        address: p,
        symbol: symbols[i] ?? '',
        name: names[i] ?? '',
        tokens: tokenLists[i].map((addr) => ({
          address: addr,
          symbol: tokenMetaCache.get(addr)?.symbol ?? addr.slice(0, 8),
          decimals: tokenMetaCache.get(addr)?.decimals ?? 18,
        })),
      })
    })
  }
}

// ---------- gauges ----------
if (include('v2') && chain.v2?.gaugeFactories?.length) {
  for (const gf of chain.v2.gaugeFactories) {
    const gauges = events.found.get(`gauge:${gf.name}`) ?? []
    console.log(`gauge ${gf.name}: ${gauges.length} gauges`)
    if (!gauges.length) continue
    const lpTokens = await multicall(gauges.map((g) => ({ address: g, abi: gaugeAbi, functionName: 'lp_token' })))
    const poolSymbols = new Map(out.v2Pools.map((p) => [p.address.toLowerCase(), p.symbol]))
    const unknownLps = gauges.map((_, i) => lpTokens[i]).filter((lp) => lp && !poolSymbols.has(lp.toLowerCase()))
    await getTokenMeta(unknownLps)
    gauges.forEach((g, i) => {
      const lp = lpTokens[i]
      if (!lp) return
      out.gauges.push({
        address: g,
        lpToken: lp,
        symbol: poolSymbols.get(lp.toLowerCase()) ?? tokenMetaCache.get(lp)?.symbol ?? lp.slice(0, 8),
      })
    })
  }
}

// deterministic output for clean diffs
out.v1Pools.sort((a, b) => a.address.localeCompare(b.address))
out.v2Pools.sort((a, b) => a.address.localeCompare(b.address))
out.v3Pools.sort((a, b) => a.address.localeCompare(b.address))
out.gauges.sort((a, b) => a.address.localeCompare(b.address))

const outPath = join(__dirname, '..', 'src', 'config', 'data', `${chainKey}.json`)
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n')
console.log(
  `wrote ${outPath}: ${out.v1Pools.length} v1 pools, ${out.v2Pools.length} v2 pools, ${out.v3Pools.length} v3 pools, ${out.gauges.length} gauges`
)
