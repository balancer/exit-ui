import { useState } from 'react'
import { hexToString, isAddress, type Address } from 'viem'
import { erc20Abi, erc20Bytes32MetadataAbi } from '../abis/erc20'
import { useApp } from '../contexts/AppContext'
import type { PoolPosition } from '../lib/positions'
import { resolveV1Pool } from '../lib/v1'
import { resolveV2Pool } from '../lib/v2'
import { resolveV3Pool } from '../lib/v3'

/**
 * Fallback for pools missing from the committed lists:
 * paste a pool address; tries configured protocol versions in chronological order.
 */
export function ManualPoolEntry({ onFound }: { onFound: (p: PoolPosition) => void }) {
  const { chain, publicClient, scanTarget } = useApp()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function lookup() {
    if (!isAddress(input) || !scanTarget) return
    const poolAddress = input as Address
    setBusy(true)
    setError('')
    try {
      const [balance, symbol, name] = await Promise.all([
        publicClient.readContract({ address: poolAddress, abi: erc20Abi, functionName: 'balanceOf', args: [scanTarget] }),
        publicClient.readContract({ address: poolAddress, abi: erc20Abi, functionName: 'symbol' }).catch(() => ''),
        publicClient.readContract({ address: poolAddress, abi: erc20Abi, functionName: 'name' }).catch(() => ''),
      ])

      const tokenMeta = async (addrs: Address[]) =>
        Promise.all(
          addrs.map(async (a) => {
            const symbol = await publicClient
              .readContract({ address: a, abi: erc20Abi, functionName: 'symbol' })
              .catch(async () => {
                const bytes = await publicClient
                  .readContract({ address: a, abi: erc20Bytes32MetadataAbi, functionName: 'symbol' })
                  .catch(() => null)
                return bytes ? hexToString(bytes, { size: 32 }) : a.slice(0, 8)
              })
            return {
              address: a,
              symbol,
              decimals: Number(
                await publicClient
                  .readContract({ address: a, abi: erc20Abi, functionName: 'decimals' })
                  .catch(() => 18)
              ),
              isPhantomBpt: a.toLowerCase() === poolAddress.toLowerCase(),
            }
          })
        )

      if (chain.v1) {
        try {
          const v1 = await resolveV1Pool(publicClient, chain, poolAddress)
          onFound({
            protocolVersion: 1,
            address: poolAddress,
            v1PoolKind: v1.poolKind,
            v1UnderlyingPool: v1.underlyingPool,
            symbol,
            name,
            tokens: await tokenMeta(v1.tokens),
            balance,
            inRecoveryMode: false,
          })
          setInput('')
          return
        } catch {
          // not a factory-created v1 pool, try v2
        }
      }

      if (chain.v2) {
        try {
          const v2 = await resolveV2Pool(publicClient, chain, poolAddress)
          onFound({
            protocolVersion: 2,
            address: poolAddress,
            poolId: v2.poolId,
            // unknown factory: assume composable when the pool holds its own BPT, else weighted-style
            poolType: v2.tokens.some((t) => t.toLowerCase() === poolAddress.toLowerCase())
              ? 'composableStable'
              : 'weighted',
            symbol,
            name,
            tokens: await tokenMeta(v2.tokens),
            balance,
            inRecoveryMode: v2.inRecoveryMode,
          })
          setInput('')
          return
        } catch {
          // not a v2 pool, try v3
        }
      }
      if (chain.v3) {
        const v3 = await resolveV3Pool(publicClient, chain, poolAddress)
        onFound({
          protocolVersion: 3,
          address: poolAddress,
          symbol,
          name,
          tokens: await tokenMeta(v3.tokens),
          balance,
          inRecoveryMode: v3.inRecoveryMode,
        })
        setInput('')
        return
      }
      setError('Address is not a Balancer pool on this chain')
    } catch (e: any) {
      setError(`Not recognized as a Balancer pool: ${String(e.shortMessage ?? e.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="muted" style={{ marginBottom: 8 }}>
        Pool missing from the scan? Paste its address:
      </div>
      <div className="row">
        <input
          style={{ flex: 1 }}
          className="mono"
          placeholder="0x..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="btn-secondary" disabled={!isAddress(input) || busy || !scanTarget} onClick={lookup}>
          {busy ? 'Looking up...' : 'Add pool'}
        </button>
      </div>
      {error && <div className="error-box" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  )
}
