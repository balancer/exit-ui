import { useCallback, useState } from 'react'
import type { Hash } from 'viem'
import { useApp } from '../contexts/AppContext'
import { ensureWalletChain, getWalletChainId } from '../lib/wallet'

export type TxStatus =
  | { state: 'idle' }
  | { state: 'pending'; label: string }
  | { state: 'confirming'; hash: Hash; label: string }
  | { state: 'success'; hash: Hash; label: string }
  | { state: 'error'; message: string; label: string }

export function useTransaction() {
  const { chain, publicClient } = useApp()
  const [status, setStatus] = useState<TxStatus>({ state: 'idle' })

  const send = useCallback(
    async (label: string, fn: () => Promise<Hash>): Promise<boolean> => {
      try {
        setStatus({ state: 'pending', label })
        if ((await getWalletChainId()) !== chain.chainId) {
          await ensureWalletChain(chain)
        }
        const hash = await fn()
        setStatus({ state: 'confirming', hash, label })
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        if (receipt.status !== 'success') {
          setStatus({ state: 'error', message: 'Transaction reverted', label })
          return false
        }
        setStatus({ state: 'success', hash, label })
        return true
      } catch (e: any) {
        const message = String(e.shortMessage ?? e.message ?? e)
        setStatus({ state: 'error', message, label })
        return false
      }
    },
    [chain, publicClient]
  )

  const reset = useCallback(() => setStatus({ state: 'idle' }), [])

  return { status, send, reset }
}
