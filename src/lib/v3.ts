import type { Address, Hash, PublicClient, WalletClient } from 'viem'
import { routerV3Abi } from '../abis/routerV3'
import { vaultV3Abi } from '../abis/vaultV3'
import { erc20Abi } from '../abis/erc20'
import type { ChainConfig } from '../config/chains'
import type { PoolPosition } from './positions'
import { applySlippage } from './format'

export interface V3ExitQuote {
  amountsOut: bigint[] // aligned with position.tokens (registration order)
  recovery: boolean
  /** Older router deployments only have removeLiquidityRecovery(pool, bptIn) without mins. */
  legacyRecoverySignature: boolean
}

/** Fallback quote when the router query reverts: zero expectations, emergency exits only. */
export function emergencyV3Quote(position: PoolPosition): V3ExitQuote {
  return {
    amountsOut: position.tokens.map(() => 0n),
    recovery: position.inRecoveryMode,
    legacyRecoverySignature: false,
  }
}

export async function queryV3Exit(
  client: PublicClient,
  chain: ChainConfig,
  position: PoolPosition,
  bptIn: bigint
): Promise<V3ExitQuote> {
  const router = chain.v3!.router
  if (!router) throw new Error('No v3 router configured for this chain')

  if (position.inRecoveryMode) {
    const { result } = await client.simulateContract({
      address: router,
      abi: routerV3Abi,
      functionName: 'queryRemoveLiquidityRecovery',
      args: [position.address, bptIn],
    })
    // Detect which removeLiquidityRecovery signature this router supports
    let legacy = false
    try {
      await client.simulateContract({
        address: router,
        abi: routerV3Abi,
        functionName: 'removeLiquidityRecovery',
        args: [position.address, bptIn, result.map(() => 0n)],
        account: '0x0000000000000000000000000000000000000000',
      })
    } catch (e: any) {
      const msg = String(e.shortMessage ?? e.message ?? '')
      if (/function|selector|not found|0x[0-9a-f]{8}/i.test(msg) && !/revert/i.test(msg)) {
        legacy = true
      }
      // other reverts (e.g. zero-address sender checks) tell us the selector exists
    }
    return { amountsOut: [...result], recovery: true, legacyRecoverySignature: legacy }
  }

  const { result } = await client.simulateContract({
    address: router,
    abi: routerV3Abi,
    functionName: 'queryRemoveLiquidityProportional',
    args: [position.address, bptIn, '0x'],
  })
  return { amountsOut: [...result], recovery: false, legacyRecoverySignature: false }
}

/** v3 removes BPT through the Router, which needs a standard ERC20 allowance on the BPT. */
export async function getV3Allowance(
  client: PublicClient,
  chain: ChainConfig,
  pool: Address,
  user: Address
): Promise<bigint> {
  return client.readContract({
    address: pool,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [user, chain.v3!.router!],
  })
}

export async function approveV3Router(
  walletClient: WalletClient,
  chain: ChainConfig,
  pool: Address,
  user: Address,
  amount: bigint
): Promise<Hash> {
  return walletClient.writeContract({
    chain: walletClient.chain,
    account: user,
    address: pool,
    abi: erc20Abi,
    functionName: 'approve',
    args: [chain.v3!.router!, amount],
  })
}

export async function executeV3Exit(
  walletClient: WalletClient,
  chain: ChainConfig,
  position: PoolPosition,
  user: Address,
  bptIn: bigint,
  quote: V3ExitQuote,
  slippagePct: number,
  emergency: boolean
): Promise<Hash> {
  const router = chain.v3!.router!
  const minAmountsOut = quote.amountsOut.map((a) => (emergency ? 0n : applySlippage(a, slippagePct)))

  if (quote.recovery) {
    if (quote.legacyRecoverySignature) {
      // old router: no minAmountsOut parameter -> only allowed in emergency mode
      if (!emergency) {
        throw new Error(
          'This router only supports recovery exits without slippage protection. Enable emergency mode to proceed.'
        )
      }
      return walletClient.writeContract({
        chain: walletClient.chain,
        account: user,
        address: router,
        abi: routerV3Abi,
        functionName: 'removeLiquidityRecovery',
        args: [position.address, bptIn],
      })
    }
    return walletClient.writeContract({
      chain: walletClient.chain,
      account: user,
      address: router,
      abi: routerV3Abi,
      functionName: 'removeLiquidityRecovery',
      args: [position.address, bptIn, minAmountsOut],
    })
  }

  return walletClient.writeContract({
    chain: walletClient.chain,
    account: user,
    address: router,
    abi: routerV3Abi,
    functionName: 'removeLiquidityProportional',
    args: [position.address, bptIn, minAmountsOut, false, '0x'],
  })
}

/** For manual pool entry: resolve a v3 pool from its address. */
export async function resolveV3Pool(
  client: PublicClient,
  chain: ChainConfig,
  poolAddress: Address
): Promise<{ tokens: Address[]; inRecoveryMode: boolean }> {
  const tokens = await client.readContract({
    address: chain.v3!.vault,
    abi: vaultV3Abi,
    functionName: 'getPoolTokens',
    args: [poolAddress],
  })
  const inRecoveryMode = await client.readContract({
    address: chain.v3!.vault,
    abi: vaultV3Abi,
    functionName: 'isPoolInRecoveryMode',
    args: [poolAddress],
  })
  return { tokens: [...tokens], inRecoveryMode }
}
