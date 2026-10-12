import { AlertTriangle, Flame, Sparkles } from 'lucide-react'
import { useToastStore } from '@/stores/toast.store'
import { isDueOn, keptAndDue, keptRate28 } from './habitMath'
import type { Habit } from '@/types/habits.types'

interface WorthKnowingRow {
  icon: typeof AlertTriangle
  title: string
  sub: string
  /** Mockup's one real action on this card — "Lower it" on the weakest
   * habit, lowering its weekly target by one. Every other row stays
   * text-only: CLAUDE.md §2 rule 10 — a button only belongs here when there
   * is an honest, specific action behind it, not decoration. */
  action?: { label: string; onClick: () => void }
}

/** "Worth knowing" (c4) — honest insight rows. Two of the three are
 * text-only (no action genuinely fits "the run survives everything" or "12
 * weeks above 80%" — there's nothing to DO about those); the weakest-habit
 * row gets "Lower it", since lowering `targetPerWeek` by one is a real,
 * reversible action the data supports. Omitted entirely when none of the
 * three conditions fire. */
export function WorthKnowingCard({
  habits,
  onLowerTarget,
}: {
  habits: Habit[]
  onLowerTarget: (habit: Habit) => Promise<void>
}) {
  const addToast = useToastStore((s) => s.addToast)
  const rows: WorthKnowingRow[] = []

  if (habits.length > 0) {
    const withRates = habits.map((h) => ({ habit: h, rate: keptRate28(h) }))

    const weakest = withRates.reduce((a, b) => (b.rate < a.rate ? b : a))
    if (weakest.rate < 0.6) {
      const { kept, due } = keptAndDue(weakest.habit.stats.entries)
      rows.push({
        icon: AlertTriangle,
        title: `"${weakest.habit.name}" is at ${Math.round(weakest.rate * 100)}%`,
        sub: `kept ${kept} of ${due} due days`,
        action:
          weakest.habit.targetPerWeek > 1
            ? {
                label: 'Lower it',
                onClick: async () => {
                  try {
                    await onLowerTarget(weakest.habit)
                    addToast({ message: `Lowered "${weakest.habit.name}" to ${weakest.habit.targetPerWeek - 1} times/week.` })
                  } catch {
                    // onLowerTarget (updateHabit) already toasted the failure.
                  }
                },
              }
            : undefined,
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
            {row.action && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={row.action.onClick}>
                {row.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
