import { useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import { cn, todayISO, dateMinusDays } from '@/lib/utils'
import type { CompletedAnalytics as CompletedAnalyticsData } from '@/hooks/useCompletedAnalytics'
import type { TaskList } from '@/hooks/useTaskLists'

function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface Run {
  start: string
  end: string
  length: number
}

/** Longest and current run (anywhere in `dates`) of consecutive days with count > 0. */
function computeRuns(dates: string[], countByDate: Map<string, number>, today: string): Run[] {
  const runs: Run[] = []
  let start: string | null = null
  let end: string | null = null
  let length = 0
  for (const date of dates) {
    if (date > today) break
    const count = countByDate.get(date) ?? 0
    if (count > 0) {
      if (start === null) start = date
      end = date
      length += 1
    } else if (start !== null && end !== null) {
      runs.push({ start, end, length })
      start = null
      end = null
      length = 0
    }
  }
  if (start !== null && end !== null) runs.push({ start, end, length })
  return runs
}

/** Bucket a day's completion count into one of the mockup's 4 shading
 *  intensities (`tasks.css`'s `.heat i.l1`..`l4` — accent-alpha levels, not
 *  a raw Tailwind `bg-emerald-*` scale, so the heatmap follows the accent
 *  colour like every other chart in the app rather than hardcoding green).
 *  '' (no level class) renders `.heat i`'s own empty-day background. */
function intensityLevelClass(count: number): string {
  if (count === 0) return ''
  if (count === 1) return 'l1'
  if (count === 2) return 'l2'
  if (count <= 4) return 'l3'
  return 'l4'
}

/**
 * Year heatmap + streak/busiest-day stats for the Completed page (FEAT-030,
 * docs/backlog/EP-07-tasks-depth/FEAT-030-tasks-completed-analytics.md;
 * restructured by FEAT-060,
 * docs/backlog/EP-07-tasks-depth/FEAT-060-tasks-completed-design-adoption.md,
 * which also split the old combined by-list section into two cards — see
 * `CompletedByListCards` below). All the raw counts come from the server
 * (`GET /tasks/completed/analytics`, worker/routes/tasks.ts); the streak and
 * busiest-day stats are derived here, client-side, from the already-loaded
 * `heatmap` array — no new fetch.
 */
export function CompletedAnalytics({ data }: { data: CompletedAnalyticsData }) {
  const countByDate = useMemo(() => new Map(data.heatmap.map((h) => [h.date, h.count])), [data.heatmap])

  // 53 columns (Sun..Sat rows) ending today, starting from the most recent
  // Sunday on/before 364 days ago so the grid is always whole weeks.
  const weeks = useMemo(() => {
    const today = todayISO()
    const start = dateMinusDays(today, 364 + weekdayOf(dateMinusDays(today, 364)))
    const cols: string[][] = []
    let cursor = start
    while (cursor <= today) {
      const col: string[] = []
      for (let d = 0; d < 7; d++) {
        col.push(cursor)
        cursor = dateMinusDays(cursor, -1)
      }
      cols.push(col)
    }
    return cols
  }, [])

  const today = todayISO()

  const { longest, current } = useMemo(() => {
    const allDates = weeks.flat()
    const runs = computeRuns(allDates, countByDate, today)
    const yesterday = dateMinusDays(today, 1)

    let longestRun: Run | null = null
    for (const run of runs) {
      if (!longestRun || run.length >= longestRun.length) longestRun = run
    }

    const lastRun = runs[runs.length - 1] ?? null
    const currentRun = lastRun && (lastRun.end === today || lastRun.end === yesterday) ? lastRun : null

    // "best run since X": the most recent PRIOR run (before the current one)
    // at least as long as it — i.e. the last time a run this good existed.
    // X is the day after that prior run ended, since nothing matched again
    // until the current run started. No honest comparison if there is no
    // such prior run (the current run is itself the best on record).
    let sinceLabel: string | null = null
    if (currentRun) {
      for (let i = runs.length - 2; i >= 0; i--) {
        if (runs[i].length >= currentRun.length) {
          sinceLabel = format(parseISO(dateMinusDays(runs[i].end, -1)), 'd MMMM')
          break
        }
      }
    }

    return { longest: longestRun, current: { run: currentRun, sinceLabel } }
  }, [weeks, countByDate, today])

  const busiest = useMemo(() => {
    const totals = [0, 0, 0, 0, 0, 0, 0]
    for (const h of data.heatmap) {
      if (h.date > today) continue
      totals[weekdayOf(h.date)] += h.count
    }
    const grandTotal = totals.reduce((sum, n) => sum + n, 0)
    const maxTotal = Math.max(...totals)
    const idx = totals.indexOf(maxTotal)
    const pct = grandTotal > 0 ? Math.round((maxTotal / grandTotal) * 100) : 0
    return { name: WEEKDAY_NAMES[idx], pct, hasData: grandTotal > 0 }
  }, [data.heatmap, today])

  // The band figure must agree with the heatmap grid and the busiest-day %
  // beneath it, both of which are scoped to the 364-day window above — summing
  // `data.heatmap` (already loaded, no new fetch) instead of reading the
  // server's all-time `data.totalCompleted` keeps the whole card internally
  // consistent. `data.totalCompleted` itself is untouched — it's used
  // elsewhere (e.g. the by-list cards' percentages) as the honest all-time figure.
  const heatmapTotal = useMemo(() => data.heatmap.reduce((sum, h) => sum + h.count, 0), [data.heatmap])

  if (data.totalCompleted === 0) return null

  return (
    <section className="card card-pad c12" data-testid="completed-analytics">
      <div className="card-head">
        <div>
          <span className="card-title">A year of finishing things</span>
          <div className="card-sub">One square per day — darker means more done</div>
        </div>
        <div className="heat-key ml-auto">
          <span>Less</span>
          <i />
          <i className="l1" />
          <i className="l2" />
          <i className="l3" />
          <i className="l4" />
          <span>More</span>
        </div>
      </div>

      <div className="mb-4 overflow-x-auto">
        {/* `.heat`/`.heat-key`'s accent-alpha levels (tasks.css's appended
            block below gives the key's own swatches real colour — the
            mockup's markup never actually painted them, since `.heat
            i.l1..l4` is scoped under `.heat`, not `.heat-key`). `heat--fill`
            stretches the grid's implicit columns to the card's full width —
            `.heat` alone sizes its (auto) columns to content, which on this
            many squares renders far narrower than the card. Flat list of
            `<i>`s, not nested per-week `<div>`s: `grid-auto-flow: column`
            already lays 7 items per column in the SAME top-to-bottom,
            oldest-week-first order `weeks.flat()` produces. */}
        <div
          className="heat heat--fill"
          data-testid="completed-heatmap"
          role="img"
          aria-label={`Completion heatmap: ${heatmapTotal} tasks completed over the last year`}
        >
          {weeks.flat().map((date) => (
            <i
              key={date}
              data-testid={`heatmap-day-${date}`}
              title={`${date} — ${countByDate.get(date) ?? 0} completed`}
              className={cn(date > today && 'opacity-0', intensityLevelClass(countByDate.get(date) ?? 0))}
            />
          ))}
        </div>
      </div>

      <div className="divider" />

      <div className="band">
        <div className="band-main">
          <div className="band-fig">
            <span className="v" data-testid="completed-total-fig">
              {heatmapTotal}
            </span>
            <span className="k">tasks completed</span>
          </div>
        </div>
        <div className="band-stats">
          <div className="band-stat">
            <p className="k">Longest streak</p>
            <p className="v">
              {longest ? longest.length : 0} day{(longest ? longest.length : 0) === 1 ? '' : 's'}
            </p>
            {longest && (
              <p className="s">
                {current.run && longest.end === current.run.end ? 'still going' : `ended ${format(parseISO(longest.end), 'd MMMM')}`}
              </p>
            )}
          </div>
          <div className="band-stat">
            <p className="k">Current streak</p>
            <p className="v" data-testid="completed-streak-current">
              {current.run ? current.run.length : 0} day{(current.run ? current.run.length : 0) === 1 ? '' : 's'}
            </p>
            <p className="s">
              {current.sinceLabel
                ? `best run since ${current.sinceLabel}`
                : current.run
                  ? `${current.run.length} day${current.run.length === 1 ? '' : 's'} running`
                  : 'none right now'}
            </p>
          </div>
          <div className="band-stat">
            <p className="k">Busiest day</p>
            <p className="v">{busiest.hasData ? busiest.name : '—'}</p>
            {busiest.hasData && <p className="s">{busiest.pct}% of everything you finish</p>}
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * The two by-list cards FEAT-060 split the old combined section into: share
 * of completions ("What you finish", sorted by count) and speed ("Time to
 * finish", sorted slowest-first, keeping the existing graveyard insight).
 * Rendered as the `c4 stack` beside the c8 "Recently finished" list, matching
 * the mockup's row (heatmap c12 on its own row, then list+these side by side).
 */
export function CompletedByListCards({
  data,
  listById,
}: {
  data: CompletedAnalyticsData
  listById: Map<string, TaskList>
}) {
  // "Time to finish" sorts slowest-first — the opposite of "What you finish",
  // which sorts by count descending (acceptance criteria calls out both sort
  // orders explicitly so they aren't accidentally shared).
  const bySpeed = useMemo(() => [...data.byList].sort((a, b) => b.avgDays - a.avgDays), [data.byList])
  const byShare = useMemo(() => [...data.byList].sort((a, b) => b.count - a.count), [data.byList])
  const graveyard = bySpeed.find((r) => data.overallAvgDays > 0 && r.avgDays > data.overallAvgDays * 3 && r.count >= 3)
  const maxShareCount = useMemo(() => Math.max(1, ...data.byList.map((r) => r.count)), [data.byList])

  if (data.totalCompleted === 0) return null

  return (
    <div className="c4 stack">
      <div className="card card-pad">
        <div className="card-head">
          <div>
            <div className="card-title">What you finish</div>
            <div className="card-sub">Share of completions by list</div>
          </div>
        </div>
        <div className="blist" data-testid="completed-by-list">
          {byShare.map((row) => {
            const list = row.listId ? listById.get(row.listId) : undefined
            const name = row.listId ? (list?.name ?? 'Deleted list') : 'Unsorted'
            const color = list?.color ?? '#6b7280'
            const pctOfTotal = data.totalCompleted > 0 ? Math.round((row.count / data.totalCompleted) * 100) : 0
            return (
              <div key={row.listId ?? 'unsorted'} className="brow">
                <span className="cat-dot" style={{ background: color }} aria-hidden="true" />
                <div className="brow-main">
                  <div className="brow-top">
                    <span className="brow-name">{name}</span>
                    <span className="brow-val">
                      {row.count} · {pctOfTotal}%
                    </span>
                  </div>
                  <div className="track">
                    <i style={{ width: `${(row.count / maxShareCount) * 100}%`, background: color }} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="card card-pad">
        <div className="card-head">
          <div>
            <div className="card-title">Time to finish</div>
            <div className="card-sub">From created to done, average</div>
          </div>
        </div>
        {bySpeed.map((row, idx) => {
          const list = row.listId ? listById.get(row.listId) : undefined
          const name = row.listId ? (list?.name ?? 'Deleted list') : 'Unsorted'
          return (
            <div key={row.listId ?? 'unsorted'} className="kv">
              <span className="k">{name}</span>
              {/* The slowest list (bySpeed is sorted slowest-first) reads as
                  a warning, same convention the mockup's own "Someday"
                  row uses — a `text-neg-fg` class would be the usual way,
                  but `.kv .v`'s own colour is set via plain CSS, not
                  Tailwind, so matching its specificity needs the token
                  directly. */}
              <span className="v" style={idx === 0 && bySpeed.length > 1 ? { color: 'rgb(var(--neg-fg))' } : undefined}>
                {row.avgDays.toFixed(1)} days
              </span>
            </div>
          )
        })}
        {graveyard && (
          <>
            <div className="divider" style={{ marginTop: 'auto' }} />
            <p className="text-xs text-fg-subtle" data-testid="completed-insight">
              {(graveyard.listId ? listById.get(graveyard.listId)?.name : 'Unsorted') ?? 'That list'} is a
              graveyard, not a backlog — tasks there take {(graveyard.avgDays / data.overallAvgDays).toFixed(1)}x
              longer to finish than average.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
