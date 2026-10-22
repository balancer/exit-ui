// Covers the three Vyper gauge types users stake in:
//   - LiquidityGaugeV5 (Ethereum):      withdraw(uint256,bool), BAL via BalancerMinter.mint(gauge)
//   - RewardsOnlyGauge (L2, 2022):       withdraw(uint256,bool), BAL is a plain reward token
//   - ChildChainGauge v2 (L2, 2023+):    withdraw(uint256) only (the 2nd arg is `_user`, not a claim
//                                        flag), BAL via bal_pseudo_minter().mint(gauge)
// A gauge is a ChildChainGauge iff bal_pseudo_minter() answers. RewardsOnlyGauge has no reward_count().
export const childChainGaugeV2Abi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'arg0', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_value', type: 'uint256' },
      { name: '_claim_rewards', type: 'bool' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_value', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'claim_rewards',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_addr', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'lp_token',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'reward_count',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'reward_tokens',
    stateMutability: 'view',
    inputs: [{ name: 'arg0', type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'claimable_reward',
    stateMutability: 'view',
    inputs: [
      { name: '_user', type: 'address' },
      { name: '_reward_token', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'bal_pseudo_minter',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    // not view (checkpoints), but callable through eth_call / multicall
    type: 'function',
    name: 'claimable_tokens',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

/** BalancerMinter (Ethereum) and L2BalancerPseudoMinter share this entry point. */
export const balMinterAbi = [
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'gauge', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const
