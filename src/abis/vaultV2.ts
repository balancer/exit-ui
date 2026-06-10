export const vaultV2Abi = [
  {
    type: 'function',
    name: 'getPoolTokens',
    stateMutability: 'view',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [
      { name: 'tokens', type: 'address[]' },
      { name: 'balances', type: 'uint256[]' },
      { name: 'lastChangeBlock', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'getPool',
    stateMutability: 'view',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [
      { name: 'pool', type: 'address' },
      { name: 'specialization', type: 'uint8' },
    ],
  },
  {
    type: 'function',
    name: 'exitPool',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      { name: 'sender', type: 'address' },
      { name: 'recipient', type: 'address' },
      {
        name: 'request',
        type: 'tuple',
        components: [
          { name: 'assets', type: 'address[]' },
          { name: 'minAmountsOut', type: 'uint256[]' },
          { name: 'userData', type: 'bytes' },
          { name: 'toInternalBalance', type: 'bool' },
        ],
      },
    ],
    outputs: [],
  },
] as const
