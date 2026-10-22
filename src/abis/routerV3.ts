// From balancer-v3-monorepo pkg/interfaces/contracts/vault/IRouter.sol. Identical on Router v1
// (20241205-v3-router) and v2 (20250307-v3-router-v2); verified against both on chain.
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
    name: 'queryRemoveLiquidityProportional',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'exactBptAmountIn', type: 'uint256' },
      { name: 'sender', type: 'address' },
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
