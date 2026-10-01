import type { Address, PublicClient } from 'viem'
import { erc20Abi } from '../abis/erc20'
import { basePoolV2Abi } from '../abis/basePoolV2'
import { vaultV3Abi } from '../abis/vaultV3'
import { childChainGaugeV2Abi } from '../abis/childChainGaugeV2'
import type { ChainConfig } from '../config/chains'
import type { ChainData, GaugePosition, PoolPosition, PrincipalPosition, RewardInfo } from './positions'

const CHUNK = 150

async function multicall(
  client: PublicClient,
  chain: ChainConfig,
  calls: { address: Address; abi: any; functionName: string; args?: any[] }[]
): Promise<(any | null)[]> {
  const results: (any | null)[] = []
  for (let i = 0; i < calls.length; i += CHUNK) {
    const batch = await client.multicall({
      contracts: calls.slice(i, i + CHUNK),
      multicallAddress: chain.multicall3,
      allowFailure: true,
    })
    results.push(...batch.map((r) => (r.status === 'success' ? r.result : null)))
  }
  return results
}

export interface ScanResult {
  pools: PoolPosition[]
  gauges: GaugePosition[]
  principals: PrincipalPosition[]
}

/**
 * Element principal tokens (ePyv…) the user holds: what an Element pool exit pays out, and also
 * what users who exited through Element's own UI may still hold unredeemed.
 */
async function scanPrincipals(
  client: PublicClient,
  chain: ChainConfig,
  data: ChainData,
  user: Address
): Promise<PrincipalPosition[]> {
  const byTranche = new Map<string, PrincipalPosition>()
  for (const pool of data.v2Pools) {
    if (!pool.elementBond || byTranche.has(pool.elementBond.toLowerCase())) continue
    const bond = pool.tokens.find((t) => t.address.toLowerCase() === pool.elementBond!.toLowerCase())
    const underlying = pool.tokens.find((t) => t.address.toLowerCase() !== pool.elementBond!.toLowerCase())
    if (!bond || !underlying) continue
    byTranche.set(pool.elementBond.toLowerCase(), {
      tranche: pool.elementBond,
      symbol: bond.symbol,
      decimals: bond.decimals,
      balance: 0n,
      underlyingSymbol: underlying.symbol,
    })
  }
  const tranches = [...byTranche.values()]
  if (!tranches.length) return []
  const balances = await multicall(
    client,
    chain,
    tranches.map((t) => ({ address: t.tranche, abi: erc20Abi, functionName: 'balanceOf', args: [user] }))
  )
  // below 0.0001 tokens is rounding dust from exits: worthless, and withdrawPrincipal reverts on it
  // ("Not enough underlying") because it rounds to zero shares
  const dust = (decimals: number) => 10n ** BigInt(Math.max(decimals - 4, 0))
  return tranches
    .map((t, i) => ({ ...t, balance: (balances[i] as bigint | null) ?? 0n }))
    .filter((t) => t.balance >= dust(t.decimals))
}

