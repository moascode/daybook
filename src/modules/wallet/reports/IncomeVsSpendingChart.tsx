import { parseISO, format } from 'date-fns'
import { formatMYR } from '@/lib/utils'
import { niceStep, type GapSentencePart } from '@/modules/wallet/reports/insights'

interface IncomeVsSpendingChartProps {
  /** The months actually drawn — already capped to the last 12 by the caller ("All" with > 12 months). */
  months: string[]
  incomeValues: number[]
  spendValues: number[]
  anchor: string
  windowLabel: string
  gapSentence: GapSentencePart[]
}

const PLOT_LEFT = 46
const PLOT_RIGHT = 690
const PLOT_TOP = 18
const PLOT_BOTTOM = 168
const VIEW_HEIGHT = 210
const TICKS = 4
const BAR_WIDTH = 20
const BAR_GAP = 2

export function IncomeVsSpendingChart({ months, incomeValues, spendValues, anchor, windowLabel, gapSentence }: IncomeVsSpendingChartProps) {
  const step = niceStep(Math.max(1, ...incomeValues, ...spendValues) / 3)
  const maxValue = step * 3
  const ticks = Array.from({ length: TICKS }, (_, i) => step * i)
  const n = months.length
  const slotWidth = n > 0 ? (PLOT_RIGHT - PLOT_LEFT) / n : 0
  const pairWidth = BAR_WIDTH * 2 + BAR_GAP

  const barHeight = (value: number) => (maxValue > 0 ? (value / maxValue) * (PLOT_BOTTOM - PLOT_TOP) : 0)

  const ariaLabel = `Income ${formatMYR(incomeValues.reduce((a, b) => a + b, 0))} and spending ${formatMYR(spendValues.reduce((a, b) => a + b, 0))} over the ${windowLabel}.`

  return (
    <section className="card card-pad c8" data-testid="income-vs-spending-card">
      <div className="card-head">
        <div>
          <div className="card-title">Income vs spending</div>
          <div className="card-sub">Monthly, {windowLabel}. The gap is what you kept.</div>
        </div>
        <div className="legend" style={{ marginLeft: 'auto' }}>
          <span><i style={{ background: 'rgb(var(--pos))' }} />Income</span>
          <span><i style={{ background: 'rgb(var(--info))' }} />Spending</span>
        </div>
      </div>
      <div className="chart">
        <svg
          viewBox={`0 0 700 ${VIEW_HEIGHT}`}
          style={{ width: '100%', height: 'auto', maxHeight: 250, display: 'block' }}
          role="img" aria-label={ariaLabel} data-testid="income-vs-spending"
        >
          <g className="chart-grid">
            {ticks.map((t, i) => (
              <line
                key={t}
                x1={PLOT_LEFT} y1={PLOT_BOTTOM - barHeight(t)}
                x2={PLOT_RIGHT} y2={PLOT_BOTTOM - barHeight(t)}
                strokeDasharray={i === 0 ? undefined : '2 4'}
              />
            ))}
          </g>
          <g className="chart-axis" textAnchor="end">
            {ticks.map((t) => (
              <text key={t} x={PLOT_LEFT - 8} y={PLOT_BOTTOM - barHeight(t) + 4}>{formatAxisTick(t)}</text>
            ))}
          </g>
          <g>
            {months.map((m, i) => {
              const slotStart = PLOT_LEFT + i * slotWidth
              const pairStart = slotStart + (slotWidth - pairWidth) / 2
              const incomeH = barHeight(incomeValues[i])
              const spendH = barHeight(spendValues[i])
              return (
                <g key={m}>
                  <rect
                    data-testid="ivs-income" data-month={m}
                    x={pairStart} y={PLOT_BOTTOM - incomeH} width={BAR_WIDTH} height={incomeH} rx="3" fill="rgb(var(--pos))"
                  />
                  <rect
                    data-testid="ivs-spending" data-month={m}
                    x={pairStart + BAR_WIDTH + BAR_GAP} y={PLOT_BOTTOM - spendH} width={BAR_WIDTH} height={spendH} rx="3" fill="rgb(var(--info))"
                  />
                </g>
              )
            })}
          </g>
          <g className="chart-axis" textAnchor="middle">
            {months.map((m, i) => (
              <text
                key={m}
                x={PLOT_LEFT + i * slotWidth + slotWidth / 2}
                y={PLOT_BOTTOM + 22}
                fill={m === anchor ? 'rgb(var(--fg))' : undefined}
                fontWeight={m === anchor ? 600 : undefined}
              >
                {format(parseISO(`${m}-01`), 'MMM')}
              </text>
            ))}
          </g>
        </svg>
      </div>
      <div className="divider" />
      <div style={{ fontSize: 'var(--t-sm)', color: 'rgb(var(--fg-subtle))' }} data-testid="gap-sentence">
        {gapSentence.map((part, i) =>
          typeof part === 'string'
            ? <span key={i}>{part}</span>
            : <b key={i} style={{ color: 'rgb(var(--fg))', fontWeight: 600 }}>{part.bold}</b>,
        )}
      </div>
    </section>
  )
}

function formatAxisTick(value: number): string {
  if (value === 0) return 'RM0'
  if (value >= 1000) {
    const k = value / 1000
    return `RM${Number.isInteger(k) ? k : k.toFixed(1)}k`
  }
  return `RM${Math.round(value)}`
}
