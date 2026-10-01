import {
  encodeAbiParameters,
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { vaultV2Abi } from '../abis/vaultV2'
import { balancerQueriesAbi } from '../abis/balancerQueries'
import { basePoolV2Abi } from '../abis/basePoolV2'
import { elementPoolAbi, fxPoolAbi } from '../abis/legacyPools'
import type { ChainConfig, PoolType } from '../config/chains'
import type { PoolPosition } from './positions'
import { applySlippage } from './format'

// ExitKind constants (see b-sdk encoders):
// Weighted/LBP/Managed/Gyro/Stable: EXACT_BPT_IN_FOR_TOKENS_OUT = 1
// ComposableStable:                 EXACT_BPT_IN_FOR_ALL_TOKENS_OUT = 2
// All pool types (recovery mode):   RECOVERY = 255
const PROPORTIONAL_EXIT_KIND: Partial<Record<PoolType, bigint>> = {
  weighted: 1n,
  stable: 1n,
  lbp: 1n,
  managed: 1n,
  gyro: 1n,
  composableStable: 2n,
  // linear / phantomStable: recovery-mode exit only
}

// Proportional exits with their own userData and no BalancerQueries.queryExit support:
// FX:      abi.encode(uint256 bptIn, address[] assets) - one encoding for both FXPool versions
//          (the older one only decodes the bptIn). The (exitKind, bptIn) encoding is dangerous here:
//          FX would read exitKind as bptIn and burn 1 wei for nothing.
// Element: abi.encode(uint256[] amountsOut) - the pool burns the BPT matching the amounts, from
//          the recipient, so the recipient must be the holder.
const CUSTOM_EXIT_TYPES: ReadonlySet<PoolType> = new Set(['fx', 'element'])

// 'paused': pool paused and not in recovery mode. Non-recovery exits revert in BasePool, and
// enabling recovery mode is permissioned on v2, so there is no exit path until governance acts.
export type V2ExitMode = 'recovery' | 'proportional' | 'unsupported' | 'paused'

export function v2ExitMode(position: PoolPosition): V2ExitMode {
  if (position.inRecoveryMode) return 'recovery'
  if (position.paused) return 'paused'
  if (PROPORTIONAL_EXIT_KIND[position.poolType!] !== undefined) return 'proportional'
  if (CUSTOM_EXIT_TYPES.has(position.poolType!)) return 'proportional'
  return 'unsupported'
}

function assertExitable(mode: V2ExitMode): asserts mode is 'recovery' | 'proportional' {
  if (mode === 'unsupported') throw new Error('Pool type supports recovery-mode exits only')
  if (mode === 'paused') throw new Error('Pool is paused and not in recovery mode')
}

function encodeUserData(mode: 'recovery' | 'proportional', poolType: PoolType, bptIn: bigint): `0x${string}` {
  const kind = mode === 'recovery' ? 255n : PROPORTIONAL_EXIT_KIND[poolType]!
  return encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }],
    [kind, bptIn]
  )
}

function encodeFxUserData(bptIn: bigint, assets: Address[]): `0x${string}` {
  return encodeAbiParameters([{ type: 'uint256' }, { type: 'address[]' }], [bptIn, assets])
}

export interface V2ExitQuote {
  amountsOut: bigint[] // aligned with position.tokens (registration order, incl. phantom BPT slot)
  userData: `0x${string}`
  mode: V2ExitMode
}

/** Fallback quote when queryExit reverts: zero expectations, used for emergency exits only. */
export function emergencyV2Quote(position: PoolPosition, bptIn: bigint, mode: V2ExitMode): V2ExitQuote {
  assertExitable(mode)
  if (position.poolType === 'element') {
    // the userData *is* the amounts to withdraw, so there is nothing to send without a quote
    throw new Error('Element pool exits need a successful simulation')
  }
  return {
    amountsOut: position.tokens.map(() => 0n),
    userData:
      position.poolType === 'fx'
        ? encodeFxUserData(bptIn, position.tokens.map((t) => t.address))
        : encodeUserData(mode, position.poolType!, bptIn),
    mode,
  }
}

