import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { Flame, Plus, Archive, Trash2, MoreVertical, AlertTriangle, Sparkles } from 'lucide-react'
import { cn, errorMessage, dateMinusDays } from '@/lib/utils'
import { useHabits } from '@/hooks/useHabits'
import { useToastStore } from '@/stores/toast.store'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import type { Habit, HabitDayEntry, JointHabitStats } from '@/types/habits.types'

const COLOR_PRESETS = [
  '#10b981', '#059669', '#3b82f6', '#6366f1',
  '#8b5cf6', '#ef4444', '#f97316', '#eab308',
  '#ec4899', '#14b8a6',
]

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
/** Mon..Sun display order for the weekday chart/band, independent of the
 * 0=Sun..6=Sat index the server's `weekdayRates` uses. */
const WEEK_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
/** Ring stroke colour fallback, cycled by position — used only for a habit
 * that somehow has no `color` of its own (every habit created through this
 * page's form always gets one; see review fix #9: `habit.color` already
 * exists on the data model and now drives the ring directly, rather than
 * the fixed cycle silently overriding a control the create-habit modal
 * still shows). */
const RING_COLORS = ['rgb(var(--calm))', 'rgb(var(--info))', 'rgb(var(--alt))', 'rgb(var(--warn))']

const RING_RADIUS = 40
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
/** `.bars`/`.bar-fill` (charts.css) size their bars by an explicit pixel
 * height, not a CSS percentage — `.bars` itself declares no height for a
 * percentage to resolve against. This is the 0-100% → px scale `.bar-fill`
 * uses. */
const BAR_MAX_PX = 100
/** `.bars-avg`'s `bottom` and `.bar-fill`'s `height` are NOT the same
 * coordinate space: `.bars` aligns each `.bar` to its own bottom
 * (`align-items: flex-end`), but a `.bar`'s own bottom edge is the bottom of
 * its `.bar-day` label, not the bottom of `.bar-fill` — the label (and the
 * gap above it) sits below the fill inside that box. Left unaccounted for,
 * the dashed average line reads ~24px too low against the bars it's
 * supposed to mark. `WeekRhythm.tsx`'s identical `.bars`/`.bars-avg` chart
 * already carries this exact +24 correction — reused here rather than
 * re-deriving it. */
const BAR_FOOT_OFFSET_PX = 24

/** Whether `weekday` (0=Sun..6=Sat) is a day `schedule` is due at all — the
 * same rule `worker/routes/habits.ts`'s `isDueOn` uses server-side. */
function isDueOn(schedule: number[] | null, weekday: number): boolean {
  return schedule === null || schedule.includes(weekday)
}

/** 0=Sun..6=Sat for a YYYY-MM-DD date string, pure calendar-date arithmetic —
 * same approach as `worker/routes/habits.ts`'s `weekdayOf`. Deliberately NOT
 * `parseISO(date).getUTCDay()`: `parseISO` parses a date-only string at local
 * midnight, so `.getUTCDay()` on it reads the PREVIOUS day's weekday for
 * anyone west of UTC — this stays entirely in Y/M/D integers instead. */
function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** Kept/due counts over a habit's 28-day grid window (`habit.stats.entries`). */
function keptAndDue(entries: HabitDayEntry[]): { kept: number; due: number } {
  let kept = 0
  let due = 0
  for (const e of entries) {
    if (e.due) {
      due++
      if (e.done) kept++
    }
  }
  return { kept, due }
}

/** 28-day kept-rate (kept due days ÷ due days), 0 when the habit was never due. */
function keptRate28(habit: Habit): number {
  const { kept, due } = keptAndDue(habit.stats.entries)
  return due > 0 ? kept / due : 0
}

/** "Every day" / "Weekdays" / "Mon, Wed, Fri" — see FEAT-061's "does NOT
 * build" note: no every-N-days cadence, the data model only has a
 * day-of-week schedule or none. */
function scheduleDescription(habit: Habit): string {
  const base = (() => {
    if (habit.schedule === null) return 'Every day'
    const sorted = [...habit.schedule].sort()
    if (sorted.length === 5 && sorted.join(',') === '1,2,3,4,5') return 'Weekdays'
    return sorted.map((d) => WEEKDAY_SHORT[d]).join(', ')
  })()
  return habit.linkedKind === 'wallet:no-spend' ? `${base} · Wallet` : base
}

