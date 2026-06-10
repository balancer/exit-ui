import type { Address } from 'viem'
import type { PoolType } from '../config/chains'

export interface TokenInfo {
  address: Address
  symbol: string
  decimals: number
  isPhantomBpt?: boolean
}

export interface V2PoolData {
  address: Address
  poolId: `0x${string}`
  poolType: PoolType
  symbol: string
  name: string
  tokens: TokenInfo[]
}

export interface V3PoolData {
  address: Address
  symbol: string
  name: string
  tokens: TokenInfo[]
}

export interface GaugeData {
  address: Address
  lpToken: Address
  symbol: string
}

export interface ChainData {
  meta: { chainKey: string; scannedAtBlock: number; generatedAt: string }
  v2Pools: V2PoolData[]
  v3Pools: V3PoolData[]
  gauges: GaugeData[]
}

export interface PoolPosition {
  protocolVersion: 2 | 3
  address: Address
  poolId?: `0x${string}` // v2 only
  poolType?: PoolType // v2 only
  symbol: string
  name: string
  tokens: TokenInfo[]
  balance: bigint
  inRecoveryMode: boolean
}

export interface RewardInfo {
  token: Address
  symbol: string
  decimals: number
  claimable: bigint
}

export interface GaugePosition {
  address: Address
  lpToken: Address
  symbol: string
  balance: bigint
  rewards: RewardInfo[]
}

// All committed discovery outputs, keyed by chain key.
const dataModules = import.meta.glob('../config/data/*.json', { eager: true }) as Record<
  string,
  { default: ChainData }
>

export function getChainData(chainKey: string): ChainData | null {
  for (const [path, mod] of Object.entries(dataModules)) {
    if (path.endsWith(`/${chainKey}.json`)) return mod.default
  }
  return null
}
