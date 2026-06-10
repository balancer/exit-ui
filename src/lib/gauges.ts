import type { Address, Hash, WalletClient } from 'viem'
import { childChainGaugeV2Abi } from '../abis/childChainGaugeV2'

/** Unstake BPT from a gauge; claim_rewards=true claims all reward tokens in the same tx. */
export async function unstakeFromGauge(
  walletClient: WalletClient,
  gauge: Address,
  user: Address,
  amount: bigint,
  claimRewards: boolean
): Promise<Hash> {
  return walletClient.writeContract({
    chain: walletClient.chain,
    account: user,
    address: gauge,
    abi: childChainGaugeV2Abi,
    functionName: 'withdraw',
    args: [amount, claimRewards],
  })
}

export async function claimGaugeRewards(
  walletClient: WalletClient,
  gauge: Address,
  user: Address
): Promise<Hash> {
  return walletClient.writeContract({
    chain: walletClient.chain,
    account: user,
    address: gauge,
    abi: childChainGaugeV2Abi,
    functionName: 'claim_rewards',
    args: [user],
  })
}