/**
 * FX and Element pools don't implement the BasePool query hook, so queryExit reverts. Compute the
 * amounts from the pool itself and prove them by simulating the real exit from the user's address.
 */
async function quoteCustomExit(
  client: PublicClient,
  chain: ChainConfig,
  position: PoolPosition,
  user: Address,
  bptIn: bigint
): Promise<V2ExitQuote> {
  const assets = position.tokens.map((t) => t.address)
  let amountsOut: bigint[]
  let userData: `0x${string}`
  if (position.poolType === 'fx') {
    const [preview, derivative0] = await Promise.all([
      client.readContract({ address: position.address, abi: fxPoolAbi, functionName: 'viewWithdraw', args: [bptIn] }),
      client.readContract({ address: position.address, abi: fxPoolAbi, functionName: 'derivatives', args: [0n] }),
    ])
    // viewWithdraw follows derivatives() order; map it onto the vault's token order
    amountsOut = assets.map((a) => (a.toLowerCase() === derivative0.toLowerCase() ? preview[0] : preview[1]))
    userData = encodeFxUserData(bptIn, assets)
  } else {
    const [[, balances], totalSupply] = await Promise.all([
      client.readContract({
        address: chain.v2!.vault,
        abi: vaultV2Abi,
        functionName: 'getPoolTokens',
        args: [position.poolId!],
      }),
      client.readContract({ address: position.address, abi: elementPoolAbi, functionName: 'totalSupply' }),
    ])
    amountsOut = balances.map((b) => (b * bptIn) / totalSupply)
    userData = encodeAbiParameters([{ type: 'uint256[]' }], [amountsOut])
  }
  await client.simulateContract({
    account: user,
    address: chain.v2!.vault,
    abi: vaultV2Abi,
    functionName: 'exitPool',
    args: [
      position.poolId!,
      user,
      user,
      { assets, minAmountsOut: assets.map(() => 0n), userData, toInternalBalance: false },
    ],
  })
  return { amountsOut, userData, mode: 'proportional' }
}

/**
 * Recovery-mode exits can succeed even when BalancerQueries.queryExit reverts (e.g. paused
 * pools: the query path hits the pause check, the real recovery exit bypasses it). So for
 * recovery exits we compute the proportional amounts client-side, mirroring the on-chain
 * RecoveryModeHelper: amountOut[i] = cashBalance[i] * bptIn / virtualSupply, where
 * virtualSupply excludes pre-minted BPT held by the vault (composable/linear pools).
 */
async function quoteRecoveryExit(
  client: PublicClient,
  chain: ChainConfig,
  position: PoolPosition,
  bptIn: bigint
): Promise<bigint[]> {
  const [[, balances], totalSupply] = await Promise.all([
    client.readContract({
      address: chain.v2!.vault,
      abi: vaultV2Abi,
      functionName: 'getPoolTokens',
      args: [position.poolId!],
    }),
    client.readContract({
      address: position.address,
      abi: [
        {
          type: 'function',
          name: 'totalSupply',
          stateMutability: 'view',
          inputs: [],
          outputs: [{ type: 'uint256' }],
        },
      ] as const,
      functionName: 'totalSupply',
    }),
  ])
  const bptIndex = position.tokens.findIndex((t) => t.isPhantomBpt)
  const virtualSupply = bptIndex >= 0 ? totalSupply - balances[bptIndex] : totalSupply
  return position.tokens.map((t, i) => {
    if (t.isPhantomBpt) return 0n
    return (balances[i] * bptIn) / virtualSupply
  })
}