/** Pooled kept/due per weekday (0=Sun..6=Sat) across every active habit's
 * 28-day `entries` — the SINGLE aggregation both the Consistency card's
 * "Weakest day" stat and the "Kept by weekday" chart read (FEAT-061 review
 * fix #2: these previously used two different windows — this one pools the
 * per-habit 12-week `weekdayRates` — and disagreed about which day was
 * weakest). */
function pooledWeekdayStats(habits: Habit[]): { due: number[]; kept: number[]; rates: number[] } {
  const due = new Array(7).fill(0)
  const kept = new Array(7).fill(0)
  for (const h of habits) {
    for (const e of h.stats.entries) {
      if (!e.due) continue
      const weekday = weekdayOf(e.date)
      due[weekday]++
      if (e.done) kept[weekday]++
    }
  }
  const rates = due.map((d, i) => (d > 0 ? kept[i] / d : 0))
  return { due, kept, rates }
}

/**
 * Habits — `/tasks/habits` (FEAT-029, docs/backlog/EP-07-tasks-depth/FEAT-029-tasks-habits.md;
 * visual language brought to design parity by FEAT-061,
 * docs/backlog/EP-07-tasks-depth/FEAT-061-tasks-habits-design-adoption.md).
 * A habit is a repeated commitment tracked by day, not a due-dated task
 * instance — rings/streaks/dots/weekday chart all come pre-computed from
 * `GET /habits` (worker/routes/habits.ts's computeStats) except the pooled
 * "Kept by weekday" card, which is deliberately derived client-side from the
 * already-loaded per-habit `entries` (see FEAT-061's "does NOT build" note —
 * no new fetch). The joint "all habits kept" streak, by contrast, IS a
 * server-side aggregate (`GET /habits/joint-stats`, review fix #6) — the
 * client only has 28 days of `entries` per habit, not enough to agree with
 * each habit's own 84-day `currentStreak`.
 */
