import { useEffect, useState } from 'react'
import { useApp } from '../contexts/AppContext'
import { useTransaction } from '../hooks/useTransaction'
import { makeWalletClient } from '../lib/clients'
import { previewRedeemPrincipal, redeemPrincipal } from '../lib/element'
import { fmtAmount, shortAddr } from '../lib/format'
import type { PrincipalPosition } from '../lib/positions'
import { TxStatusView } from './TxStatusView'

export function PrincipalTokenCard({
  position,
  onRedeemed,
}: {
  position: PrincipalPosition
  onRedeemed: () => void
}) {
  const { chain, publicClient, account, readOnly, scanTarget } = useApp()
  const { status, send } = useTransaction()
  const [preview, setPreview] = useState<bigint | null>(null)
  const [previewError, setPreviewError] = useState('')

  useEffect(() => {
    if (!scanTarget) return
    setPreviewError('')
    previewRedeemPrincipal(publicClient, position.tranche, scanTarget, position.balance)
      .then(setPreview)
      .catch((e: any) => {
        setPreview(null)
        setPreviewError(String(e.shortMessage ?? e.message ?? e))
      })
  }, [publicClient, position, scanTarget])

  async function onRedeem() {
    if (!account) return
    const walletClient = makeWalletClient(chain, account)
    const ok = await send('Redeem', () =>
      redeemPrincipal(walletClient, position.tranche, account, position.balance)
    )
    if (ok) onRedeemed()
  }

  const busy = status.state === 'pending' || status.state === 'confirming'

  return (
    <div className="card">
      <div className="row-between" style={{ flexWrap: 'wrap' }}>
        <div>
          <strong>{position.symbol}</strong> <span className="badge">Element principal token</span>
          <div className="muted mono">
            <a href={`${chain.explorerUrl}/address/${position.tranche}`} target="_blank" rel="noreferrer">
              {shortAddr(position.tranche)}
            </a>
          </div>
        </div>
        <div className="mono">{fmtAmount(position.balance, position.decimals)}</div>
      </div>

      <div className="card-inner" style={{ marginTop: 12 }}>
        {preview !== null && (
          <div className="row-between">
            <span>You receive</span>
            <span className="mono">
              {fmtAmount(preview, position.decimals)} {position.underlyingSymbol}
            </span>
          </div>
        )}
        {previewError && (
          <div className="warning-box">Redemption simulation failed: {previewError}</div>
        )}
        <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
          <button
            className="btn-primary"
            disabled={readOnly || !account || busy || preview === null}
            onClick={onRedeem}
          >
            Redeem for {position.underlyingSymbol}
          </button>
          {readOnly && <span className="muted">watch mode — actions disabled</span>}
        </div>
      </div>
      <div className="muted" style={{ marginTop: 8 }}>
        The term has ended: principal tokens redeem 1:1 for the underlying through Element's tranche
        contract.
      </div>
      <TxStatusView status={status} />
    </div>
  )
}
