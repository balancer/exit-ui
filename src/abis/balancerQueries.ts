// From b-sdk/src/abi/balancerQueries.ts
export const balancerQueriesAbi = [
  {
    type: 'function',
    name: 'queryExit',
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
    outputs: [
      { name: 'bptIn', type: 'uint256' },
      { name: 'amountsOut', type: 'uint256[]' },
    ],
  },
] as const
