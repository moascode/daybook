import { ceil10, floor10 } from '@/modules/wallet/reports/insights'

interface SavingsRateCardProps {
  months: string[]
  rates: (number | null)[]
  anchorRatePct: number | null
  windowRatePct: number | null
  sentence: string
}

const PLOT_LEFT = 30
const PLOT_RIGHT = 312
const PLOT_TOP = 14
const PLOT_BOTTOM = 110
const VIEW_HEIGHT = 130

export function SavingsRateCard({ months, rates, anchorRatePct, windowRatePct, sentence }: SavingsRateCardProps) {
  const AXIS_FLOOR = -100

  const pct = rates.map((r) => (r === null ? null : r * 100))
  const defined = pct.filter((r): r is number => r !== null)
  // The window (avg) rate is part of the plotted range, not just the monthly
  // points — otherwise a dashed avg line outside the two extremes would draw
  // off the top/bottom of the chart.
  const bounds = windowRatePct === null ? defined : [...defined, windowRatePct]
  const maxRate = bounds.length > 0 ? Math.max(60, ceil10(Math.max(...bounds))) : 60
  const minRate = bounds.length > 0 && Math.min(...bounds) < 0
    ? Math.max(AXIS_FLOOR, floor10(Math.min(...bounds)))
    : 0
  const range = maxRate - minRate || 1

  // Clamp every plotted value into [minRate, maxRate] — the axis floor never
  // goes below −100%, so a month that fell further draws pinned to the
  // bottom edge instead of escaping the viewBox (no NaN/Infinity on screen).
  const yFor = (value: number) => {
    const clamped = Math.min(maxRate, Math.max(minRate, value))
    return PLOT_BOTTOM - ((clamped - minRate) / range) * (PLOT_BOTTOM - PLOT_TOP)
  }

  const points = months
    .map((_, i) => (pct[i] === null ? null : { x: xFor(i, months.length), y: yFor(pct[i]!) }))
    .filter((p): p is { x: number; y: number } => p !== null)
  const path = points.length > 0 ? `M${points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L')}` : ''
  const last = points[points.length - 1]

  const ticks = [minRate, (minRate + maxRate) / 2, maxRate]

  const chipClass = anchorRatePct !== null && windowRatePct !== null && anchorRatePct >= windowRatePct ? 'chip-pos' : 'chip-warn'

  return (
    <section className="card card-pad c4" data-testid="savings-rate-card">
      <div className="card-head">
        <div>
          <div className="card-title">Savings rate</div>
          <div className="card-sub">Share of income kept</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s3)', flexWrap: 'wrap' }}>
        <div className="money" style={{ fontSize: 'var(--t-xl)', fontWeight: 660, letterSpacing: '-.028em', color: anchorRatePct !== null && anchorRatePct >= 0 ? 'rgb(var(--pos-fg))' : 'rgb(var(--neg-fg))' }}>
          {anchorRatePct === null ? '—' : `${anchorRatePct.toFixed(1)}%`}
        </div>
        {anchorRatePct !== null && <span className={`chip ${chipClass}`}>this month</span>}
      </div>
      <div className="chart" style={{ marginTop: 'var(--s3)' }}>
        <svg viewBox={`0 0 320 ${VIEW_HEIGHT}`} style={{ height: 150 }} role="img" aria-label={`Savings rate over the window, averaging ${windowRatePct === null ? '—' : windowRatePct.toFixed(1) + '%'}.`}>
          <g className="chart-grid">
            {ticks.map((t, i) => (
              <line key={t} x1={PLOT_LEFT} y1={yFor(t)} x2={PLOT_RIGHT} y2={yFor(t)} strokeDasharray={i === ticks.length - 1 ? undefined : '2 4'} />
            ))}
          </g>
          <g className="chart-axis" textAnchor="end">
            {ticks.map((t) => (
              <text key={t} x={PLOT_LEFT - 6} y={yFor(t) + 4}>{Math.round(t)}%</text>
            ))}
          </g>
          {windowRatePct !== null && (
            <>
              <line x1={PLOT_LEFT} y1={yFor(windowRatePct)} x2={PLOT_RIGHT} y2={yFor(windowRatePct)} stroke="rgb(var(--fg-faint))" strokeWidth="1" strokeDasharray="4 4" />
              <text x={PLOT_RIGHT} y={yFor(windowRatePct) - 5} className="chart-axis" textAnchor="end" style={{ fill: 'rgb(var(--fg-subtle))' }}>
                avg {windowRatePct.toFixed(1)}%
              </text>
            </>
          )}
          {path && <path d={path} fill="none" stroke="rgb(var(--accent))" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />}
          {last && <circle cx={last.x} cy={last.y} r="4" fill="rgb(var(--surface))" stroke="rgb(var(--accent))" strokeWidth="2.5" />}
        </svg>
      </div>
      <div className="divider" style={{ marginTop: 'auto' }} />
      <div style={{ fontSize: 'var(--t-sm)', color: 'rgb(var(--fg-subtle))' }} data-testid="savings-sentence">{sentence}</div>
    </section>
  )
}

function xFor(index: number, count: number): number {
  if (count <= 1) return (PLOT_LEFT + PLOT_RIGHT) / 2
  return PLOT_LEFT + (index / (count - 1)) * (PLOT_RIGHT - PLOT_LEFT)
}
