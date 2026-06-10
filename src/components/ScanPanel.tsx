import { useState } from 'react'
import { isAddress, type Address } from 'viem'
import { useApp } from '../contexts/AppContext'
import { shortAddr } from '../lib/format'

export function ScanPanel({
  scanning,
  progress,
  onScan,
}: {
  scanning: boolean
  progress: string
  onScan: () => void
}) {
  const { account, scanTarget, watchAddress, setWatchAddress } = useApp()
  const [watchInput, setWatchInput] = useState('')

  return (
    <div className="card">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn-primary" disabled={!scanTarget || scanning} onClick={onScan}>
          {scanning ? 'Scanning...' : `Scan positions${scanTarget ? ` (${shortAddr(scanTarget)})` : ''}`}
        </button>
        <input
          style={{ flex: 1, minWidth: 220 }}
          className="mono"
          placeholder="...or watch any address (read-only)"
          value={watchInput}
          onChange={(e) => setWatchInput(e.target.value)}
        />
        <button
          className="btn-secondary"
          disabled={!isAddress(watchInput)}
          onClick={() => setWatchAddress(watchInput as Address)}
        >
          Watch
        </button>
        {watchAddress && (
          <button className="btn-secondary" onClick={() => { setWatchAddress(null); setWatchInput('') }}>
            Clear watch ({shortAddr(watchAddress)})
          </button>
        )}
      </div>
      {!account && !watchAddress && (
        <div className="muted" style={{ marginTop: 8 }}>
          Connect a wallet or enter an address to scan.
        </div>
      )}
      {scanning && progress && (
        <div className="muted row" style={{ marginTop: 8 }}>
          <span className="spinner" /> {progress}
        </div>
      )}
    </div>
  )
}
