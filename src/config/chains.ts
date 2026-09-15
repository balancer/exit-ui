import type { Address } from 'viem'
import registry from './registry.json'

export type PoolType =
  | 'weighted'
  | 'stable'
  | 'composableStable'
  | 'phantomStable'
  | 'linear'
  | 'gyro'
  | 'lbp'
  | 'managed'

export interface FactoryConfig {
  name: string
  address: Address
  startBlock: number
  poolType: PoolType
}

export interface GaugeFactoryConfig {
  name: string
  address: Address
  startBlock: number
}

export type V1PoolKind = 'core' | 'smart'

export interface ChainConfig {
  key: string
  chainId: number
  name: string
  defaultRpcUrl: string
  explorerUrl: string
  nativeSymbol: string
  multicall3: Address
  logsMaxRange: number
  deprecated: boolean
  enabled: boolean
  v1?: {
    startBlock: number
    factory: Address
    crpFactory: Address
  }
  v2?: {
    vault: Address
    startBlock: number
    balancerQueries: Address
    factories: FactoryConfig[]
    gaugeFactories: GaugeFactoryConfig[]
  }
  v3?: {
    vault: Address
    startBlock: number
    router: Address | null
  }
}

export const CHAINS = registry as unknown as Record<string, ChainConfig>

export function isDevMode(): boolean {
  return import.meta.env.DEV || new URLSearchParams(window.location.search).has('dev')
}

/** Production chains shown in the selector, plus testnets in dev mode. */
export function visibleChains(): ChainConfig[] {
  const all = Object.values(CHAINS)
  return isDevMode() ? all : all.filter((c) => c.enabled)
}

export function getChain(key: string): ChainConfig {
  const chain = CHAINS[key]
  if (!chain) throw new Error(`Unknown chain: ${key}`)
  return chain
}

const RPC_STORAGE_PREFIX = 'rpc:'

export function getRpcUrl(chain: ChainConfig): string {
  return localStorage.getItem(RPC_STORAGE_PREFIX + chain.key) || chain.defaultRpcUrl
}

export function setRpcOverride(chain: ChainConfig, url: string | null) {
  if (url) localStorage.setItem(RPC_STORAGE_PREFIX + chain.key, url)
  else localStorage.removeItem(RPC_STORAGE_PREFIX + chain.key)
}
