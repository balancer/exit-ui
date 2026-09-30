export const basePoolV2Abi = [
  {
    type: 'function',
    name: 'getPoolId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'inRecoveryMode',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bool' }],
  },
  {
    // TemporarilyPausable: `paused` is the effective state (false once the buffer period ends)
    type: 'function',
    name: 'getPausedState',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'paused', type: 'bool' },
      { name: 'pauseWindowEndTime', type: 'uint256' },
      { name: 'bufferPeriodEndTime', type: 'uint256' },
    ],
  },
] as const
