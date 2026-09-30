// From docs-v3 vault-api / b-sdk vaultV3 ABIs
export const vaultV3Abi = [
  {
    type: 'function',
    name: 'getPoolTokens',
    stateMutability: 'view',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [{ name: 'tokens', type: 'address[]' }],
  },
  {
    type: 'function',
    name: 'isPoolInRecoveryMode',
    stateMutability: 'view',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'isPoolRegistered',
    stateMutability: 'view',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    // VaultExtension: effective state (false once the buffer period ends)
    type: 'function',
    name: 'isPoolPaused',
    stateMutability: 'view',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'isVaultPaused',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bool' }],
  },
  {
    // VaultAdmin (reached through the Vault's fallback): permissionless while the pool or Vault is paused
    type: 'function',
    name: 'enableRecoveryMode',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [],
  },
] as const