export async function scanPositions(
  client: PublicClient,
  chain: ChainConfig,
  data: ChainData,
  user: Address,
  onProgress?: (msg: string) => void
): Promise<ScanResult> {
  const v1Pools = data.v1Pools ?? []

  // Pass 1: balanceOf across all v1/v2/v3 pools and gauges
  onProgress?.(
    `Scanning ${v1Pools.length + data.v2Pools.length + data.v3Pools.length} pools and ${data.gauges.length} gauges...`
  )
  const balanceCalls = [
    ...v1Pools.map((p) => ({ address: p.address, abi: erc20Abi, functionName: 'balanceOf', args: [user] })),
    ...data.v2Pools.map((p) => ({ address: p.address, abi: erc20Abi, functionName: 'balanceOf', args: [user] })),
    ...data.v3Pools.map((p) => ({ address: p.address, abi: erc20Abi, functionName: 'balanceOf', args: [user] })),
    ...data.gauges.map((g) => ({
      address: g.address,
      abi: childChainGaugeV2Abi,
      functionName: 'balanceOf',
      args: [user],
    })),
  ]
  const balances = await multicall(client, chain, balanceCalls)

  const nV1 = v1Pools.length
  const nV2 = data.v2Pools.length
  const nV3 = data.v3Pools.length

  const v1Hits = v1Pools
    .map((p, i) => ({ pool: p, balance: balances[i] as bigint | null }))
    .filter((x) => (x.balance ?? 0n) > 0n)
  const v2Hits = data.v2Pools
    .map((p, i) => ({ pool: p, balance: balances[nV1 + i] as bigint | null }))
    .filter((x) => (x.balance ?? 0n) > 0n)
  const v3Hits = data.v3Pools
    .map((p, i) => ({ pool: p, balance: balances[nV1 + nV2 + i] as bigint | null }))
    .filter((x) => (x.balance ?? 0n) > 0n)
  const gaugeHits = data.gauges
    .map((g, i) => ({ gauge: g, balance: balances[nV1 + nV2 + nV3 + i] as bigint | null }))
    .filter((x) => (x.balance ?? 0n) > 0n)

  // Pass 2: enrich hits — recovery mode + gauge rewards
  onProgress?.(
    `Found ${v1Hits.length + v2Hits.length + v3Hits.length} pool / ${gaugeHits.length} gauge positions, loading details...`
  )

  const recoveryCalls = [
    ...v2Hits.map((x) => ({ address: x.pool.address, abi: basePoolV2Abi, functionName: 'inRecoveryMode' })),
    ...v3Hits.map((x) => ({
      address: chain.v3!.vault,
      abi: vaultV3Abi,
      functionName: 'isPoolInRecoveryMode',
      args: [x.pool.address],
    })),
  ]
  const recovery = recoveryCalls.length ? await multicall(client, chain, recoveryCalls) : []

  const pausedCalls = [
    ...v2Hits.map((x) => ({ address: x.pool.address, abi: basePoolV2Abi, functionName: 'getPausedState' })),
    ...v3Hits.map((x) => ({
      address: chain.v3!.vault,
      abi: vaultV3Abi,
      functionName: 'isPoolPaused',
      args: [x.pool.address],
    })),
    ...(v3Hits.length ? [{ address: chain.v3!.vault, abi: vaultV3Abi, functionName: 'isVaultPaused' }] : []),
  ]
  const pausedResults = pausedCalls.length ? await multicall(client, chain, pausedCalls) : []
  const v2Paused = (i: number) => (pausedResults[i] as readonly [boolean, bigint, bigint] | null)?.[0] === true
  const v3VaultPaused = pausedResults[v2Hits.length + v3Hits.length] === true
  const v3Paused = (i: number) => v3VaultPaused || pausedResults[v2Hits.length + i] === true

  const pools: PoolPosition[] = [
    ...v1Hits.map((x) => ({
      protocolVersion: 1 as const,
      address: x.pool.address,
      v1PoolKind: x.pool.poolKind,
      v1UnderlyingPool: x.pool.underlyingPool,
      symbol: x.pool.symbol,
      name: x.pool.name,
      tokens: x.pool.tokens,
      balance: x.balance!,
      inRecoveryMode: false,
      paused: false,
    })),
    ...v2Hits.map((x, i) => ({
      protocolVersion: 2 as const,
      address: x.pool.address,
      poolId: x.pool.poolId,
      poolType: x.pool.poolType,
      elementBond: x.pool.elementBond,
      symbol: x.pool.symbol,
      name: x.pool.name,
      tokens: x.pool.tokens,
      balance: x.balance!,
      inRecoveryMode: recovery[i] === true,
      paused: v2Paused(i),
    })),
    ...v3Hits.map((x, i) => ({
      protocolVersion: 3 as const,
      address: x.pool.address,
      symbol: x.pool.symbol,
      name: x.pool.name,
      tokens: x.pool.tokens,
      balance: x.balance!,
      inRecoveryMode: recovery[v2Hits.length + i] === true,
      paused: v3Paused(i),
    })),
  ]

  // Gauge rewards: reward_count -> reward_tokens -> claimable_reward + token metadata
  const gauges: GaugePosition[] = []
  if (gaugeHits.length) {
    const counts = await multicall(
      client,
      chain,
      gaugeHits.map((x) => ({ address: x.gauge.address, abi: childChainGaugeV2Abi, functionName: 'reward_count' }))
    )
    const tokenCalls: { address: Address; abi: any; functionName: string; args?: any[] }[] = []
    const tokenCallOwner: number[] = []
    gaugeHits.forEach((x, gi) => {
      const count = Number(counts[gi] ?? 0n)
      for (let r = 0; r < count; r++) {
        tokenCalls.push({
          address: x.gauge.address,
          abi: childChainGaugeV2Abi,
          functionName: 'reward_tokens',
          args: [BigInt(r)],
        })
        tokenCallOwner.push(gi)
      }
    })
    const rewardTokens = tokenCalls.length ? await multicall(client, chain, tokenCalls) : []

    const claimableCalls = rewardTokens.map((token, i) => ({
      address: gaugeHits[tokenCallOwner[i]].gauge.address,
      abi: childChainGaugeV2Abi,
      functionName: 'claimable_reward',
      args: [user, token],
    }))
    const claimables = claimableCalls.length ? await multicall(client, chain, claimableCalls) : []

    const uniqueTokens = [...new Set(rewardTokens.filter(Boolean) as Address[])]
    const symbols = await multicall(
      client,
      chain,
      uniqueTokens.map((t) => ({ address: t, abi: erc20Abi, functionName: 'symbol' }))
    )
    const decimals = await multicall(
      client,
      chain,
      uniqueTokens.map((t) => ({ address: t, abi: erc20Abi, functionName: 'decimals' }))
    )
    const meta = new Map(
      uniqueTokens.map((t, i) => [
        t.toLowerCase(),
        { symbol: (symbols[i] as string) ?? t.slice(0, 8), decimals: decimals[i] !== null ? Number(decimals[i]) : 18 },
      ])
    )

    const rewardsByGauge: RewardInfo[][] = gaugeHits.map(() => [])
    rewardTokens.forEach((token, i) => {
      if (!token) return
      const m = meta.get((token as string).toLowerCase())!
      rewardsByGauge[tokenCallOwner[i]].push({
        token: token as Address,
        symbol: m.symbol,
        decimals: m.decimals,
        claimable: (claimables[i] as bigint) ?? 0n,
      })
    })

    gaugeHits.forEach((x, gi) => {
      gauges.push({
        address: x.gauge.address,
        lpToken: x.gauge.lpToken,
        symbol: x.gauge.symbol,
        balance: x.balance!,
        rewards: rewardsByGauge[gi],
      })
    })
  }

  const principals = await scanPrincipals(client, chain, data, user)

  return { pools, gauges, principals }
}
