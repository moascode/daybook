import { useEffect, useState } from 'react'
import { cn, formatMYR } from '@/lib/utils'
import type { BudgetVsActualPoint } from './insights'

interface BudgetVsActualChartProps {
  points: BudgetVsActualPoint[]
  className?: string
}

/** Matches NetWorthHistoryChart's own proportions (accounts/insights.ts) — the two charts sit in the same visual family. */
const PLOT_HEIGHT = 210
const LABEL_HEADROOM = 68
const BAR_AREA_HEIGHT = PLOT_HEIGHT - LABEL_HEADROOM
const AXIS_WIDTH = 48
const MIN_GROUP_PITCH = 56
const TICK_COUNT = 4

function compactMYR(amount: number): string {
  const abs = Math.abs(amount)
  if (abs < 1000) return formatMYR(abs)
  const thousands = abs / 1000
  const rounded = thousands >= 10 ? Math.round(thousands) : Math.round(thousands * 10) / 10
  return `RM ${rounded}k`
}

/**
 * "Beside them, six months of budget-vs-actual" (design.md, R8 Budgets) — a
 * paired bar per month: what's budgeted (today's total, held constant — see
 * insights.ts) against what was actually spent, against only the categories
 * that currently have a budget. Structurally the same chart as
 * `NetWorthHistoryChart` (grow-in bars, hover `.tip`, dashed grid) with a
 * second bar per slot instead of one.
 */
export function BudgetVsActualChart({ points, className }: BudgetVsActualChartProps) {
  const [grown, setGrown] = useState(false)
  const [hovered, setHovered] = useState<number | null>(null)

  useEffect(() => {
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setGrown(true))
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [])

  if (points.length === 0) return null

  const max = Math.max(...points.map((p) => Math.max(p.budgeted, p.actual)), 1)
  // No real minimum (budgets/spend are never negative) — ticks span [0, axisTop],
  // axisTop landing one tick above the tallest bar so LABEL_HEADROOM becomes a
  // real 4th gridline instead of a blank gap (same reasoning as NetWorthHistoryChart).
  const axisTop = max * ((PLOT_HEIGHT - 2) / BAR_AREA_HEIGHT)
  const ticks = Array.from({ length: TICK_COUNT }, (_, i) => (axisTop * i) / (TICK_COUNT - 1))

  return (
    <section className={cn('section', className)} data-testid="budget-vs-actual">
      <div className="section-head">
        <h2 className="section-title">Budget vs. actual</h2>
        <span className="section-sub">Last 6 months</span>
      </div>
      <div className="card card-pad">
        <div
          role="img"
          aria-label={
            `Budget versus actual spend by month, against today's total budget of ${formatMYR(points[0]?.budgeted ?? 0)}. ` +
            `${points.map((p) => `${p.label}: ${formatMYR(p.actual)} actual`).join('; ')}. ` +
            'Hover a month for the exact gap.'
          }
          style={{ display: 'flex', gap: 'var(--s3)' }}
        >
          <div
            style={{
              display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
              height: PLOT_HEIGHT, width: AXIS_WIDTH, flexShrink: 0, textAlign: 'right',
            }}
          >
            {[...ticks].reverse().map((tick) => (
              <span key={tick} className="chart-axis text-fg-faint" style={{ fontSize: 'var(--t-micro)', lineHeight: 1 }}>
                {compactMYR(tick)}
              </span>
            ))}
          </div>

          <div style={{ flex: 1, overflowX: 'auto' }}>
            <div style={{ width: '100%', minWidth: points.length * MIN_GROUP_PITCH }}>
              <div style={{ position: 'relative', height: PLOT_HEIGHT }}>
                {ticks.map((tick) => (
                  <div
                    key={tick}
                    className="chart-grid"
                    style={{ position: 'absolute', left: 0, right: 0, bottom: `${(tick / max) * BAR_AREA_HEIGHT}px`, borderTop: '1px dashed rgb(var(--grid))' }}
                  />
                ))}

                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap: 'var(--s3)' }}>
                  {points.map((p, i) => {
                    const budgetedHeight = grown ? Math.max(2, (p.budgeted / max) * BAR_AREA_HEIGHT) : 0
                    const actualHeight = grown ? Math.max(2, (p.actual / max) * BAR_AREA_HEIGHT) : 0
                    const isLatest = i === points.length - 1
                    const over = p.actual > p.budgeted
                    const gap = p.budgeted - p.actual
                    const tipAlign = i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'center'
                    const tipPosition =
                      tipAlign === 'start' ? { left: 0, transform: 'translate(0, -100%)' }
                      : tipAlign === 'end' ? { left: '100%', transform: 'translate(-100%, -100%)' }
                      : { left: '50%', transform: 'translate(-50%, -100%)' }
                    const tallest = Math.max(budgetedHeight, actualHeight)

                    return (
                      <div
                        key={p.month}
                        data-testid="budget-vs-actual-group"
                        onMouseEnter={() => setHovered(i)}
                        onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
                        style={{
                          flex: 1, position: 'relative', height: '100%',
                          display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 3,
                          zIndex: hovered === i ? 1 : undefined,
                        }}
                      >
                        {hovered === i && (
                          <div className="tip" style={{ ...tipPosition, top: PLOT_HEIGHT - tallest - 10 }}>
                            <div className="big">{formatMYR(p.actual)} actual</div>
                            <div className="sub">
                              {p.label} · {formatMYR(p.budgeted)} budgeted ·{' '}
                              {over ? `${formatMYR(Math.abs(gap))} over` : `${formatMYR(gap)} under`}
                            </div>
                          </div>
                        )}
                        <div
                          data-testid="budget-vs-actual-budgeted-bar"
                          style={{
                            width: '40%',
                            height: budgetedHeight,
                            borderRadius: '3px 3px 1px 1px',
                            background: 'rgb(var(--track))',
                            transition: 'height var(--dur-slow) var(--ease)',
                          }}
                        />
                        <div
                          data-testid="budget-vs-actual-actual-bar"
                          style={{
                            width: '40%',
                            height: actualHeight,
                            borderRadius: '3px 3px 1px 1px',
                            background: over ? 'rgb(var(--neg))' : `rgb(var(--accent) / ${isLatest || hovered === i ? 1 : 0.6})`,
                            transition: 'height var(--dur-slow) var(--ease), background var(--dur-fast) var(--ease)',
                          }}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 'var(--s3)', marginTop: 'var(--s2)' }}>
                {points.map((p, i) => (
                  <span
                    key={p.month}
                    className="chart-axis"
                    style={{
                      flex: 1, textAlign: 'center', fontSize: 'var(--t-micro)',
                      color: i === points.length - 1 ? 'rgb(var(--fg))' : undefined,
                      fontWeight: i === points.length - 1 ? 600 : undefined,
                    }}
                  >
                    {p.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs text-fg-subtle" style={{ marginTop: 'var(--s3)' }}>
          <span className="flex items-center gap-1.5">
            <i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'rgb(var(--track))' }} />
            Budgeted
          </span>
          <span className="flex items-center gap-1.5">
            <i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'rgb(var(--accent))' }} />
            Actual
          </span>
          <span className="flex items-center gap-1.5">
            <i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'rgb(var(--neg))' }} />
            Over budget
          </span>
        </div>
      </div>
    </section>
  )
}
