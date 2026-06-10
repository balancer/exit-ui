// From b-sdk/src/abi/balancerRouter.ts and docs-v3 router-api.md.
// removeLiquidityRecovery exists in two versions: older routers take (pool, bptIn),
// current routers take (pool, bptIn, minAmountsOut). Both overloads included.
export const routerV3Abi = [
  {
    type: 'function',
    name: 'removeLiquidityProportional',
    stateMutability: 'payable',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'exactBptAmountIn', type: 'uint256' },
      { name: 'minAmountsOut', type: 'uint256[]' },
      { name: 'wethIsEth', type: 'bool' },
      { name: 'userData', type: 'bytes' },
    ],
    outputs: [{ name: 'amountsOut', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'removeLiquidityRecovery',
    stateMutability: 'payable',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'exactBptAmountIn', type: 'uint256' },
      { name: 'minAmountsOut', type: 'uint256[]' },
    ],
    outputs: [{ name: 'amountsOut', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'removeLiquidityRecovery',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'exactBptAmountIn', type: 'uint256' },
    ],
    outputs: [{ name: 'amountsOut', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'queryRemoveLiquidityProportional',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'exactBptAmountIn', type: 'uint256' },
      { name: 'userData', type: 'bytes' },
    ],
    outputs: [{ name: 'amountsOut', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'queryRemoveLiquidityRecovery',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'exactBptAmountIn', type: 'uint256' },
    ],
    outputs: [{ name: 'amountsOut', type: 'uint256[]' }],
  },
] as const
