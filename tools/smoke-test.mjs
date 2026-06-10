/**
 * Headless smoke test against a live chain, no funds needed.
 * The gauge contracts themselves hold deposited BPT, so we "scan" a gauge address
 * as if it were a user and run the exit simulation with it as sender.
 *
 * Usage: node tools/smoke-test.mjs --chain mode [--rpc <url>]
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, encodeAbiParameters, formatUnits, http } from 'viem'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REGISTRY = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'config', 'registry.json'), 'utf8'))

const arg = (n, f = null) => {
  const i = process.argv.indexOf(`--${n}`)
  return i > -1 ? process.argv[i + 1] : f
}
const chainKey = arg('chain', 'mode')
const chain = REGISTRY[chainKey]
const data = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'config', 'data', `${chainKey}.json`), 'utf8'))
const client = createPublicClient({ transport: http(arg('rpc', chain.defaultRpcUrl)) })

const erc20 = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
]
const basePool = [
  { type: 'function', name: 'inRecoveryMode', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
]
const queries = [
  {
    type: 'function',
    name: 'queryExit',
    stateMutability: 'nonpayable',
    inputs: [
      { type: 'bytes32' },
      { type: 'address' },
      { type: 'address' },
      {
        type: 'tuple',
        components: [
          { name: 'assets', type: 'address[]' },
          { name: 'minAmountsOut', type: 'uint256[]' },
          { name: 'userData', type: 'bytes' },
          { name: 'toInternalBalance', type: 'bool' },
        ],
      },
    ],
    outputs: [
      { name: 'bptIn', type: 'uint256' },
      { name: 'amountsOut', type: 'uint256[]' },
    ],
  },
]

let failures = 0

for (const gauge of data.gauges) {
  const pool = data.v2Pools.find((p) => p.address.toLowerCase() === gauge.lpToken.toLowerCase())
  if (!pool) {
    console.log(`gauge ${gauge.address}: lpToken not in pool list (${gauge.lpToken})`)
    continue
  }
  // the gauge holds all staked BPT
  const balance = await client.readContract({
    address: pool.address,
    abi: erc20,
    functionName: 'balanceOf',
    args: [gauge.address],
  })
  if (balance === 0n) {
    console.log(`${pool.symbol}: gauge holds 0 BPT, skip`)
    continue
  }
  const inRecovery = await client
    .readContract({ address: pool.address, abi: basePool, functionName: 'inRecoveryMode' })
    .catch(() => false)

  const kind = inRecovery ? 255n : pool.poolType === 'composableStable' ? 2n : 1n
  const bptIn = balance / 100n > 0n ? balance / 100n : balance
  const userData = encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [kind, bptIn])
  const assets = pool.tokens.map((t) => t.address)
  const label = `${pool.symbol} (${pool.poolType}${inRecovery ? ', recovery' : ''})`

  try {
    let amountsOut
    if (inRecovery) {
      // client-side recovery math (queryExit can revert BAL#402 on paused pools)
      const [, balances] = await client.readContract({
        address: chain.v2.vault,
        abi: [
          {
            type: 'function', name: 'getPoolTokens', stateMutability: 'view',
            inputs: [{ type: 'bytes32' }],
            outputs: [{ type: 'address[]' }, { type: 'uint256[]' }, { type: 'uint256' }],
          },
        ],
        functionName: 'getPoolTokens',
        args: [pool.poolId],
      })
      const totalSupply = await client.readContract({
        address: pool.address,
        abi: [{ type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }],
        functionName: 'totalSupply',
      })
      const bptIndex = pool.tokens.findIndex((t) => t.isPhantomBpt)
      const virtualSupply = bptIndex >= 0 ? totalSupply - balances[bptIndex] : totalSupply
      amountsOut = pool.tokens.map((t, i) => (t.isPhantomBpt ? 0n : (balances[i] * bptIn) / virtualSupply))

      // verify the math against the chain: simulate the REAL exit with tight mins (0.5% below)
      const mins = amountsOut.map((a) => (a * 9950n) / 10000n)
      await client.simulateContract({
        address: chain.v2.vault,
        abi: [
          {
            type: 'function', name: 'exitPool', stateMutability: 'nonpayable',
            inputs: [
              { type: 'bytes32' }, { type: 'address' }, { type: 'address' },
              {
                type: 'tuple',
                components: [
                  { name: 'assets', type: 'address[]' },
                  { name: 'minAmountsOut', type: 'uint256[]' },
                  { name: 'userData', type: 'bytes' },
                  { name: 'toInternalBalance', type: 'bool' },
                ],
              },
            ],
            outputs: [],
          },
        ],
        functionName: 'exitPool',
        args: [pool.poolId, gauge.address, gauge.address, { assets, minAmountsOut: mins, userData, toInternalBalance: false }],
        account: gauge.address,
      })
    } else {
      const { result } = await client.simulateContract({
        address: chain.v2.balancerQueries,
        abi: queries,
        functionName: 'queryExit',
        args: [
          pool.poolId,
          gauge.address,
          gauge.address,
          { assets, minAmountsOut: assets.map(() => 0n), userData, toInternalBalance: false },
        ],
      })
      amountsOut = result[1]
    }
    const amounts = amountsOut
      .map((a, i) => `${formatUnits(a, pool.tokens[i].decimals)} ${pool.tokens[i].symbol}`)
      .filter((_, i) => !pool.tokens[i].isPhantomBpt)
    console.log(`OK  ${label}: exit ${formatUnits(bptIn, 18)} BPT -> ${amounts.join(' + ')}${inRecovery ? ' [verified vs on-chain exit with 0.5% mins]' : ''}`)
  } catch (e) {
    failures++
    console.log(`FAIL ${label}: ${e.shortMessage ?? e.message}`)
  }
}

console.log(failures ? `\n${failures} simulation failures` : '\nall exit simulations OK')
process.exit(failures ? 1 : 0)
