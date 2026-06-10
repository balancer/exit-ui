import { useApp } from '../contexts/AppContext'
import { useTransaction } from '../hooks/useTransaction'
import { makeWalletClient } from '../lib/clients'
import { fmtAmount, shortAddr } from '../lib/format'
import { claimGaugeRewards, unstakeFromGauge } from '../lib/gauges'
import type { GaugePosition } from '../lib/positions'
import { TxStatusView } from './TxStatusView'

export function GaugePositionCard({
  position,
  onChanged,
}: {
  position: GaugePosition
  onChanged: () => void
}) {
  const { chain, account, readOnly } = useApp()
  const { status, send } = useTransaction()

  const claimableRewards = position.rewards.filter((r) => r.claimable > 0n)
  const busy = status.state === 'pending' || status.state === 'confirming'

  async function onUnstake() {
    if (!account) return
    const walletClient = makeWalletClient(chain, account)
    const ok = await send('Unstake & claim', () =>
      unstakeFromGauge(walletClient, position.address, account, position.balance, true)
    )
    if (ok) onChanged()
  }

  async function onClaim() {
    if (!account) return
    const walletClient = makeWalletClient(chain, account)
    const ok = await send('Claim rewards', () =>
      claimGaugeRewards(walletClient, position.address, account)
    )
    if (ok) onChanged()
  }

  return (
    <div className="card">
      <div className="row-between" style={{ flexWrap: 'wrap' }}>
        <div>
          <strong>{position.symbol || shortAddr(position.lpToken)}</strong>{' '}
          <span className="badge">staked in gauge</span>
          <div className="muted mono">
            gauge:{' '}
            <a
              href={`${chain.explorerUrl}/address/${position.address}`}
              target="_blank"
              rel="noreferrer"
            >
              {shortAddr(position.address)}
            </a>
          </div>
        </div>
        <div className="mono">{fmtAmount(position.balance, 18)} BPT</div>
      </div>

      {claimableRewards.length > 0 && (
        <div className="card-inner" style={{ marginTop: 12 }}>
          <div className="muted" style={{ marginBottom: 4 }}>
            Claimable rewards
          </div>
          {claimableRewards.map((r) => (
            <div key={r.token} className="row-between">
              <span>{r.symbol}</span>
              <span className="mono">{fmtAmount(r.claimable, r.decimals)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn-primary" disabled={readOnly || !account || busy} onClick={onUnstake}>
          Unstake & claim
        </button>
        {claimableRewards.length > 0 && (
          <button className="btn-secondary" disabled={readOnly || !account || busy} onClick={onClaim}>
            Claim rewards only
          </button>
        )}
        {readOnly && <span className="muted">watch mode — actions disabled</span>}
      </div>
      <div className="muted" style={{ marginTop: 8 }}>
        Unstaking returns the BPT to your wallet — rescan afterwards to exit the pool itself.
      </div>
      <TxStatusView status={status} />
    </div>
  )
}