export function TasksHabitsPage() {
  const { habits, loadHabits, loadJointStats, createHabit, updateHabit, deleteHabit, toggleHabitEntry } = useHabits()
  const addToast = useToastStore((s) => s.addToast)
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [jointStats, setJointStats] = useState<JointHabitStats>({ currentStreak: 0, bestRun: null })

  // TasksTodayPage.tsx's composer "Habit" action navigates here with
  // `{ openCreateHabit: true }` so the create-habit modal opens immediately
  // instead of just changing the route — same one-shot nav-state +
  // `location.key` guard TasksTodayPage.tsx already uses for its own
  // `focusComposer` flag (BUG-005).
  const location = useLocation()
  const navigate = useNavigate()
  const shouldOpenCreate = (location.state as { openCreateHabit?: boolean } | null)?.openCreateHabit
  const [handledOpenKey, setHandledOpenKey] = useState<string | null>(null)
  if (shouldOpenCreate && location.key !== handledOpenKey) {
    setHandledOpenKey(location.key)
  }
  useEffect(() => {
    if (shouldOpenCreate && handledOpenKey === location.key) {
      // One-shot transition from nav state (TasksTodayPage.tsx's composer
      // "Habit" action), same story as WalletPage.tsx's ?account= deep link.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowCreate(true)
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [shouldOpenCreate, handledOpenKey, location, navigate])

  const [name, setName] = useState('')
  const [color, setColor] = useState(COLOR_PRESETS[0])
  const [targetPerWeek, setTargetPerWeek] = useState(7)
  const [schedule, setSchedule] = useState<number[] | null>(null)
  const [linkNoSpend, setLinkNoSpend] = useState(false)

  // The joint streak is refetched any time a habit's entries (or set of
  // active habits) could have changed, since it's a cross-habit aggregate
  // no single habit mutation response carries.
  const refreshJointStats = async () => {
    try {
      setJointStats(await loadJointStats())
    } catch (err) {
      addToast({ message: errorMessage(err, "Could not refresh habits' joint streak.") })
    }
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([
      loadHabits().catch((err) => {
        if (!cancelled) addToast({ message: errorMessage(err, 'Could not load your habits.') })
      }),
      loadJointStats()
        .then((stats) => {
          if (!cancelled) setJointStats(stats)
        })
        .catch((err) => {
          if (!cancelled) addToast({ message: errorMessage(err, "Could not load habits' joint streak.") })
        }),
    ]).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [loadHabits, loadJointStats, addToast])

  const resetForm = () => {
    setName('')
    setColor(COLOR_PRESETS[0])
    setTargetPerWeek(7)
    setSchedule(null)
    setLinkNoSpend(false)
  }

  const toggleScheduleDay = (day: number) => {
    setSchedule((prev) => {
      const base = prev ?? [0, 1, 2, 3, 4, 5, 6]
      const next = base.includes(day) ? base.filter((d) => d !== day) : [...base, day].sort()
      return next.length === 7 ? null : next
    })
  }

  const handleCreate = async () => {
    if (!name.trim()) return
    try {
      await createHabit({
        name: name.trim(),
        color,
        targetPerWeek: linkNoSpend ? 7 : targetPerWeek,
        schedule: linkNoSpend ? null : schedule,
        linkedKind: linkNoSpend ? 'wallet:no-spend' : null,
      })
      setShowCreate(false)
      resetForm()
      void refreshJointStats()
    } catch {
      // createHabit already toasted the failure.
    }
  }

  const active = habits.filter((h) => !h.archived)
  // Anchored to the server's own "today" (the last entry of the 28-day
  // window every habit was computed against) rather than a client Date —
  // keeps every per-habit calculation below in agreement with computeStats.
  const today = active[0]?.stats.entries.at(-1)?.date ?? ''
  const pooledWeekday = pooledWeekdayStats(active)

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Habits</h1>
          <span className="page-sub hide-mobile">
            {active.length} active{jointStats.currentStreak > 0 ? ` · ${jointStats.currentStreak}-day streak` : ''}
          </span>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)} data-testid="habit-new-btn">
            <Plus className="h-4 w-4" />
            New habit
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-fg-subtle">Loading your habits…</p>
      ) : habits.length === 0 ? (
        <p className="py-3 text-sm text-fg-subtle" data-testid="habits-empty">
          No habits yet. Start with something you already do — a habit tracks
          whether you kept it, not whether it's on your to-do list today.
        </p>
      ) : (
        <div className="dash">
          <ConsistencyCard habits={active} today={today} jointStats={jointStats} pooledWeekday={pooledWeekday} />

          {active.map((habit, i) => (
            <HabitCard
              key={habit.id}
              habit={habit}
              ringColor={habit.color || RING_COLORS[i % RING_COLORS.length]}
              onToggleDay={(date) => {
                void toggleHabitEntry(habit.id, date).then(() => refreshJointStats())
              }}
              onArchive={() => {
                void updateHabit(habit.id, { archived: true }).then(() => refreshJointStats())
              }}
              onDelete={() => {
                void deleteHabit(habit.id).then(() => refreshJointStats())
              }}
            />
          ))}

          <WeekdayCard pooled={pooledWeekday} />
          <WorthKnowingCard habits={active} />
        </div>
      )}

      <Modal
        open={showCreate}
        onOpenChange={(open) => {
          setShowCreate(open)
          if (!open) resetForm()
        }}
        title="New habit"
        className="max-w-sm"
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Read for 20 minutes"
            data-testid="habit-name-input"
          />

          <label className="flex items-center gap-2 text-sm text-fg-muted">
            <input
              type="checkbox"
              checked={linkNoSpend}
              onChange={(e) => setLinkNoSpend(e.target.checked)}
              data-testid="habit-link-no-spend-checkbox"
            />
            Link to Wallet — done automatically on any day with no expense
          </label>

          {!linkNoSpend && (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-fg-muted">Colour</span>
                <div className="flex flex-wrap gap-2">
                  {COLOR_PRESETS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="flex h-8 w-8 items-center justify-center rounded-full"
                      onClick={() => setColor(c)}
                      aria-label={`Select colour ${c}`}
                    >
                      <span
                        className={cn(
                          'h-6 w-6 rounded-full border-2 transition-transform',
                          color === c ? 'scale-110 border-fg' : 'border-transparent',
                        )}
                        style={{ backgroundColor: c }}
                        aria-hidden="true"
                      />
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-fg-muted">Due on</span>
                <div className="flex gap-1.5">
                  {WEEKDAY_LABELS.map((label, day) => (
                    <button
                      key={day}
                      type="button"
                      data-testid={`habit-schedule-day-${day}`}
                      onClick={() => toggleScheduleDay(day)}
                      className={cn(
                        'h-8 w-8 rounded-full border text-xs',
                        schedule === null || schedule.includes(day)
                          ? 'border-brand-500 bg-brand-50 text-brand-700'
                          : 'border-line-strong bg-surface text-fg-muted',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <label htmlFor="habit-target" className="text-sm text-fg-muted">
                  Target
                </label>
                <input
                  id="habit-target"
                  type="number"
                  min={1}
                  max={7}
                  value={targetPerWeek}
                  onChange={(e) => setTargetPerWeek(Math.min(7, Math.max(1, Number(e.target.value) || 1)))}
                  className="w-16 rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
                <span className="text-sm text-fg-muted">times/week</span>
              </div>
            </>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button size="sm" data-testid="habit-create-save-btn" onClick={handleCreate} disabled={!name.trim()}>
              Create
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

/** "Consistency" — the page's new first card (c12): the pooled kept-rate
 * band-fig, the current/longest/weakest-day stats, and the "K of N above
 * 70%" chip. */
function ConsistencyCard({
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
  const longestOngoing =
    longest.bestStreak > 0 && longest.bestStreakEnd === today && longestHabit?.stats.currentStreak === longest.bestStreak

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

/** One per-habit card (c6, 2-up) — ring, dots strip, streak foot, options popover. */
function HabitCard({
  habit,
  ringColor,
  onToggleDay,
  onArchive,
  onDelete,
}: {
  habit: Habit
  ringColor: string
  onToggleDay: (date: string) => void
  onArchive: () => void
  onDelete: () => void
}) {
  const pct = Math.round(keptRate28(habit) * 100)
  const dashLen = (pct / 100) * RING_CIRCUMFERENCE

  return (
    <section className="card card-pad c6" data-testid="habit-card" data-habit-id={habit.id}>
      <div className="habit">
        <div className="ring">
          <svg viewBox="0 0 92 92" role="img" aria-label={`${habit.name} completed ${pct}% of days.`}>
            <circle cx="46" cy="46" r={RING_RADIUS} stroke="rgb(var(--track))" />
            <circle
              cx="46"
              cy="46"
              r={RING_RADIUS}
              stroke={ringColor}
              strokeDasharray={`${dashLen} ${RING_CIRCUMFERENCE}`}
            />
          </svg>
          <div className="ring-center">
            <span className="v">{pct}%</span>
            <span className="k">28 DAYS</span>
          </div>
        </div>

        <div className="habit-main">
          <div className="goal-name">{habit.name}</div>
          <div className="goal-sub">{scheduleDescription(habit)}</div>

          <div className="dots" data-testid="habit-grid">
            {habit.stats.entries.map((entry) => {
              const linked = !!habit.linkedKind
              return (
                <i
                  key={entry.date}
                  role={linked ? undefined : 'button'}
                  tabIndex={linked ? undefined : 0}
                  aria-label={`${entry.date}${entry.due ? (entry.done ? ' — kept' : ' — missed') : ' — not due'}`}
                  title={`${entry.date}${entry.due ? (entry.done ? ' — kept' : ' — missed') : ' — not due'}`}
                  data-testid={`habit-grid-day-${entry.date}`}
                  onClick={linked ? undefined : () => onToggleDay(entry.date)}
                  onKeyDown={
                    linked
                      ? undefined
                      : (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onToggleDay(entry.date)
                          }
                        }
                  }
                  className={cn(entry.due && entry.done && 'on', entry.due && !entry.done && 'miss', linked && 'cursor-default')}
                />
              )
            })}
          </div>

          <div className="stat-foot">
            <span className="streak" data-testid="habit-current-streak" style={{ color: ringColor }}>
              <Flame className="h-3.5 w-3.5" />
              {habit.stats.currentStreak}-day streak
            </span>
            <span data-testid="habit-best-streak">
              best {habit.stats.bestStreak} day{habit.stats.bestStreak === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        <HabitOptionsMenu onArchive={onArchive} onDelete={onDelete} />
      </div>
    </section>
  )
}

/** "Habit options" (⋮) popover — Archive / Delete. Same outside-click +
 * Escape pattern as `src/components/layout/AccountMenu.tsx`'s own menu, but
 * with its OWN small `.row-menu` styling (review fix #10; renamed from
 * `.habit-menu` by FEAT-062 review fix #9 once `TaskListRow.tsx`'s
 * `RowMoreMenu` started reusing this exact same CSS for tasks, not just
 * habits) rather than reusing that menu's `.menu-panel` — a 328px panel
 * fixed to the account button's own corner of the app bar, which clipped and
 * mispositioned once reused for a small per-card popover anywhere narrower
 * than 1280px. Also carries real popup-menu semantics: `role="menu"`/
 * `"menuitem"`, focus moves into the first item on open and back to the
 * trigger on close. */
function HabitOptionsMenu({ onArchive, onDelete }: { onArchive: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const firstItemRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    firstItemRef.current?.focus()
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  // Closing by any route (item click, outside click, Escape) returns focus
  // to the trigger — only the item-click path can do so itself (the other
  // two close via state updates with no "this closed" callback), so this
  // effect catches every case including those.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !open) triggerRef.current?.focus()
    wasOpen.current = open
  }, [open])

  return (
    <div className="pop-anchor" ref={containerRef}>
      <button
        type="button"
        ref={triggerRef}
        className="icon-btn"
        aria-label="Habit options"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div className="row-menu open" role="menu" aria-label="Habit options" data-testid="habit-options-menu">
          <button
            type="button"
            role="menuitem"
            ref={firstItemRef}
            className="row-menu-item"
            onClick={() => {
              setOpen(false)
              onArchive()
            }}
          >
            <Archive className="icon h-4 w-4" />
            Archive
          </button>
          <button
            type="button"
            role="menuitem"
            className="row-menu-item"
            onClick={() => {
              setOpen(false)
              onDelete()
            }}
          >
            <Trash2 className="icon h-4 w-4" />
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

/** "Kept by weekday" (c8) — the pooled kept/due per weekday computed once in
 * `TasksHabitsPage` (`pooledWeekdayStats`, review fix #2) and shared with the
 * Consistency card's "Weakest day" stat, so the two can't disagree. */
function WeekdayCard({ pooled }: { pooled: { due: number[]; kept: number[]; rates: number[] } }) {
  const { due: dueByWeekday, kept: keptByWeekday, rates } = pooled
  if (dueByWeekday.every((d) => d === 0)) return null

  const totalDue = dueByWeekday.reduce((s, n) => s + n, 0)
  const totalKept = keptByWeekday.reduce((s, n) => s + n, 0)
  const avgPct = totalDue > 0 ? (totalKept / totalDue) * 100 : 0
  // Review fix #8: only weekdays with at least one due day are candidates
  // for "highest" — otherwise, when every pooled rate is a tied 0 (no data
  // yet, or everything missed), `rates[weekday] >= maxRate` (0 >= 0) would
  // be true for every bar and highlight all of them at once.
  const ratesWithDue = WEEK_DISPLAY_ORDER.filter((wd) => dueByWeekday[wd] > 0).map((wd) => rates[wd])
  const maxRate = ratesWithDue.length > 0 ? Math.max(...ratesWithDue) : 0

  const below70 = WEEK_DISPLAY_ORDER.filter((weekday) => dueByWeekday[weekday] > 0 && rates[weekday] < 0.7)
  const insight =
    below70.length === 0
      ? 'Every day is holding at 70% or higher.'
      : below70.length === 1
        ? `${WEEKDAY_FULL[below70[0]]} is the only day below 70%.`
        : below70.length === 2
          ? `${WEEKDAY_FULL[below70[0]]} and ${WEEKDAY_FULL[below70[1]]} are below 70%.`
          : `${below70.map((d) => WEEKDAY_FULL[d]).join(', ')} are below 70%.`

  return (
    <section className="card card-pad c8" data-testid="habits-weekday-card">
      <div className="card-head">
        <div>
          <span className="card-title">Kept by weekday</span>
          <div className="card-sub">All habits, last 4 weeks</div>
        </div>
      </div>
      <div className="bars" data-testid="habits-weekday-bars">
        <div className="bars-avg" style={{ bottom: `${(avgPct / 100) * BAR_MAX_PX + BAR_FOOT_OFFSET_PX}px` }}>
          <span>{Math.round(avgPct)}% avg</span>
        </div>
        {WEEK_DISPLAY_ORDER.map((weekday) => {
          const hasDue = dueByWeekday[weekday] > 0
          const pct = hasDue ? Math.round(rates[weekday] * 100) : null
          // Review fix #8: "0% kept" and "nothing due" are different facts —
          // a weekday nothing is due on renders as an honest empty bar, not
          // a misleading 0%, and can never qualify for the `.hi` highlight.
          return (
            <div key={weekday} className={cn('bar', hasDue && maxRate > 0 && rates[weekday] >= maxRate && 'hi')}>
              <span className="bar-val">{hasDue ? `${pct}%` : '—'}</span>
              <div className="bar-fill" style={{ height: hasDue ? `${(pct! / 100) * BAR_MAX_PX}px` : '0px' }} />
              <span className="bar-day">{WEEKDAY_SHORT[weekday]}</span>
            </div>
          )
        })}
      </div>
      <div className="divider" />
      <p className="text-sm text-fg-subtle" data-testid="habits-weekday-insight">
        {insight}
      </p>
    </section>
  )
}

/** "Worth knowing" (c4) — honest, text-only insight rows (no action buttons,
 * same precedent as `TasksTodayPage.tsx`'s `worthKnowing` array). Omitted
 * entirely when none of the three conditions fire. */
function WorthKnowingCard({ habits }: { habits: Habit[] }) {
  const rows: { icon: typeof AlertTriangle; title: string; sub: string }[] = []

  if (habits.length > 0) {
    const withRates = habits.map((h) => ({ habit: h, rate: keptRate28(h) }))

    const weakest = withRates.reduce((a, b) => (b.rate < a.rate ? b : a))
    if (weakest.rate < 0.6) {
      const { kept, due } = keptAndDue(weakest.habit.stats.entries)
      rows.push({
        icon: AlertTriangle,
        title: `"${weakest.habit.name}" is at ${Math.round(weakest.rate * 100)}%`,
        sub: `kept ${kept} of ${due} due days`,
      })
    }

    const strongest = withRates.reduce((a, b) => (b.rate > a.rate ? b : a))
    if (strongest.rate >= 0.85 && strongest.habit.stats.bestStreak >= 14) {
      rows.push({
        icon: Flame,
        title: `"${strongest.habit.name}" is holding strong`,
        sub: `${Math.round(strongest.rate * 100)}% kept, ${strongest.habit.stats.bestStreak}-day best streak`,
      })
    }

    // Review fix #7: average only the weekdays the habit is actually due on
    // — averaging all 7 raw `weekdayRates` unconditionally counts an
    // unscheduled day as a 0 that drags the average down, so a 100%-kept
    // Mon–Fri habit scored 5/7 ≈ 0.71 and never qualified for this row.
    const aboveTwelveWeeks = habits.filter((h) => {
      const dueWeekdays = [0, 1, 2, 3, 4, 5, 6].filter((wd) => isDueOn(h.schedule, wd))
      if (dueWeekdays.length === 0) return false
      const avg = dueWeekdays.reduce((s, wd) => s + h.stats.weekdayRates[wd], 0) / dueWeekdays.length
      return avg >= 0.8
    })
    if (aboveTwelveWeeks.length > 0) {
      rows.push({
        icon: Sparkles,
        title: 'A habit kept above 80% for 12 weeks almost never lapses.',
        sub: `${aboveTwelveWeeks.length} of yours ${aboveTwelveWeeks.length === 1 ? 'is' : 'are'} there.`,
      })
    }
  }

  if (rows.length === 0) return null

  return (
    <section className="card card-pad c4" data-testid="habits-worth-knowing-card">
      <div className="card-head">
        <span className="card-title">Worth knowing</span>
      </div>
      <div>
        {rows.map((row) => (
          <div key={row.title} className="sug">
            <div className="tavatar" aria-hidden="true">
              <row.icon className="h-4 w-4" />
            </div>
            <div className="sug-main">
              <p className="sug-title">{row.title}</p>
              <p className="sug-sub">{row.sub}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
