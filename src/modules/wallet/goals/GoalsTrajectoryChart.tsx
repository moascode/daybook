import { useState } from 'react'
import { formatMYR } from '@/lib/utils'
import { shiftMonth } from '@/modules/wallet/dashboard/insights'
import { savedHistory, projectionSeries, etaMonth, type SavedHistoryPoint } from '@/modules/wallet/goals/projection'
import type { Goal, GoalFlow } from '@/types/wallet.types'

interface GoalsTrajectoryChartProps {
  goals: Goal[]
  balances: Record<string, number>
  flows: GoalFlow[]
  flowsReady: boolean
  totalSaved: number
  totalTarget: number
  totalRate: number
  today: string
}

type Range = '1y' | '3y' | 'all'

const PLOT_LEFT = 52
const PLOT_RIGHT = 686
const PLOT_TOP = 12
const PLOT_BOTTOM = 162
const VIEW_HEIGHT = 210
const TICKS = 4
// 10 years, per the spec's "capped at 10 years ahead" rule for the All window.
const MAX_AHEAD_MONTHS = 120

function compactMYR(amount: number): string {
  const abs = Math.abs(amount)
  if (abs < 1000) return formatMYR(abs)
  const thousands = abs / 1000
  const rounded = thousands >= 10 ? Math.round(thousands) : Math.round(thousands * 10) / 10
  return `RM ${rounded}k`
}

/** Whole months from `from` to `to` ('YYYY-MM' each), positive when `to` is later. */
function monthDiff(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  return (ty - fy) * 12 + (tm - fm)
}

function pathFor(points: SavedHistoryPoint[], startMonth: string, totalMonths: number, maxValue: number): string {
  if (points.length === 0) return ''
  const toXY = (p: SavedHistoryPoint) => {
    const x = PLOT_LEFT + (monthDiff(startMonth, p.month) / totalMonths) * (PLOT_RIGHT - PLOT_LEFT)
    const y = PLOT_BOTTOM - (maxValue > 0 ? p.total / maxValue : 0) * (PLOT_BOTTOM - PLOT_TOP)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }
  return `M${points.map(toXY).join(' L')}`
}

/**
 * "Total saved" line chart (FEAT-067 / absorbed FEAT-019): solid actual line
 * reconstructed from today's balances, dashed projection at the current
 * total funding rate, a dashed target line, and a today marker.
 */
