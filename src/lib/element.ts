import type { Address, Hash, PublicClient, WalletClient } from 'viem'
import { elementTrancheAbi } from '../abis/legacyPools'

/**
 * Element principal tokens are matured: Tranche.withdrawPrincipal redeems them for the underlying
 * (through the tranche's wrapped position, no approval needed). Simulated to preview the amount.
 */
export async function previewRedeemPrincipal(
  client: PublicClient,
  tranche: Address,
  user: Address,
  amount: bigint
): Promise<bigint> {
  const { result } = await client.simulateContract({
    account: user,
    address: tranche,
    abi: elementTrancheAbi,
    functionName: 'withdrawPrincipal',
    args: [amount, user],
  })
  return result
}

export async function redeemPrincipal(
  walletClient: WalletClient,
  tranche: Address,
  user: Address,
  amount: bigint
): Promise<Hash> {
  return walletClient.writeContract({
    chain: walletClient.chain,
    account: user,
    address: tranche,
    abi: elementTrancheAbi,
    functionName: 'withdrawPrincipal',
    args: [amount, user],
  })
}
