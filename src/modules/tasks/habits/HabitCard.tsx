import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Flame } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ConfirmDeleteModal } from '@/components/ui/ConfirmDeleteModal'
import { HabitOptionsMenu } from './HabitOptionsMenu'
import { keptRate28, scheduleDescription, RING_RADIUS, RING_CIRCUMFERENCE } from './habitMath'
import type { Habit } from '@/types/habits.types'

/** One per-habit card (c6, 2-up) — ring, dots strip, streak foot, options
 * popover. `today` (the server's own "today", see TasksHabitsPage) picks out
 * the one dot that is due-but-not-yet-decided rather than due-and-missed. */
export function HabitCard({
  habit,
  ringColor,
  today,
  pendingToggles,
  onToggleDay,
  onEdit,
  onArchive,
  onDelete,
}: {
  habit: Habit
  ringColor: string
  today: string
  pendingToggles: Set<string>
  onToggleDay: (date: string) => void
  onEdit: () => void
  onArchive: () => void
  onDelete: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const pct = Math.round(keptRate28(habit) * 100)
  const dashLen = (pct / 100) * RING_CIRCUMFERENCE
  const linked = !!habit.linkedKind

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
              // Today's dot, due but not yet decided, is neither "kept" nor
              // "missed" — the day isn't over. Only a manually-tracked habit
              // gets this distinct state; a linked habit's `done` is already
              // derived from something that happened (or didn't), so there
              // is nothing left pending to render as undecided.
              const isTodayPending = !linked && entry.due && !entry.done && entry.date === today
              const status = entry.due ? (entry.done ? 'kept' : isTodayPending ? 'not yet kept' : 'missed') : 'not due'
              // "Mon 12 Oct — kept/missed/not due" — short weekday + day +
              // month, not the raw YYYY-MM-DD, per item #10's a11y spec.
              const label = `${format(parseISO(entry.date), 'EEE d MMM')} — ${status}`
              const key = `${habit.id}:${entry.date}`
              const pending = pendingToggles.has(key)
              return (
                <i
                  key={entry.date}
                  role={linked ? undefined : 'button'}
                  tabIndex={linked ? undefined : 0}
                  aria-label={label}
                  aria-pressed={linked ? undefined : entry.due && entry.done}
                  aria-disabled={linked ? undefined : pending}
                  title={label}
                  data-testid={`habit-grid-day-${entry.date}`}
                  onClick={linked || pending ? undefined : () => onToggleDay(entry.date)}
                  onKeyDown={
                    linked || pending
                      ? undefined
                      : (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onToggleDay(entry.date)
                          }
                        }
                  }
                  className={cn(
                    entry.due && entry.done && 'on',
                    entry.due && !entry.done && !isTodayPending && 'miss',
                    isTodayPending && 'today-pending',
                    linked && 'cursor-default',
                  )}
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

        <HabitOptionsMenu onEdit={onEdit} onArchive={onArchive} onDelete={() => setConfirmDelete(true)} />
      </div>

      <ConfirmDeleteModal
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete habit?"
        description={`"${habit.name}" and its whole history will be removed. This can't be undone.`}
        confirmLabel="Delete"
        confirmTestId="habit-delete-confirm-btn"
        onConfirm={() => {
          setConfirmDelete(false)
          onDelete()
        }}
      />
    </section>
  )
}
