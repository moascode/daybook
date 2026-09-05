import { useEffect, useState } from 'react'
import { cn, formatMYR } from '@/lib/utils'
import type { NetWorthPoint } from './insights'

interface NetWorthHistoryChartProps {
  points: NetWorthPoint[]
  className?: string
}

/** Total plot height. Matches the mockup's chart proportions (its viewBox is ~210 tall). */
const PLOT_HEIGHT = 210

/**
 * Space reserved at the TOP of the plot for the hover tooltip above the
 * tallest bar. Without this, a tooltip on that bar renders outside the plot
 * box's own height and gets clipped by the scroll container below (an
 * `overflow-x: auto` box implicitly clips overflow-y too, per the CSS spec,
 * even though only the x-axis was meant to scroll). Bar heights are scaled
 * to `PLOT_HEIGHT - LABEL_HEADROOM`, not the full height, so the tallest
 * bar's tooltip always has room above it. This space is never blank, though:
 * `axisTop` below extends the y-axis exactly this far past the real data
 * max, so what would otherwise be an empty gap is a genuine 4th gridline +
 * label, the way the mockup's own axis reads.
 */
const LABEL_HEADROOM = 68
const BAR_AREA_HEIGHT = PLOT_HEIGHT - LABEL_HEADROOM

/** Fixed width for the y-axis label column. */
const AXIS_WIDTH = 48

/** Minimum pixels per bar before the row switches from stretching to fill the card to scrolling horizontally instead. */
const MIN_BAR_PITCH = 40

/** How many horizontal gridlines/labels the y-axis shows, matching the mockup's $0/$20k/$40k/$60k. */
const TICK_COUNT = 4

/** "RM 21.5k" — short form for the y-axis; the hover tooltip shows the full `formatMYR` amount. */
function compactMYR(amount: number): string {
  const sign = amount < 0 ? '−' : ''
  const abs = Math.abs(amount)
  if (abs < 1000) return `${sign}${formatMYR(abs)}`
  const thousands = abs / 1000
  const rounded = thousands >= 10 ? Math.round(thousands) : Math.round(thousands * 10) / 10
  return `${sign}RM ${rounded}k`
}

/**
 * "Net worth — last 12 months" — real month-end net worth (never the
 * mockup's invented curve). The mockup pins one static `.tip` bubble over
 * its most recent bar; this makes that interaction actually useful — hover
 * ANY bar to see its exact amount and its real month-over-month change,
 * reusing the same `.tip`/`.big`/`.sub` classes (charts.css). Always all 12
 * months: a month before an account existed shows a real $0, not a gap
 * (`accountBalanceAsOf` returns 0 pre-creation), so nothing here is padded
 * or fabricated.
 *
 * The mockup's own bar chart is an SVG with `width:100%` (charts.css), so its
 * fixed-unit bars stretch to fill whatever width the card has — this is the
 * same behaviour, reimplemented with `flex: 1` bars instead of a scaling
 * viewBox. Only below `MIN_BAR_PITCH` per bar does it fall back to a fixed
 * width with horizontal scroll.
 *
 * Bars grow in on mount — the same "animate to value" convention as
 * `.track`/`.budget-fill` (motion.css): render at height 0, then flip to the
 * real heights on a LATER frame so the CSS `transition` has an actual change
 * to animate. A single `requestAnimationFrame` isn't reliably enough of a
 * gap for the browser to paint the 0-height frame first — some browsers
 * coalesce it with the very next paint, so the "animation" never visibly
 * plays. Nesting two rAFs guarantees a real paint happens in between.
 */
