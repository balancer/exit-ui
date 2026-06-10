import type { Address } from 'viem'
import { getRpcUrl, type ChainConfig } from '../config/chains'

function ethereum() {
  const eth = (window as any).ethereum
  if (!eth) throw new Error('No injected wallet found. Install MetaMask, Rabby or similar.')
  return eth
}

export function hasInjectedWallet(): boolean {
  return Boolean((window as any).ethereum)
}

export async function requestAccounts(): Promise<Address[]> {
  return ethereum().request({ method: 'eth_requestAccounts' })
}

export async function getWalletChainId(): Promise<number> {
  const hex: string = await ethereum().request({ method: 'eth_chainId' })
  return Number(hex)
}

/** Switch the wallet to the target chain, adding it (with the configured RPC) if unknown. */
export async function ensureWalletChain(chain: ChainConfig): Promise<void> {
  const eth = ethereum()
  const chainIdHex = `0x${chain.chainId.toString(16)}`
  try {
    await eth.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    })
  } catch (e: any) {
    // 4902: unknown chain -> add it using the user's configured RPC
    if (e?.code === 4902 || /unrecognized|not added/i.test(String(e?.message))) {
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: chainIdHex,
            chainName: chain.name,
            nativeCurrency: { name: chain.nativeSymbol, symbol: chain.nativeSymbol, decimals: 18 },
            rpcUrls: [getRpcUrl(chain)],
            blockExplorerUrls: [chain.explorerUrl],
          },
        ],
      })
    } else {
      throw e
    }
  }
}

export function onWalletEvents(handlers: {
  accountsChanged?: (accounts: Address[]) => void
  chainChanged?: (chainIdHex: string) => void
}): () => void {
  const eth = (window as any).ethereum
  if (!eth?.on) return () => {}
  const acc = handlers.accountsChanged ?? (() => {})
  const ch = handlers.chainChanged ?? (() => {})
  eth.on('accountsChanged', acc)
  eth.on('chainChanged', ch)
  return () => {
    eth.removeListener?.('accountsChanged', acc)
    eth.removeListener?.('chainChanged', ch)
  }
}
