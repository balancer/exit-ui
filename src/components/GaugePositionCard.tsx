import { useApp } from '../contexts/AppContext'
import { useTransaction } from '../hooks/useTransaction'
import { makeWalletClient } from '../lib/clients'
import { fmtAmount, shortAddr } from '../lib/format'
import { claimGaugeRewards, mintGaugeBal, unstakeFromGauge } from '../lib/gauges'
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
  const hasBal = position.balMinter !== null && position.claimableBal > 0n
  const hasClaims = claimableRewards.length > 0 || hasBal
  const busy = status.state === 'pending' || status.state === 'confirming'

  /** Claim reward tokens and BAL. Returns false as soon as one transaction fails. */
  async function claimAll(walletClient: ReturnType<typeof makeWalletClient>): Promise<boolean> {
    if (!account) return false
    if (claimableRewards.length > 0) {
      const ok = await send('Claim rewards', () => claimGaugeRewards(walletClient, position.address, account))
      if (!ok) return false
    }
    if (hasBal) {
      const ok = await send('Claim BAL', () => mintGaugeBal(walletClient, position.balMinter!, position.address, account))
      if (!ok) return false
    }
    return true
  }

  async function onUnstake() {
    if (!account) return
    const walletClient = makeWalletClient(chain, account)
    let ok: boolean
    if (position.isChildChainGauge) {
      // ChildChainGauge.withdraw cannot claim; claim first, while the position still shows up here
      ok = (await claimAll(walletClient)) &&
        (await send('Unstake', () => unstakeFromGauge(walletClient, position, account, position.balance, false)))
    } else {
      // withdraw(amount, true) pays reward tokens; BAL on Ethereum still comes from the minter
      ok = (await send('Unstake & claim', () => unstakeFromGauge(walletClient, position, account, position.balance, true))) &&
        (!hasBal || (await send('Claim BAL', () => mintGaugeBal(walletClient, position.balMinter!, position.address, account))))
    }
    if (ok) onChanged()
  }

  async function onClaim() {
    if (!account) return
    const walletClient = makeWalletClient(chain, account)
    const ok = await claimAll(walletClient)
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

      {hasClaims && (
        <div className="card-inner" style={{ marginTop: 12 }}>
          <div className="muted" style={{ marginBottom: 4 }}>
            Claimable rewards
          </div>
          {hasBal && (
            <div className="row-between">
              <span>BAL (emissions)</span>
              <span className="mono">{fmtAmount(position.claimableBal, 18)}</span>
            </div>
          )}
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
          {hasClaims ? 'Unstake & claim' : 'Unstake'}
        </button>
        {hasClaims && (
          <button className="btn-secondary" disabled={readOnly || !account || busy} onClick={onClaim}>
            Claim rewards only
          </button>
        )}
        {readOnly && <span className="muted">watch mode — actions disabled</span>}
      </div>
      <div className="muted" style={{ marginTop: 8 }}>
        Unstaking returns the BPT to your wallet — rescan afterwards to exit the pool itself.
        {hasClaims && ' Claims and the unstake are separate transactions; confirm each in your wallet.'}
      </div>
      <TxStatusView status={status} />
    </div>
  )
}