export function NetWorthHistoryChart({ points, className }: NetWorthHistoryChartProps) {
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

  const values = points.map((p) => p.value)
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = Math.max(max - min, 1)

  // Ticks span [min ... axisTop], where axisTop is chosen so its own gridline
  // lands exactly at the TRUE top of the plot (pixel PLOT_HEIGHT on the same
  // value→pixel scale bars use, `(v - min) / range * BAR_AREA_HEIGHT`) — one
  // tick higher than the tallest bar ever reaches. That turns LABEL_HEADROOM
  // from a blank gap reserved for the hover tooltip into a real 4th
  // gridline + axis label, the way the mockup's own axis reads, while still
  // leaving the same real pixel room the tooltip needs. Ascending order;
  // rendered top-to-bottom the axis reverses this.
  // Landing exactly at pixel PLOT_HEIGHT (the plot box's own edge) leaves the top
  // gridline's 1px border a sub-pixel rounding away from being clipped by the
  // scroll container's implicit overflow-y (same CSS quirk as the tooltip above) —
  // pulling it in by a couple of pixels keeps it unambiguously inside the box.
  const axisTop = min + range * ((PLOT_HEIGHT - 2) / BAR_AREA_HEIGHT)
  const ticks = Array.from({ length: TICK_COUNT }, (_, i) => min + ((axisTop - min) * i) / (TICK_COUNT - 1))

  return (
    <section className={cn('section', className)} data-testid="net-worth-history">
      <div className="section-head">
        <h2 className="section-title">Net worth</h2>
        <span className="section-sub">Last 12 months</span>
      </div>
      <div className="card card-pad">
        <div
          role="img"
          aria-label={`Net worth by month. ${points.map((p) => `${p.label}: ${formatMYR(p.value)}`).join('; ')}. Hover a bar for its exact amount and change from the month before.`}
          style={{ display: 'flex', gap: 'var(--s3)' }}
        >
          {/* y-axis labels, highest first — fixed, does not scroll */}
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

          {/* scrollable region — bars + month labels share this one inner width so they never drift apart.
              `minWidth` is the only hard floor: below it the row scrolls; above it, `width: 100%` lets
              the flex:1 bars stretch to fill the card, same as the mockup's scaling SVG. */}
          <div style={{ flex: 1, overflowX: 'auto' }}>
            <div style={{ width: '100%', minWidth: points.length * MIN_BAR_PITCH }}>
              {/* plot area — gridlines behind the bars, both keyed to the same min/max/range and BAR_AREA_HEIGHT */}
              <div style={{ position: 'relative', height: PLOT_HEIGHT }}>
                {ticks.map((tick) => (
                  <div
                    key={tick}
                    className="chart-grid"
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      bottom: `${((tick - min) / range) * BAR_AREA_HEIGHT}px`,
                      borderTop: '1px dashed rgb(var(--grid))',
                    }}
                  />
                ))}

                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap: 'var(--s3)' }}>
                  {points.map((p, i) => {
                    const fullHeight = Math.max(2, ((p.value - min) / range) * BAR_AREA_HEIGHT)
                    const barHeight = grown ? fullHeight : 0
                    const isLatest = i === points.length - 1
                    // `previousValue` reaches one real month further back than the visible
                    // window for the first bar — never the array-lookback `points[i-1]`,
                    // which would wrongly show no change on an account that's actually
                    // years old just because month 1 has nothing before it ON SCREEN.
                    const delta = p.value - p.previousValue
                    // The tip is centred on its bar by default (matching `.tip`'s own
                    // `translate(-50%, -100%)`), but that overflows past the card's edge
                    // on the first/last bar — pin those to their bar's inner edge instead.
                    const tipAlign = i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'center'
                    const tipPosition =
                      tipAlign === 'start' ? { left: 0, transform: 'translate(0, -100%)' }
                      : tipAlign === 'end' ? { left: '100%', transform: 'translate(-100%, -100%)' }
                      : { left: '50%', transform: 'translate(-50%, -100%)' }
                    return (
                      <div
                        key={p.month}
                        data-testid="net-worth-bar"
                        onMouseEnter={() => setHovered(i)}
                        onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
                        style={{
                          flex: 1, position: 'relative', height: '100%', display: 'flex', alignItems: 'flex-end',
                          // A hovered bar's own column is the tip's stacking context — without
                          // raising it, a later bar in DOM order (e.g. Sep) paints over an
                          // earlier bar's tip that visually extends under it (e.g. Aug's).
                          zIndex: hovered === i ? 1 : undefined,
                        }}
                      >
                        {hovered === i && (
                          // .tip (charts.css) is top-anchored: `top` places its arrow tip at that
                          // point, then `transform`'s -100% Y lifts the bubble above it.
                          <div className="tip" style={{ ...tipPosition, top: PLOT_HEIGHT - barHeight - 10 }}>
                            <div className="big">{formatMYR(p.value)}</div>
                            <div className="sub">
                              {p.label} · {delta >= 0 ? '+' : '−'}{formatMYR(Math.abs(delta))}
                            </div>
                          </div>
                        )}
                        {/* Same accent green as the mockup's own bar chart (and this app's other net-worth surfaces), not charts.css's info-blue default. */}
                        <div
                          style={{
                            width: '100%',
                            height: barHeight,
                            borderRadius: '4px 4px 2px 2px',
                            background: `rgb(var(--accent) / ${isLatest || hovered === i ? 1 : 0.3})`,
                            transition: 'height var(--dur-slow) var(--ease), background var(--dur-fast) var(--ease)',
                            cursor: 'default',
                          }}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* month labels, same gap as the bars above so each one sits under its own bar */}
              <div style={{ display: 'flex', gap: 'var(--s3)', marginTop: 'var(--s2)' }}>
                {points.map((p, i) => (
                  <span
                    key={p.month}
                    className="chart-axis"
                    style={{
                      flex: 1,
                      textAlign: 'center',
                      fontSize: 'var(--t-micro)',
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
      </div>
    </section>
  )
}
