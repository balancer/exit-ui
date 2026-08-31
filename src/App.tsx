import { useEffect } from 'react'
import { GaugePositionCard } from './components/GaugePositionCard'
import { Header } from './components/Header'
import { ManualPoolEntry } from './components/ManualPoolEntry'
import { PoolPositionCard } from './components/PoolPositionCard'
import { ScanPanel } from './components/ScanPanel'
import { useApp } from './contexts/AppContext'
import { usePositions } from './hooks/usePositions'

export default function App() {
  const { chain, scanTarget } = useApp()
  const { pools, gauges, scanning, progress, error, scanned, scan, addManualPool, reset, hasData } =
    usePositions()

  // chain or target switched -> stale results
  useEffect(() => {
    reset()
  }, [chain.key, scanTarget, reset])

  return (
    <>
      <Header />

      {!hasData && (
        <div className="warning-box" style={{ marginBottom: 16 }}>
          No pool list bundled for {chain.name} yet. Run{' '}
          <span className="mono">npm run discover -- --chain {chain.key}</span> and rebuild, or add
          pools manually below.
        </div>
      )}

      <ScanPanel scanning={scanning} progress={progress} onScan={scan} />

      {error && <div className="error-box" style={{ marginBottom: 16 }}>{error}</div>}

      {scanned && (
        <>
          <h2 style={{ fontSize: 18 }}>
            Staked positions <span className="badge">{gauges.length}</span>
          </h2>
          {gauges.length === 0 && <div className="muted" style={{ marginBottom: 16 }}>No staked gauge positions found.</div>}
          {gauges.map((g) => (
            <GaugePositionCard key={g.address} position={g} onChanged={scan} />
          ))}

          <h2 style={{ fontSize: 18 }}>
            Pool positions <span className="badge">{pools.length}</span>
          </h2>
          {pools.length === 0 && <div className="muted" style={{ marginBottom: 16 }}>No unstaked pool positions found.</div>}
          {pools.map((p) => (
            <PoolPositionCard key={p.address} position={p} onExited={scan} />
          ))}
        </>
      )}

      <ManualPoolEntry onFound={addManualPool} />

      <footer className="muted" style={{ marginTop: 32, fontSize: 12 }}>
        Withdrawals are proportional. USD pricing is unavailable — amounts are shown as token
        quantities. This site is fully static; it only talks to the RPC you
        configure.
      </footer>
    </>
  )
}
