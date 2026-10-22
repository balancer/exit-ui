import type { Address, Hash, WalletClient } from 'viem'
import { balMinterAbi, childChainGaugeV2Abi } from '../abis/childChainGaugeV2'
import type { GaugePosition } from './positions'

/**
 * Unstake BPT from a gauge. LiquidityGaugeV5 / RewardsOnlyGauge take a claim flag that also pays
 * out reward tokens; ChildChainGauge only has withdraw(uint256) (its optional 2nd arg is `_user`),
 * so rewards and BAL must be claimed separately there (see claimGaugeRewards / mintGaugeBal).
 */
export async function unstakeFromGauge(
  walletClient: WalletClient,
  position: GaugePosition,
  user: Address,
  amount: bigint,
  claimRewards: boolean
): Promise<Hash> {
  const base = { chain: walletClient.chain, account: user, address: position.address, abi: childChainGaugeV2Abi } as const
  if (position.isChildChainGauge) {
    return walletClient.writeContract({ ...base, functionName: 'withdraw', args: [amount] })
  }
  return walletClient.writeContract({ ...base, functionName: 'withdraw', args: [amount, claimRewards] })
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

/** BAL emissions: BalancerMinter.mint(gauge) on Ethereum, L2BalancerPseudoMinter.mint(gauge) on L2s. */
export async function mintGaugeBal(
  walletClient: WalletClient,
  minter: Address,
  gauge: Address,
  user: Address
): Promise<Hash> {
  return walletClient.writeContract({
    chain: walletClient.chain,
    account: user,
    address: minter,
    abi: balMinterAbi,
    functionName: 'mint',
    args: [gauge],
  })
}
