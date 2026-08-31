import type { Address, Hash, PublicClient, WalletClient } from 'viem'
import { factoryV1Abi, poolV1Abi, smartPoolV1Abi } from '../abis/poolV1'
import type { ChainConfig, V1PoolKind } from '../config/chains'
import { applySlippage } from './format'
import type { PoolPosition } from './positions'

const BONE = 10n ** 18n

// Balancer V1's fixed-point math rounds to the nearest integer at both stages.
function bmul(a: bigint, b: bigint): bigint {
  return (a * b + BONE / 2n) / BONE
}

function bdiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error('Pool has zero total supply')
  return (a * BONE + b / 2n) / b
}

export interface V1ExitQuote {
  amountsOut: bigint[]
}

export function emergencyV1Quote(position: PoolPosition): V1ExitQuote {
  return { amountsOut: position.tokens.map(() => 0n) }
}

/** Quote the exact proportional math used by V1 BPool and ConfigurableRightsPool. */
export async function queryV1Exit(
  client: PublicClient,
  position: PoolPosition,
  user: Address,
  bptIn: bigint
): Promise<V1ExitQuote> {
  const balancePool = position.v1UnderlyingPool ?? position.address
  const [totalSupply, balances] = await Promise.all([
    client.readContract({
      address: position.address,
      abi: poolV1Abi,
      functionName: 'totalSupply',
    }),
    Promise.all(
      position.tokens.map((token) =>
        client.readContract({
          address: balancePool,
          abi: poolV1Abi,
          functionName: 'getBalance',
          args: [token.address],
        })
      )
    ),
  ])

  const smart = position.v1PoolKind === 'smart'
  const ratio = bdiv(bptIn, smart ? totalSupply + 1n : totalSupply)
  const amountsOut = balances.map((balance) => {
    if (smart && balance === 0n) throw new Error('Smart pool contains a zero-balance token')
    return bmul(ratio, smart ? balance - 1n : balance)
  })

  // V1 has no query helper: verify the exact client-side quote with a read-only exit call.
  await client.simulateContract({
    account: user,
    address: position.address,
    abi: poolV1Abi,
    functionName: 'exitPool',
    args: [bptIn, amountsOut],
  })
  return { amountsOut }
}

export async function executeV1Exit(
  walletClient: WalletClient,
  position: PoolPosition,
  user: Address,
  bptIn: bigint,
  quote: V1ExitQuote,
  slippagePct: number,
  emergency: boolean
): Promise<Hash> {
  const minAmountsOut = quote.amountsOut.map((amount) =>
    emergency ? 0n : applySlippage(amount, slippagePct)
  )
  return walletClient.writeContract({
    chain: walletClient.chain,
    account: user,
    address: position.address,
    abi: poolV1Abi,
    functionName: 'exitPool',
    args: [bptIn, minAmountsOut],
  })
}

/** Resolve a factory-created V1 core or smart pool from its share-token address. */
export async function resolveV1Pool(
  client: PublicClient,
  chain: ChainConfig,
  poolAddress: Address
): Promise<{ poolKind: V1PoolKind; underlyingPool?: Address; tokens: Address[] }> {
  if (!chain.v1) throw new Error('Balancer V1 is not configured on this chain')

  const isCrp = await client
    .readContract({
      address: chain.v1.crpFactory,
      abi: factoryV1Abi,
      functionName: 'isCrp',
      args: [poolAddress],
    })
    .catch(() => false)
  if (isCrp) {
    const underlyingPool = await client.readContract({
      address: poolAddress,
      abi: smartPoolV1Abi,
      functionName: 'bPool',
    })
    const tokens = await client.readContract({
      address: underlyingPool,
      abi: poolV1Abi,
      functionName: 'getCurrentTokens',
    })
    return { poolKind: 'smart', underlyingPool, tokens: [...tokens] }
  }

  const isCorePool = await client
    .readContract({
      address: chain.v1.factory,
      abi: factoryV1Abi,
      functionName: 'isBPool',
      args: [poolAddress],
    })
    .catch(() => false)
  if (isCorePool) {
    const tokens = await client.readContract({
      address: poolAddress,
      abi: poolV1Abi,
      functionName: 'getCurrentTokens',
    })
    return { poolKind: 'core', tokens: [...tokens] }
  }

  throw new Error('Address was not created by a configured Balancer V1 factory')
}