/** Simulate the exit to get expected amounts out. */
export async function queryV2Exit(
  client: PublicClient,
  chain: ChainConfig,
  position: PoolPosition,
  user: Address,
  bptIn: bigint,
  mode: V2ExitMode
): Promise<V2ExitQuote> {
  assertExitable(mode)
  if (mode === 'proportional' && CUSTOM_EXIT_TYPES.has(position.poolType!)) {
    return quoteCustomExit(client, chain, position, user, bptIn)
  }
  const userData = encodeUserData(mode, position.poolType!, bptIn)
  if (mode === 'recovery') {
    const amountsOut = await quoteRecoveryExit(client, chain, position, bptIn)
    return { amountsOut, userData, mode }
  }
  const assets = position.tokens.map((t) => t.address)
  const { result } = await client.simulateContract({
    address: chain.v2!.balancerQueries,
    abi: balancerQueriesAbi,
    functionName: 'queryExit',
    args: [
      position.poolId!,
      user,
      user,
      {
        assets,
        minAmountsOut: assets.map(() => 0n),
        userData,
        toInternalBalance: false,
      },
    ],
  })
  return { amountsOut: [...result[1]], userData, mode }
}

/** Execute the exit. minAmountsOut derived from the quote minus slippage; all zeros in emergency mode. */
export async function executeV2Exit(
  walletClient: WalletClient,
  chain: ChainConfig,
  position: PoolPosition,
  user: Address,
  quote: V2ExitQuote,
  slippagePct: number,
  emergency: boolean
): Promise<Hash> {
  const assets = position.tokens.map((t) => t.address)
  const minAmountsOut = position.tokens.map((t, i) => {
    if (emergency || t.isPhantomBpt) return 0n
    return applySlippage(quote.amountsOut[i] ?? 0n, slippagePct)
  })
  return walletClient.writeContract({
    chain: walletClient.chain,
    account: user,
    address: chain.v2!.vault,
    abi: vaultV2Abi,
    functionName: 'exitPool',
    args: [
      position.poolId!,
      user,
      user,
      {
        assets,
        minAmountsOut,
        userData: quote.userData,
        toInternalBalance: false,
      },
    ],
  })
}

/**
 * For manual pool entry: recognise pool types with a custom exit by their own getters, so a pasted
 * pool from an unknown factory never gets the standard (exitKind, bptIn) userData.
 */
export async function detectCustomPoolType(
  client: PublicClient,
  poolAddress: Address
): Promise<{ poolType: 'fx' | 'element'; elementBond?: Address } | null> {
  const [bond, derivative] = await Promise.all([
    client.readContract({ address: poolAddress, abi: elementPoolAbi, functionName: 'bond' }).catch(() => null),
    client
      .readContract({ address: poolAddress, abi: fxPoolAbi, functionName: 'derivatives', args: [0n] })
      .catch(() => null),
  ])
  if (bond) return { poolType: 'element', elementBond: bond }
  if (derivative) return { poolType: 'fx' }
  return null
}

/** For manual pool entry: resolve a v2 pool from its address. */
export async function resolveV2Pool(
  client: PublicClient,
  chain: ChainConfig,
  poolAddress: Address
): Promise<{ poolId: `0x${string}`; tokens: Address[]; inRecoveryMode: boolean; paused: boolean }> {
  const poolId = await client.readContract({
    address: poolAddress,
    abi: basePoolV2Abi,
    functionName: 'getPoolId',
  })
  const [tokens] = await client.readContract({
    address: chain.v2!.vault,
    abi: vaultV2Abi,
    functionName: 'getPoolTokens',
    args: [poolId],
  })
  let inRecoveryMode = false
  try {
    inRecoveryMode = await client.readContract({
      address: poolAddress,
      abi: basePoolV2Abi,
      functionName: 'inRecoveryMode',
    })
  } catch {
    // very old pools (pre-recovery-mode) don't implement it
  }
  const [paused] = await client
    .readContract({ address: poolAddress, abi: basePoolV2Abi, functionName: 'getPausedState' })
    .catch(() => [false] as const)
  return { poolId, tokens: [...tokens], inRecoveryMode, paused }
}
