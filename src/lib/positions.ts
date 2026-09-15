import type { Address } from 'viem'
import type { PoolType, V1PoolKind } from '../config/chains'

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

export interface V1PoolData {
  address: Address
  poolKind: V1PoolKind
  underlyingPool?: Address // smart pools wrap a core BPool
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
  meta: { chainKey: string; scannedAtBlock: number; generatedAt: string; source?: string }
  v1Pools?: V1PoolData[]
  v2Pools: V2PoolData[]
  v3Pools: V3PoolData[]
  gauges: GaugeData[]
}

export interface PoolPosition {
  protocolVersion: 1 | 2 | 3
  address: Address
  v1PoolKind?: V1PoolKind // v1 only
  v1UnderlyingPool?: Address // smart-pool backing BPool
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
const dataModules = import.meta.glob('../config/data/*.json') as Record<
  string,
  () => Promise<{ default: ChainData }>
>

function dataLoader(chainKey: string) {
  return Object.entries(dataModules).find(([path]) => path.endsWith(`/${chainKey}.json`))?.[1]
}

export function hasChainData(chainKey: string): boolean {
  return Boolean(dataLoader(chainKey))
}

export async function loadChainData(chainKey: string): Promise<ChainData | null> {
  const load = dataLoader(chainKey)
  return load ? (await load()).default : null
}
