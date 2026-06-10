// Vyper ChildChainLiquidityGaugeV2 (from gauges-subgraph/abis/ChildChainLiquidityGaugeV2.json)
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
] as const
