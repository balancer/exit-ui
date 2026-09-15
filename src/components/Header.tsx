import { useState } from 'react'
import { useApp } from '../contexts/AppContext'
import { shortAddr } from '../lib/format'

export function Header() {
  const {
    chain,
    chains,
    selectChain,
    account,
    connect,
    disconnect,
    hasWallet,
    rpcUrl,
    setRpcUrl,
  } = useApp()
  const [showRpc, setShowRpc] = useState(false)
  const [rpcInput, setRpcInput] = useState('')
  const [connectError, setConnectError] = useState('')

  const protocolLabel = (c: (typeof chains)[number]) =>
    [c.v1 && 'v1', c.v2 && 'v2', c.v3 && 'v3'].filter(Boolean).join('/')

  return (
    <header style={{ padding: '24px 0 8px' }}>
      <div className="row-between" style={{ flexWrap: 'wrap' }}>
        <div>
          <h1 className="gradient-text" style={{ margin: 0, fontSize: 28 }}>
            Balancer Exit
          </h1>
          <div className="muted">Withdraw Balancer pool & gauge positions</div>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <select value={chain.key} onChange={(e) => selectChain(e.target.value)}>
            {chains.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name} ({protocolLabel(c)}){c.enabled ? '' : ' (dev)'}
              </option>
            ))}
          </select>
          <button className="btn-secondary" onClick={() => setShowRpc((s) => !s)}>
            RPC
          </button>
          {account ? (
            <>
              <span className="badge badge-blue mono">{shortAddr(account)}</span>
              <button
                className="btn-secondary"
                onClick={() => {
                  disconnect()
                  setConnectError('')
                }}
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              className="btn-primary"
              disabled={!hasWallet}
              title={hasWallet ? '' : 'No injected wallet detected'}
              onClick={() => {
                setConnectError('')
                connect().catch((e) => setConnectError(String(e.shortMessage ?? e.message)))
              }}
            >
              Connect wallet
            </button>
          )}
        </div>
      </div>

      {showRpc && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="muted" style={{ marginBottom: 8 }}>
            RPC for {chain.name} (stored locally; used for all reads and added to your wallet when
            switching chains)
          </div>
          <div className="row">
            <input
              style={{ flex: 1 }}
              placeholder={rpcUrl}
              value={rpcInput}
              onChange={(e) => setRpcInput(e.target.value)}
            />
            <button
              className="btn-primary"
              disabled={!rpcInput.trim().startsWith('http')}
              onClick={() => {
                setRpcUrl(rpcInput.trim())
                setRpcInput('')
                setShowRpc(false)
              }}
            >
              Save
            </button>
            <button
              className="btn-secondary"
              onClick={() => {
                setRpcUrl(null)
                setRpcInput('')
              }}
            >
              Reset to default
            </button>
          </div>
          <div className="muted mono" style={{ marginTop: 6 }}>
            current: {rpcUrl}
          </div>
        </div>
      )}
      {connectError && <div className="error-box" style={{ marginTop: 8 }}>{connectError}</div>}
    </header>
  )
}