export function GoalsTrajectoryChart({
  goals, balances, flows, flowsReady, totalSaved, totalTarget, totalRate, today,
}: GoalsTrajectoryChartProps) {
  const [range, setRange] = useState<Range>('3y')

  const currentMonth = today.slice(0, 7)
  const firstActivityMonth = flows.length > 0 ? [...flows].map((f) => f.month).sort()[0] : currentMonth

  const totalEta = totalRate > 0 ? etaMonth(totalSaved, totalTarget, totalRate, today) : null
  const allEnd = totalEta
    ? (monthDiff(currentMonth, totalEta) > MAX_AHEAD_MONTHS ? shiftMonth(currentMonth, MAX_AHEAD_MONTHS) : totalEta)
    : currentMonth

  const startMonth = range === 'all' ? firstActivityMonth : shiftMonth(currentMonth, range === '1y' ? -12 : -36)
  const endMonth = range === 'all' ? allEnd : shiftMonth(currentMonth, range === '1y' ? 12 : 36)
  const totalMonths = Math.max(1, monthDiff(startMonth, endMonth))

  // Without /goals/flows, `flows` is `[]` — feeding that into savedHistory
  // would draw a flat (wrong) actual line at today's balance for every past
  // month rather than an honest "we don't know". Skip both lines entirely
  // and say so instead; the target line below still has everything it needs.
  const historyPoints = flowsReady ? savedHistory(goals, balances, flows, startMonth, today) : []
  const projectionPoints = flowsReady ? projectionSeries(totalSaved, totalTarget, totalRate, today, endMonth) : []

  const maxValue = Math.max(totalTarget, ...historyPoints.map((p) => p.total), ...projectionPoints.map((p) => p.total), 1) * 1.08
  const ticks = Array.from({ length: TICKS }, (_, i) => (maxValue * i) / (TICKS - 1))

  const actualPath = pathFor(historyPoints, startMonth, totalMonths, maxValue)
  const projectionPath = pathFor(projectionPoints, startMonth, totalMonths, maxValue)
  const targetY = PLOT_BOTTOM - (maxValue > 0 ? totalTarget / maxValue : 0) * (PLOT_BOTTOM - PLOT_TOP)
  const todayX = PLOT_LEFT + (monthDiff(startMonth, currentMonth) / totalMonths) * (PLOT_RIGHT - PLOT_LEFT)
  const todayY = PLOT_BOTTOM - (maxValue > 0 ? totalSaved / maxValue : 0) * (PLOT_BOTTOM - PLOT_TOP)

  // One label per January tick the window spans — never at the window's own
  // start/end unless those happen to land on a January, so a 3y window never
  // shows a partial-year label crammed right next to the next full one.
  // Ticks closer than MIN_YEAR_TICK_GAP viewBox units to the previous label
  // are skipped outright rather than rendered overlapping ("20232024").
  const MIN_YEAR_TICK_GAP = 40
  const yearTicks: { x: number; label: string }[] = []
  let lastTickX = -Infinity
  for (let m = startMonth; monthDiff(startMonth, m) <= totalMonths; m = shiftMonth(m, 1)) {
    if (m.endsWith('-01')) {
      const x = PLOT_LEFT + (monthDiff(startMonth, m) / totalMonths) * (PLOT_RIGHT - PLOT_LEFT)
      if (x - lastTickX >= MIN_YEAR_TICK_GAP) {
        yearTicks.push({ x, label: m.slice(0, 4) })
        lastTickX = x
      }
    }
    if (m === endMonth) break
  }

  return (
    <section className="card card-pad c8" data-testid="goals-trajectory" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="card-head">
        <div>
          <div className="card-title">Total saved</div>
          <div className="card-sub">
            {flowsReady
              ? `Actual to today, projected at the current ${formatMYR(totalRate)} a month`
              : "Couldn't load history — showing the target only (—)"}
          </div>
        </div>
        <div className="segment" role="tablist" style={{ marginLeft: 'auto' }}>
          <button type="button" role="tab" aria-selected={range === '1y'} onClick={() => setRange('1y')}>1y</button>
          <button type="button" role="tab" aria-selected={range === '3y'} onClick={() => setRange('3y')}>3y</button>
          <button type="button" role="tab" aria-selected={range === 'all'} onClick={() => setRange('all')}>All</button>
        </div>
      </div>
      {/* flex:1 lets the chart fill whatever extra height the .dash grid row
          gives this card (it stretches to match its taller row-mate, the
          milestones card) instead of leaving dead space below a
          fixed-height SVG — preserveAspectRatio keeps the chart's own
          proportions as that flexible box resizes. */}
      <div className="chart" style={{ flex: 1, minHeight: 230 }}>
        <svg
          viewBox={`0 0 700 ${VIEW_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ width: '100%', height: '100%' }}
          role="img"
          aria-label={`Savings total ${formatMYR(totalSaved)} today, target ${formatMYR(totalTarget)}.`}
        >
          <g className="chart-grid">
            {ticks.map((t, i) => (
              <line
                key={t}
                x1={PLOT_LEFT} y1={PLOT_BOTTOM - (t / maxValue) * (PLOT_BOTTOM - PLOT_TOP)}
                x2={PLOT_RIGHT} y2={PLOT_BOTTOM - (t / maxValue) * (PLOT_BOTTOM - PLOT_TOP)}
                strokeDasharray={i === 0 ? undefined : '2 4'}
              />
            ))}
          </g>
          <g className="chart-axis" textAnchor="end">
            {ticks.map((t) => (
              <text key={t} x={PLOT_LEFT - 8} y={PLOT_BOTTOM - (t / maxValue) * (PLOT_BOTTOM - PLOT_TOP) + 4}>
                {compactMYR(t)}
              </text>
            ))}
          </g>

          {actualPath && (
            <path d={actualPath} fill="none" stroke="rgb(var(--accent))" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
          )}
          {projectionPath && (
            <path d={projectionPath} fill="none" stroke="rgb(var(--accent))" strokeWidth="2" strokeDasharray="5 5" strokeOpacity=".45" strokeLinecap="round" />
          )}

          <line
            x1={PLOT_LEFT} y1={targetY} x2={PLOT_RIGHT} y2={targetY}
            stroke="rgb(var(--fg-faint))" strokeWidth="1" strokeDasharray="4 4"
          />
          <text x={PLOT_RIGHT} y={targetY - 5} className="chart-axis" textAnchor="end" style={{ fill: 'rgb(var(--fg-subtle))', fontWeight: 600 }}>
            {formatMYR(totalTarget)} target
          </text>

          <line x1={todayX} y1={PLOT_TOP} x2={todayX} y2={PLOT_BOTTOM} stroke="rgb(var(--line-strong))" strokeWidth="1" />
          <text x={todayX} y={PLOT_BOTTOM + 20} className="chart-axis" textAnchor="middle" style={{ fill: 'rgb(var(--fg-subtle))', fontWeight: 600 }}>
            today
          </text>
          <circle cx={todayX} cy={todayY} r="4.5" fill="rgb(var(--surface))" stroke="rgb(var(--accent))" strokeWidth="2.5" />

          <g className="chart-axis" textAnchor="middle">
            {yearTicks.map((t) => (
              <text key={t.label + t.x} x={t.x} y={VIEW_HEIGHT - 12}>{t.label}</text>
            ))}
          </g>
        </svg>
      </div>
    </section>
  )
}
