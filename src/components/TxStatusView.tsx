import type { TxStatus } from '../hooks/useTransaction'
import { useApp } from '../contexts/AppContext'

export function TxStatusView({ status }: { status: TxStatus }) {
  const { chain } = useApp()
  if (status.state === 'idle') return null

  if (status.state === 'pending') {
    return (
      <div className="muted row" style={{ marginTop: 8 }}>
        <span className="spinner" /> {status.label}: confirm in wallet...
      </div>
    )
  }
  if (status.state === 'confirming') {
    return (
      <div className="muted row" style={{ marginTop: 8 }}>
        <span className="spinner" /> {status.label}: waiting for confirmation...{' '}
        <a href={`${chain.explorerUrl}/tx/${status.hash}`} target="_blank" rel="noreferrer">
          view tx
        </a>
      </div>
    )
  }
  if (status.state === 'success') {
    return (
      <div className="badge-green badge" style={{ marginTop: 8 }}>
        {status.label} confirmed —{' '}
        <a href={`${chain.explorerUrl}/tx/${status.hash}`} target="_blank" rel="noreferrer">
          view tx
        </a>
      </div>
    )
  }
  return (
    <div className="error-box" style={{ marginTop: 8 }}>
      {status.label} failed: {status.message}
    </div>
  )
}
