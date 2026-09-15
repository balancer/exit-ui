import { useCallback, useState } from 'react'
import { useApp } from '../contexts/AppContext'
import { hasChainData, loadChainData, type GaugePosition, type PoolPosition } from '../lib/positions'
import { scanPositions } from '../lib/scanner'

export function usePositions() {
  const { chain, publicClient, scanTarget } = useApp()
  const [pools, setPools] = useState<PoolPosition[]>([])
  const [gauges, setGauges] = useState<GaugePosition[]>([])
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [scanned, setScanned] = useState(false)

  const hasData = hasChainData(chain.key)

  const scan = useCallback(async () => {
    if (!scanTarget || !hasData) return
    setScanning(true)
    setError('')
    try {
      const data = await loadChainData(chain.key)
      if (!data) throw new Error(`No pool list bundled for ${chain.name}`)
      const result = await scanPositions(publicClient, chain, data, scanTarget, setProgress)
      setPools(result.pools)
      setGauges(result.gauges)
      setScanned(true)
    } catch (e: any) {
      setError(String(e.shortMessage ?? e.message ?? e))
    } finally {
      setScanning(false)
      setProgress('')
    }
  }, [publicClient, chain, hasData, scanTarget])

  const addManualPool = useCallback((position: PoolPosition) => {
    setPools((prev) => {
      if (prev.some((p) => p.address.toLowerCase() === position.address.toLowerCase())) return prev
      return [...prev, position]
    })
    setScanned(true)
  }, [])

  const reset = useCallback(() => {
    setPools([])
    setGauges([])
    setScanned(false)
    setError('')
  }, [])

  return { pools, gauges, scanning, progress, error, scanned, scan, addManualPool, reset, hasData }
}
