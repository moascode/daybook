import { formatMYR, formatAxisMYR } from '@/lib/utils'

interface SpendPaceProps {
  /** Optional grid-span / layout class forwarded to the root `<section>`. */
  className?: string
  /** Spend so far in the selected period. */
  spent: number
  /** The same measurement over the comparison window. */
  usual: number
  /** Cumulative spend per day, index 0 first. Length = days elapsed. */
  curve: number[]
  /** The comparison curve, aligned to the same day offsets. */
  baseline: number[]
  /** Where the period lands at the current rate. Only meaningful for an in-progress month. */
  projected?: number
  /** The comparison window's own full total (a full month's average, or a full range's total). */
  comparisonTotal: number
  /** Days elapsed (equals the period length once it's complete or isn't "in progress"). */
  elapsedDays: number
  periodLabel: string
  /** False whenever there is nothing left to project: a finished month, or any range period. */
  inProgress: boolean
  /** How many windows the comparison averages. 0 = no history yet. */
  comparisonCount: number
  /** e.g. "3-month average" or "same length before" — inserted into "Usual ({...})". */
  comparisonDescription: string
  /** Full text for the delta chip and the "usual by ..." aria clause, e.g. "usual by day 18" or "your usual for this period". */
  comparisonClause: string
  /** Maps a 0-based day offset to its axis label. Defaults to 1-based day-of-period numbering. */
  formatDay?: (offset: number) => string | number
}

const VB_W = 730
const VB_H = 210
const PLOT_LEFT = 44
const PLOT_RIGHT = 712
const PLOT_TOP = 10
const PLOT_BOTTOM = 162

/** Rounds up to a "nice" axis ceiling — 1/2/5 × a power of ten. */
function niceCeil(value: number): number {
  if (value <= 0) return 100
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return step * magnitude
}

function buildPath(values: (number | null)[], xOf: (i: number) => number, yOf: (v: number) => number): string {
  let d = ''
  let started = false
  values.forEach((v, i) => {
    if (v === null) return
    d += `${started ? 'L' : 'M'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)} `
    started = true
  })
  return d.trim()
}

/**
 * "Spend pace" — a literal port of the mockup's hand-drawn SVG chart: a
 * gradient-filled actual line, a dashed usual line running the full period,
 * a dashed projection from today to month end, a "today" marker, and a
 * floating tooltip pinned to the current point.
 */
