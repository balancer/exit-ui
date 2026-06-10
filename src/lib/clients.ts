import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  type Address,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { getRpcUrl, type ChainConfig } from '../config/chains'

export function toViemChain(chain: ChainConfig) {
  return defineChain({
    id: chain.chainId,
    name: chain.name,
    nativeCurrency: { name: chain.nativeSymbol, symbol: chain.nativeSymbol, decimals: 18 },
    rpcUrls: { default: { http: [getRpcUrl(chain)] } },
    blockExplorers: { default: { name: 'Explorer', url: chain.explorerUrl } },
    contracts: { multicall3: { address: chain.multicall3 } },
  })
}

/** Read client — always uses the configured RPC (default or user override), never the wallet's. */
export function makePublicClient(chain: ChainConfig): PublicClient {
  return createPublicClient({
    chain: toViemChain(chain),
    transport: http(getRpcUrl(chain), { timeout: 30_000 }),
    batch: { multicall: { batchSize: 1024, wait: 50 } },
  })
}

export function makeWalletClient(chain: ChainConfig, account: Address): WalletClient {
  const ethereum = (window as any).ethereum
  if (!ethereum) throw new Error('No injected wallet found')
  return createWalletClient({
    account,
    chain: toViemChain(chain),
    transport: custom(ethereum),
  })
}
