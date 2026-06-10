import { formatUnits, parseUnits } from 'viem'

/** Human-readable token amount: trims to a sensible precision. */
export function fmtAmount(raw: bigint, decimals: number): string {
  const s = formatUnits(raw, decimals)
  const n = Number(s)
  if (n === 0) return '0'
  if (n < 0.0001) return s // show full precision for dust
  if (n < 1) return n.toFixed(6).replace(/\.?0+$/, '')
  if (n < 1000) return n.toFixed(4).replace(/\.?0+$/, '')
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function parseAmount(input: string, decimals: number): bigint | null {
  try {
    const v = parseUnits(input.trim() as `${number}`, decimals)
    return v >= 0n ? v : null
  } catch {
    return null
  }
}

export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

/** minAmountOut = expected * (1 - slippagePct/100) */
export function applySlippage(expected: bigint, slippagePct: number): bigint {
  const bps = BigInt(Math.round(slippagePct * 100))
  return (expected * (10_000n - bps)) / 10_000n
}
