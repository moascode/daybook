import { format, parseISO } from 'date-fns'
import { cn, dateMinusDays } from '@/lib/utils'
import { keptAndDue, keptRate28, WEEKDAY_FULL } from './habitMath'
import type { Habit, JointHabitStats } from '@/types/habits.types'

/** "Consistency" — the page's first card (c12): the pooled kept-rate
 * band-fig, the current/longest/weakest-day stats, and the "K of N above
 * 70%" chip. */
export function ConsistencyCard({
  habits,
  today,
  jointStats,
  pooledWeekday,
}: {
  habits: Habit[]
  today: string
  jointStats: JointHabitStats
  pooledWeekday: { due: number[]; kept: number[]; rates: number[] }
}) {
  if (habits.length === 0) return null

  // band-fig: pooled kept ÷ due across every active habit's 28-day window.
  let totalKept = 0
  let totalDue = 0
  for (const h of habits) {
    const { kept, due } = keptAndDue(h.stats.entries)
    totalKept += kept
    totalDue += due
  }
  const pooledPct = totalDue > 0 ? Math.round((totalKept / totalDue) * 100) : 0

  // Current streak sub-line (review fix #3/#4/#6) — three honest states,
  // same pattern as FEAT-060's CompletedAnalytics heatmap streak:
  // "all K kept" when today itself is fully kept (K = habits actually DUE
  // today, not the total habit count — fix #4); "best run since X" when the
  // server's `bestRun` (over the full 84-day window, fix #6) names a
  // strictly longer PAST run than the one still running; else an honest
  // "N days running", or "none right now" when there's no streak at all
  // (fix #3 — matching the convention, not the literal "0 days running").
  const todayDue = habits.filter((h) => h.stats.entries.find((e) => e.date === today)?.due)
  const allKeptToday =
    jointStats.currentStreak > 0 &&
    todayDue.length > 0 &&
    todayDue.every((h) => h.stats.entries.find((e) => e.date === today)?.done)

  const bestRun = jointStats.bestRun
  // The server's bestRun IS the still-running current streak (not a
  // distinct past run) whenever its length matches — the >= tie-break
  // computeJointStats uses always updates to the most recent occurrence of
  // the max length, so a longer-or-equal trailing streak always wins that
  // comparison over an earlier one.
  const sinceLabel =
    jointStats.currentStreak > 0 && bestRun && bestRun.length > jointStats.currentStreak
      ? format(parseISO(dateMinusDays(bestRun.end, -1)), 'd MMMM')
      : null

  const currentSub = allKeptToday
    ? `all ${todayDue.length} kept`
    : jointStats.currentStreak === 0
      ? 'none right now'
      : sinceLabel
        ? `best run since ${sinceLabel}`
        : `${jointStats.currentStreak} day${jointStats.currentStreak === 1 ? '' : 's'} running`

  // Longest, last 12 weeks: the habit with the single highest bestStreak
  // across all habits — ties prefer the most recently-ended run (review fix
  // #5b: the old `>` reduce let ties fall to whichever habit iterated
  // first, i.e. effectively the oldest-created one).
  const longestHabit = habits.reduce<Habit | null>((winner, h) => {
    if (!winner) return h
    if (h.stats.bestStreak > winner.stats.bestStreak) return h
    if (h.stats.bestStreak === winner.stats.bestStreak) {
      return (h.stats.bestStreakEnd ?? '') >= (winner.stats.bestStreakEnd ?? '') ? h : winner
    }
    return winner
  }, null)
  const longest = longestHabit?.stats ?? { bestStreak: 0, bestStreakEnd: null, currentStreak: 0 }
  // Review fix #5a: when that habit's longest-ever run IS its current,
  // still-running streak, "ended {today}" is a fabrication — say "ongoing".
  // A run through yesterday is still going while today isn't ticked yet —
  // today is forgiven until it's over, so "ended yesterday" would be wrong.
  const yesterday = dateMinusDays(today, 1)
  const longestOngoing =
    longest.bestStreak > 0 &&
    (longest.bestStreakEnd === today || longest.bestStreakEnd === yesterday) &&
    longestHabit?.stats.currentStreak === longest.bestStreak

  // Weakest day — the single weekday with the lowest POOLED 28-day kept
  // rate (review fix #2: this used to read each habit's 12-week
  // `weekdayRates`, a different window than the "Kept by weekday" chart's
  // pooled 28-day `entries` just below it, so the two could — and did —
  // name different weekdays as weakest). Reuses the same aggregation.
  let weakest: { weekday: number; rate: number } | null = null
  for (let weekday = 0; weekday < 7; weekday++) {
    if (pooledWeekday.due[weekday] === 0) continue
    const rate = pooledWeekday.rates[weekday]
    if (weakest === null || rate < weakest.rate) weakest = { weekday, rate }
  }

  const aboveCount = habits.filter((h) => keptRate28(h) >= 0.7).length
  const chipTone = habits.length > 0 && aboveCount / habits.length >= 0.5 ? 'chip-pos' : 'chip-mute'

  return (
    <section className="card card-pad c12" data-testid="habits-consistency-card">
      <div className="card-head">
        <div>
          <span className="card-title">Consistency</span>
          <div className="card-sub">The things you asked to do repeatedly</div>
        </div>
        <span className={cn('chip', chipTone, 'ml-auto')} data-testid="habits-above-threshold-chip">
          {aboveCount} of {habits.length} above 70%
        </span>
      </div>
      <div className="band">
        <div className="band-main">
          <div className="band-fig">
            <span className="v" data-testid="habits-pooled-kept-pct">
              {pooledPct}%
            </span>
            <span className="k">of habit days kept, last 28 days</span>
          </div>
        </div>
        <div className="band-stats">
          <div className="band-stat">
            <p className="k">Current streak</p>
            <p className="v" data-testid="habits-current-streak">
              {jointStats.currentStreak} day{jointStats.currentStreak === 1 ? '' : 's'}
            </p>
            <p className="s">{currentSub}</p>
          </div>
          <div className="band-stat">
            <p className="k">Longest, last 12 weeks</p>
            <p className="v" data-testid="habits-longest-streak">
              {longest.bestStreak} day{longest.bestStreak === 1 ? '' : 's'}
            </p>
            {longest.bestStreak > 0 && (
              <p className="s">{longestOngoing ? 'ongoing' : longest.bestStreakEnd ? `ended ${format(parseISO(longest.bestStreakEnd), 'd MMMM')}` : null}</p>
            )}
          </div>
          <div className="band-stat">
            <p className="k">Weakest day</p>
            <p className="v">{weakest ? WEEKDAY_FULL[weakest.weekday] : '—'}</p>
            {weakest && <p className="s">{Math.round(weakest.rate * 100)}% kept</p>}
          </div>
        </div>
      </div>
    </section>
  )
}
