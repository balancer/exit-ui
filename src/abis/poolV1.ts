export const poolV1Abi = [
  {
    type: 'function',
    name: 'getCurrentTokens',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]' }],
  },
  {
    type: 'function',
    name: 'getBalance',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'totalSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'exitPool',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'poolAmountIn', type: 'uint256' },
      { name: 'minAmountsOut', type: 'uint256[]' },
    ],
    outputs: [],
  },
] as const

export const smartPoolV1Abi = [
  ...poolV1Abi,
  {
    type: 'function',
    name: 'bPool',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
] as const

export const factoryV1Abi = [
  {
    type: 'function',
    name: 'isBPool',
    stateMutability: 'view',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'isCrp',
    stateMutability: 'view',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
] as const
