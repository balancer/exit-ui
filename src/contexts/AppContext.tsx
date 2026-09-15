import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Address, PublicClient } from 'viem'
import { getChain, getRpcUrl, setRpcOverride, visibleChains, type ChainConfig } from '../config/chains'
import { makePublicClient } from '../lib/clients'
import { hasInjectedWallet, onWalletEvents, requestAccounts } from '../lib/wallet'

interface AppContextValue {
  chain: ChainConfig
  chains: ChainConfig[]
  selectChain: (key: string) => void
  publicClient: PublicClient
  rpcUrl: string
  setRpcUrl: (url: string | null) => void

  account: Address | null
  connect: () => Promise<void>
  disconnect: () => void
  hasWallet: boolean

  /** Address being scanned: connected account or watch address. */
  watchAddress: Address | null
  setWatchAddress: (addr: Address | null) => void
  scanTarget: Address | null
  readOnly: boolean
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const chains = useMemo(() => visibleChains(), [])
  const [chainKey, setChainKey] = useState(chains[0]?.key ?? 'mode')
  const [rpcVersion, setRpcVersion] = useState(0)
  const [account, setAccount] = useState<Address | null>(null)
  const [selectAccountOnConnect, setSelectAccountOnConnect] = useState(false)
  const [watchAddress, setWatchAddress] = useState<Address | null>(null)

  const chain = useMemo(() => getChain(chainKey), [chainKey])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const publicClient = useMemo(() => makePublicClient(chain), [chain, rpcVersion])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rpcUrl = useMemo(() => getRpcUrl(chain), [chain, rpcVersion])

  const setRpcUrl = useCallback(
    (url: string | null) => {
      setRpcOverride(chain, url)
      setRpcVersion((v) => v + 1)
    },
    [chain]
  )

  const connect = useCallback(async () => {
    const accounts = await requestAccounts(selectAccountOnConnect)
    setAccount(accounts[0] ?? null)
    setSelectAccountOnConnect(false)
  }, [selectAccountOnConnect])

  const disconnect = useCallback(() => {
    setAccount(null)
    setSelectAccountOnConnect(true)
  }, [])

  useEffect(() => {
    return onWalletEvents({
      accountsChanged: (accounts) => {
        setAccount(accounts[0] ?? null)
        setSelectAccountOnConnect(accounts.length === 0)
      },
    })
  }, [])

  const scanTarget = watchAddress ?? account

  const value: AppContextValue = {
    chain,
    chains,
    selectChain: setChainKey,
    publicClient,
    rpcUrl,
    setRpcUrl,
    account,
    connect,
    disconnect,
    hasWallet: hasInjectedWallet(),
    watchAddress,
    setWatchAddress,
    scanTarget,
    readOnly: watchAddress !== null && watchAddress.toLowerCase() !== account?.toLowerCase(),
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp outside AppProvider')
  return ctx
}
