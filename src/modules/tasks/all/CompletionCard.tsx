import { useMemo } from 'react'
import { format, parseISO, startOfWeek, subWeeks } from 'date-fns'
import { todayISO } from '@/lib/utils'
import type { Task } from '@/types/tasks.types'

interface CompletionCardProps {
  completedTasks: Task[]
}

const WEEKS = 12
// Geometry mirrors tasks-all.html's 620×190 chart.
const LEFT = 42
const RIGHT = 606
const TOP = 10
const BOTTOM = 150
const BAR_W = 30

function weekKey(dateIso: string): string {
  return format(startOfWeek(parseISO(dateIso.slice(0, 10)), { weekStartsOn: 1 }), 'yyyy-MM-dd')
}

/** A y-axis ceiling that divides into three even, whole-number steps. */
function niceMax(peak: number): number {
  return Math.max(3, Math.ceil(peak / 3) * 3)
}

/**
 * "Completion" (tasks-all.html): tasks finished per week for the last twelve
 * weeks, the current week in full accent and the rest faded, with a dashed
 * average line. The footnote compares the last four weeks with the four
 * before — a figure the data actually supports, rather than the mockup's
 * placeholder narrative.
 */
export function CompletionCard({ completedTasks }: CompletionCardProps) {
  const weeks = useMemo(() => {
    const thisWeek = startOfWeek(parseISO(todayISO()), { weekStartsOn: 1 })
    const buckets = Array.from({ length: WEEKS }, (_, i) => ({
      key: format(subWeeks(thisWeek, WEEKS - 1 - i), 'yyyy-MM-dd'),
      count: 0,
    }))
    const byKey = new Map(buckets.map((b) => [b.key, b]))
    for (const t of completedTasks) {
      if (!t.completedAt) continue
      const bucket = byKey.get(weekKey(t.completedAt))
      if (bucket) bucket.count += 1
    }
    return buckets
  }, [completedTasks])

  const total = weeks.reduce((s, w) => s + w.count, 0)
  const avg = total / WEEKS
  const max = niceMax(Math.max(...weeks.map((w) => w.count)))
  const y = (v: number) => BOTTOM - (v / max) * (BOTTOM - TOP)
  const pitch = (RIGHT - LEFT) / WEEKS
  const barX = (i: number) => LEFT + i * pitch + (pitch - BAR_W) / 2

  const recent = weeks.slice(-4).reduce((s, w) => s + w.count, 0)
  const prior = weeks.slice(-8, -4).reduce((s, w) => s + w.count, 0)
  const footnote = (() => {
    if (total === 0) return <>Nothing completed in the last twelve weeks yet.</>
    const tasks = `${recent} task${recent === 1 ? '' : 's'}`
    if (prior === 0) return <>You finished {tasks} in the last four weeks.</>
    const change = Math.round(((recent - prior) / prior) * 100)
    if (change === 0) return <>You finished {tasks} in the last four weeks — the same as the four before.</>
    return (
      <>
        You finished {tasks} in the last four weeks,{' '}
        <b className="font-semibold text-fg">
          {Math.abs(change)}% {change > 0 ? 'more' : 'fewer'}
        </b>{' '}
        than the four before.
      </>
    )
  })()

  return (
    <section className="card card-pad c7 flex flex-col" data-testid="all-tasks-completion-card">
      <div className="card-head">
        <div>
          <div className="card-title">Completion</div>
          <div className="card-sub">Tasks finished per week, last 12 weeks</div>
        </div>
      </div>
      <div className="chart">
        <svg
          viewBox="0 0 620 190"
          style={{ height: 200, width: '100%' }}
          role="img"
          aria-label={`Tasks completed per week over the last twelve weeks: ${weeks.map((w) => w.count).join(', ')}. Average ${avg.toFixed(1)}.`}
        >
          <g className="chart-grid">
            {[0, 1, 2, 3].map((i) => (
              <line
                key={i}
                x1={LEFT}
                x2={RIGHT}
                y1={y((max / 3) * i)}
                y2={y((max / 3) * i)}
                strokeDasharray={i === 0 ? undefined : '2 4'}
              />
            ))}
          </g>
          <g className="chart-axis" textAnchor="end">
            {[0, 1, 2, 3].map((i) => (
              <text key={i} x={34} y={y((max / 3) * i) + 4}>
                {(max / 3) * i}
              </text>
            ))}
          </g>
          {total > 0 && (
            <>
              <line
                x1={LEFT}
                x2={RIGHT}
                y1={y(avg)}
                y2={y(avg)}
                stroke="rgb(var(--fg-faint))"
                strokeWidth="1"
                strokeDasharray="4 4"
              />
              <text
                x={LEFT + 4}
                y={y(avg) - 5}
                className="chart-axis"
                textAnchor="start"
                style={{ fill: 'rgb(var(--fg-subtle))' }}
              >
                avg {avg < 10 ? Number(avg.toFixed(1)) : Math.round(avg)}
              </text>
            </>
          )}
          <g data-testid="all-tasks-completion-bars">
            {weeks.map((w, i) => (
              <rect
                key={w.key}
                x={barX(i)}
                y={y(w.count)}
                width={BAR_W}
                height={BOTTOM - y(w.count)}
                rx="4"
                fill="rgb(var(--accent))"
                opacity={i === WEEKS - 1 ? 1 : 0.35}
                data-count={w.count}
              >
                <title>
                  Week of {format(parseISO(w.key), 'd MMM')}: {w.count} completed
                </title>
              </rect>
            ))}
          </g>
          <g className="chart-axis" textAnchor="middle">
            <text x={barX(0) + BAR_W / 2} y={172}>
              12w
            </text>
            <text x={barX(4) + BAR_W / 2} y={172}>
              8w
            </text>
            <text x={barX(8) + BAR_W / 2} y={172}>
              4w
            </text>
            <text x={barX(WEEKS - 1) + BAR_W / 2} y={172} style={{ fill: 'rgb(var(--fg))', fontWeight: 600 }}>
              now
            </text>
          </g>
        </svg>
      </div>
      <div className="divider" style={{ marginTop: 'auto' }} />
      <p className="text-sm text-fg-subtle" data-testid="all-tasks-completion-footnote">
        {footnote}
      </p>
    </section>
  )
}