export function SpendPace({
  className,
  spent,
  usual,
  curve,
  baseline,
  projected,
  comparisonTotal,
  elapsedDays,
  periodLabel,
  inProgress,
  comparisonCount,
  comparisonDescription,
  comparisonClause,
  formatDay = (offset) => offset + 1,
}: SpendPaceProps) {
  const length = Math.max(baseline.length, curve.length, 1)
  const hasComparison = comparisonCount > 0 && usual > 0
  const delta = spent - usual
  const over = delta >= 0
  const showProjection = inProgress && projected !== undefined

  const xOf = (i: number) => PLOT_LEFT + (length <= 1 ? 0 : (i / (length - 1)) * (PLOT_RIGHT - PLOT_LEFT))
  const yMax = niceCeil(Math.max(...curve, ...baseline, projected ?? 0, 1))
  const yOf = (v: number) => PLOT_BOTTOM - Math.min(1, v / yMax) * (PLOT_BOTTOM - PLOT_TOP)

  const actualValues: (number | null)[] = Array.from({ length }, (_, i) => (i < curve.length ? curve[i] : null))
  const baselineValues: (number | null)[] = Array.from({ length }, (_, i) => baseline[i] ?? null)
  const projectedValues: (number | null)[] = showProjection
    ? Array.from({ length }, (_, i) =>
        i === curve.length - 1 ? spent : i === length - 1 ? (projected as number) : null,
      )
    : []

  const actualPath = buildPath(actualValues, xOf, yOf)
  const baselinePath = hasComparison ? buildPath(baselineValues, xOf, yOf) : ''
  const projectedPath = showProjection ? buildPath(projectedValues, xOf, yOf) : ''
  const areaPath =
    curve.length > 0
      ? `${actualPath} L${xOf(curve.length - 1).toFixed(1)},${PLOT_BOTTOM} L${xOf(0).toFixed(1)},${PLOT_BOTTOM} Z`
      : ''

  const todayX = xOf(Math.max(0, elapsedDays - 1))
  const todayY = curve.length > 0 ? yOf(curve[curve.length - 1]) : PLOT_BOTTOM

  // Y-axis: 4 evenly spaced gridlines, 0 at the bottom.
  const yTicks = [0, yMax / 3, (2 * yMax) / 3, yMax]

  // X-axis: ~6 evenly spaced day labels, always including the first and last.
  const tickCount = Math.min(7, length)
  const xTickIndices = Array.from({ length: tickCount }, (_, i) => Math.round((i / (tickCount - 1 || 1)) * (length - 1)))

  return (
    <section className={`card card-pad ${className ?? ''}`}>
      <div className="card-head">
        <div>
          <h3 className="card-title">Spend pace</h3>
          <p className="card-sub">Running total this period vs. your usual</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <div className="tabular-nums" style={{ fontSize: 'var(--t-xl)', fontWeight: 660, letterSpacing: '-.028em' }}>
          {formatMYR(spent)}
        </div>
        {hasComparison && (
          <span className={`chip ${over ? 'chip-warn' : 'chip-pos'}`}>
            {formatMYR(Math.abs(delta))} {over ? 'above' : 'below'} usual
          </span>
        )}
        {showProjection && comparisonTotal > 0 && (
          <span className="hide-mobile text-sm text-fg-subtle">
            tracking to <b className="tabular-nums font-semibold text-fg-muted">{formatMYR(projected as number)}</b> by
            period end
          </span>
        )}
        <div className="legend ml-auto">
          <span>
            <i style={{ background: 'rgb(var(--accent))' }} />
            This period
          </span>
          {hasComparison && (
            <span style={{ color: 'rgb(var(--fg-faint))' }}>
              <i className="dash" />
              <span style={{ color: 'rgb(var(--fg-subtle))' }}>Usual ({comparisonDescription})</span>
            </span>
          )}
          {showProjection && (
            <span>
              <i style={{ background: 'rgb(var(--accent))', opacity: 0.45 }} />
              Projected
            </span>
          )}
        </div>
      </div>

      <div className="chart" data-testid="spend-hero-wrap">
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          style={{ height: 280 }}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={
            `Cumulative spending through ${periodLabel}. ${formatMYR(spent)} so far` +
            (hasComparison ? `, against ${comparisonClause} of ${formatMYR(usual)}` : '') +
            (showProjection ? `. On the current rate the period ends near ${formatMYR(projected as number)}.` : '.')
          }
        >
          <g className="chart-grid">
            {yTicks.map((t) => (
              <line key={t} x1={PLOT_LEFT} y1={yOf(t)} x2={PLOT_RIGHT} y2={yOf(t)} strokeDasharray={t === 0 ? undefined : '2 4'} />
            ))}
          </g>
          <g className="chart-axis" textAnchor="end">
            {yTicks.map((t) => (
              <text key={t} x={PLOT_LEFT - 8} y={yOf(t) + 4}>
                {formatAxisMYR(t)}
              </text>
            ))}
          </g>
          <g className="chart-axis" textAnchor="middle">
            {xTickIndices.map((i) => (
              <text key={i} x={xOf(i)} y={182}>
                {formatDay(i)}
              </text>
            ))}
          </g>
          <defs>
            <linearGradient id="spend-pace-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity=".14" />
              <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity="0" />
            </linearGradient>
          </defs>
          {areaPath && <path d={areaPath} fill="url(#spend-pace-gradient)" />}
          {baselinePath && (
            <path d={baselinePath} fill="none" stroke="rgb(var(--fg-faint))" strokeWidth="1.5" strokeDasharray="4 4" strokeLinecap="round" />
          )}
          {actualPath && (
            <path d={actualPath} fill="none" stroke="rgb(var(--accent))" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
          )}
          {projectedPath && (
            <path d={projectedPath} fill="none" stroke="rgb(var(--accent))" strokeWidth="2" strokeDasharray="5 5" strokeOpacity=".45" strokeLinecap="round" />
          )}
          {inProgress && curve.length > 0 && (
            <>
              <line x1={todayX} y1={PLOT_TOP} x2={todayX} y2={PLOT_BOTTOM} stroke="rgb(var(--line-strong))" strokeWidth="1" />
              <text x={todayX} y={200} className="chart-axis" textAnchor="middle" style={{ fill: 'rgb(var(--fg-subtle))', fontWeight: 600 }}>
                today
              </text>
              <circle cx={todayX} cy={todayY} r="4.5" fill="rgb(var(--surface))" stroke="rgb(var(--accent))" strokeWidth="2.5" />
            </>
          )}
        </svg>
        {inProgress && curve.length > 0 && (
          <div className="tip" style={{ left: `${(todayX / VB_W) * 100}%`, top: `${(todayY / VB_H) * 100}%` }}>
            <div className="big">{formatMYR(spent)}</div>
            <div className="sub">
              Day {elapsedDays}
              {hasComparison && ` · usual is ${formatMYR(usual)}`}
            </div>
          </div>
        )}
      </div>

      {!hasComparison && (
        <p className="mt-2 text-xs text-fg-subtle">
          No earlier period to compare against yet — the comparison appears once you have history before this one.
        </p>
      )}
      {inProgress && projected === undefined && (
        <p className="mt-2 text-xs text-fg-subtle" data-testid="pace-too-early">
          Too early in {periodLabel} to project a total — a few days of spending multiplied out says more about one
          purchase than about the month.
        </p>
      )}
    </section>
  )
}
