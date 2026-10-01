import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { maxUint256 } from 'viem'
import { useApp } from '../contexts/AppContext'
import { useTransaction } from '../hooks/useTransaction'
import { makeWalletClient } from '../lib/clients'
import { applySlippage, fmtAmount, parseAmount, shortAddr } from '../lib/format'
import type { PoolPosition } from '../lib/positions'
import { emergencyV1Quote, executeV1Exit, queryV1Exit, type V1ExitQuote } from '../lib/v1'
import { emergencyV2Quote, executeV2Exit, queryV2Exit, v2ExitMode, type V2ExitQuote } from '../lib/v2'
import {
  approveV3Router,
  emergencyV3Quote,
  enableV3RecoveryMode,
  executeV3Exit,
  getV3Allowance,
  isV3PoolInRecoveryMode,
  queryV3Exit,
  type V3ExitQuote,
} from '../lib/v3'
import { TxStatusView } from './TxStatusView'

export function PoolPositionCard({
  position: scanned,
  onExited,
}: {
  position: PoolPosition
  onExited: () => void
}) {
  const { chain, publicClient, account, readOnly, scanTarget } = useApp()
  const { status, send } = useTransaction()

  const [amountInput, setAmountInput] = useState('')
  const [slippage, setSlippage] = useState('1')
  const [emergency, setEmergency] = useState(false)
  const [quote, setQuote] = useState<V1ExitQuote | V2ExitQuote | V3ExitQuote | null>(null)
  const [quoteError, setQuoteError] = useState('')
  const [quoting, setQuoting] = useState(false)
  const [allowance, setAllowance] = useState<bigint | null>(null)
  const debounceRef = useRef<number>()

  // v3 recovery mode can be enabled from this card; track it locally so no rescan is needed
  const [inRecoveryMode, setInRecoveryMode] = useState(scanned.inRecoveryMode)
  useEffect(() => setInRecoveryMode(scanned.inRecoveryMode), [scanned.inRecoveryMode])
  const position = useMemo(() => ({ ...scanned, inRecoveryMode }), [scanned, inRecoveryMode])

  const isV1 = position.protocolVersion === 1
  const isV2 = position.protocolVersion === 2
  const isV3 = position.protocolVersion === 3
  const mode = isV1
    ? 'proportional'
    : isV2
      ? v2ExitMode(position)
      : position.inRecoveryMode
        ? 'recovery'
        : position.paused
          ? 'needsRecovery'
          : 'proportional'
  const bptIn = amountInput ? parseAmount(amountInput, 18) : position.balance
  const validAmount = bptIn !== null && bptIn > 0n && bptIn <= position.balance
  const slippagePct = Number(slippage) >= 0 ? Number(slippage) : 1
  // Element exits encode the quoted amounts themselves, so there is no zero-minimum fallback
  const quoteRequired = position.poolType === 'element'

  const refreshQuote = useCallback(async () => {
    if (!validAmount || !scanTarget || (mode !== 'proportional' && mode !== 'recovery')) return
    setQuoting(true)
    setQuoteError('')
    try {
      if (isV1) {
        setQuote(await queryV1Exit(publicClient, position, scanTarget, bptIn!))
      } else if (isV2) {
        setQuote(await queryV2Exit(publicClient, chain, position, scanTarget, bptIn!, mode))
      } else {
        setQuote(await queryV3Exit(publicClient, chain, position, bptIn!))
        if (account) setAllowance(await getV3Allowance(publicClient, chain, position.address, account))
      }
    } catch (e: any) {
      setQuote(null)
      setQuoteError(String(e.shortMessage ?? e.message ?? e))
    } finally {
      setQuoting(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicClient, chain, position, scanTarget, account, bptIn, mode, isV1, isV2, validAmount])

  useEffect(() => {
    window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(refreshQuote, 400)
    return () => window.clearTimeout(debounceRef.current)
  }, [refreshQuote])

  const needsApproval =
    isV3 && account && allowance !== null && validAmount && allowance < bptIn!

  async function onApprove() {
    if (!account || !validAmount) return
    const walletClient = makeWalletClient(chain, account)
    const ok = await send('Approve', () =>
      approveV3Router(walletClient, chain, position.address, account, maxUint256)
    )
    if (ok) setAllowance(await getV3Allowance(publicClient, chain, position.address, account))
  }

  async function onEnableRecovery() {
    if (!account) return
    const walletClient = makeWalletClient(chain, account)
    const ok = await send('Enable recovery mode', () =>
      enableV3RecoveryMode(walletClient, chain, position.address, account)
    )
    if (ok) setInRecoveryMode(await isV3PoolInRecoveryMode(publicClient, chain, position.address))
  }

  async function onExit() {
    if (!account || !validAmount) return
    if (mode !== 'proportional' && mode !== 'recovery') return
    if (!quote && (!emergency || quoteRequired)) return
    // simulation failed -> emergency-only path with zero mins
    const effectiveQuote =
      quote ??
      (isV1
        ? emergencyV1Quote(position)
        : isV2
          ? emergencyV2Quote(position, bptIn!, mode)
          : emergencyV3Quote(position))
    const walletClient = makeWalletClient(chain, account)
    const ok = await send('Exit', () =>
      isV1
        ? executeV1Exit(
            walletClient,
            position,
            account,
            bptIn!,
            effectiveQuote as V1ExitQuote,
            slippagePct,
            emergency
          )
        : isV2
        ? executeV2Exit(walletClient, chain, position, account, effectiveQuote as V2ExitQuote, slippagePct, emergency)
        : executeV3Exit(walletClient, chain, position, account, bptIn!, effectiveQuote as V3ExitQuote, slippagePct, emergency)
    )
    if (ok) onExited()
  }

  const displayTokens = position.tokens.filter((t) => !t.isPhantomBpt)
  const quoteZero = quote && quote.amountsOut.every((a) => a === 0n)

  return (
    <div className="card">
      <div className="row-between" style={{ flexWrap: 'wrap' }}>
        <div>
          <strong>{position.symbol || shortAddr(position.address)}</strong>{' '}
          <span className="badge">v{position.protocolVersion}</span>{' '}
          {position.v1PoolKind && <span className="badge">{position.v1PoolKind}</span>}{' '}
          {position.poolType && <span className="badge">{position.poolType}</span>}{' '}
          {position.paused && <span className="badge badge-orange">paused</span>}{' '}
          {position.inRecoveryMode && <span className="badge badge-orange">recovery mode</span>}
          <div className="muted">{position.name}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="mono">{fmtAmount(position.balance, 18)} BPT</div>
          <a
            className="muted mono"
            href={`${chain.explorerUrl}/address/${position.address}`}
            target="_blank"
            rel="noreferrer"
          >
            {shortAddr(position.address)}
          </a>
        </div>
      </div>

      {mode === 'unsupported' ? (
        <div className="warning-box" style={{ marginTop: 12 }}>
          This {position.poolType} pool only supports exits while in recovery mode, and it is not in
          recovery mode. Proportional exit is not possible here.
        </div>
      ) : mode === 'paused' ? (
        <div className="error-box" style={{ marginTop: 12 }}>
          This pool is paused and not in recovery mode. Exits (including emergency exits) revert
          until Balancer governance enables recovery mode for it — on v2 this is a permissioned
          action and cannot be triggered from here.
        </div>
      ) : mode === 'needsRecovery' ? (
        <div className="card-inner" style={{ marginTop: 12 }}>
          <div className="warning-box">
            This pool is paused and not in recovery mode, so proportional exits revert. While the pool
            is paused, anyone can enable recovery mode, which unlocks a proportional recovery exit.
          </div>
          <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
            <button
              className="btn-primary"
              disabled={readOnly || !account || status.state === 'pending' || status.state === 'confirming'}
              onClick={onEnableRecovery}
            >
              Enable recovery mode
            </button>
            {readOnly && <span className="muted">watch mode — actions disabled</span>}
          </div>
          <TxStatusView status={status} />
        </div>
      ) : (
        <div className="card-inner" style={{ marginTop: 12 }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <input
              style={{ flex: 1, minWidth: 160 }}
              placeholder={`amount (max ${fmtAmount(position.balance, 18)})`}
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
            />
            <button className="btn-secondary" onClick={() => setAmountInput('')}>
              Max
            </button>
            <label className="row muted">
              slippage&nbsp;
              <input
                style={{ width: 60 }}
                value={slippage}
                onChange={(e) => setSlippage(e.target.value)}
              />
              %
            </label>
          </div>

          {amountInput && !validAmount && (
            <div className="error-box" style={{ marginTop: 8 }}>
              Invalid amount (max {fmtAmount(position.balance, 18)})
            </div>
          )}

          {quoting && (
            <div className="muted row" style={{ marginTop: 8 }}>
              <span className="spinner" /> simulating exit...
            </div>
          )}

          {quoteError && (
            <div className="warning-box" style={{ marginTop: 8 }}>
              Exit simulation failed: {quoteError}
              <br />
              {quoteRequired
                ? 'This pool type can only exit with a successful simulation.'
                : 'You can still try an emergency exit (no minimum amounts).'}
            </div>
          )}

          {quote && !quoting && (
            <table className="amounts" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Expected</th>
                  <th>Minimum ({emergency ? 'none' : `${slippagePct}% slippage`})</th>
                </tr>
              </thead>
              <tbody>
                {position.tokens.map((t, i) =>
                  t.isPhantomBpt ? null : (
                    <tr key={t.address}>
                      <td>{t.symbol}</td>
                      <td className="mono">{fmtAmount(quote.amountsOut[i] ?? 0n, t.decimals)}</td>
                      <td className="mono">
                        {emergency
                          ? '0'
                          : fmtAmount(applySlippage(quote.amountsOut[i] ?? 0n, slippagePct), t.decimals)}
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          )}

          {quoteZero && (
            <div className="warning-box" style={{ marginTop: 8 }}>
              Simulation returns zero for all tokens — this position appears to have no redeemable
              value. Exiting will burn the BPT for nothing.
            </div>
          )}

          <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
            <label className="row muted" title="Submit with zero minimum amounts — no slippage protection">
              <input
                type="checkbox"
                checked={emergency}
                onChange={(e) => setEmergency(e.target.checked)}
              />
              emergency mode
            </label>
            {needsApproval && (
              <button className="btn-primary" disabled={readOnly} onClick={onApprove}>
                Approve router
              </button>
            )}
            <button
              className={emergency ? 'btn-danger' : 'btn-primary'}
              disabled={
                readOnly ||
                !account ||
                !validAmount ||
                (!quote && (!emergency || quoteRequired)) ||
                Boolean(needsApproval) ||
                status.state === 'pending' ||
                status.state === 'confirming'
              }
              onClick={onExit}
            >
              {emergency ? 'Emergency exit' : 'Exit pool'}
            </button>
            {readOnly && <span className="muted">watch mode — actions disabled</span>}
          </div>
          {emergency && (
            <div className="warning-box" style={{ marginTop: 8 }}>
              Emergency mode submits with minAmountsOut = 0. You accept whatever the pool returns —
              no sandwich/slippage protection.
            </div>
          )}
          <TxStatusView status={status} />
        </div>
      )}

      <div className="muted" style={{ marginTop: 8 }}>
        Tokens: {displayTokens.map((t) => t.symbol).join(', ')} — withdrawals are proportional; you
        receive wrapped native tokens (no auto-unwrap).
        {position.poolType === 'element' &&
          ' The principal token (ePyv…) you receive has matured: rescan after exiting to redeem it for the underlying.'}
      </div>
    </div>
  )
}
