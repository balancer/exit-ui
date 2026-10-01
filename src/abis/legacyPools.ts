// Pool types outside the standard Balancer BasePool exit flow (no queryExit, custom userData).

// Xave FXPool (verified source on Sourcify, both FXPool versions)
export const fxPoolAbi = [
  {
    // amounts in derivatives(0)/derivatives(1) order, not vault order
    type: 'function',
    name: 'viewWithdraw',
    stateMutability: 'view',
    inputs: [{ name: 'tokensToBurn', type: 'uint256' }],
    outputs: [{ type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'derivatives',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
] as const

// Element ConvergentCurvePool
export const elementPoolAbi = [
  { type: 'function', name: 'bond', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  {
    type: 'function',
    name: 'totalSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

// Element Tranche (principal token)
export const elementTrancheAbi = [
  {
    type: 'function',
    name: 'withdrawPrincipal',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_amount', type: 'uint256' },
      { name: '_destination', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'unlockTimestamp',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const
