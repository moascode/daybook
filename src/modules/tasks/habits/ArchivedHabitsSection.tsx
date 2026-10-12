import { useState } from 'react'
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'
import { scheduleDescription } from './habitMath'
import type { Habit } from '@/types/habits.types'

/** "Archived (N)" — collapsible, loaded lazily (item #8): the default
 * `GET /habits` call excludes archived habits, so this section only fetches
 * them (`loadHabits(true)`) the first time it's opened, not on every page
 * load. Restore is a real action because `PATCH /habits/:id` already
 * accepts `archived: false` (worker/routes/habits.ts's `updateRow` sets
 * whatever column is present in the body, false included) — if that ever
 * stopped being true this list would need to drop Restore and say so, not
 * leave a dead button. */
export function ArchivedHabitsSection({
  archived,
  loading,
  loaded,
  onExpand,
  onRestore,
}: {
  archived: Habit[]
  loading: boolean
  /** Whether the archived-included fetch has completed at least once —
   * until then `archived.length` is just "however many archived habits
   * happened to already be in state from this session", not a real count,
   * so the count is withheld rather than shown as a guess. */
  loaded: boolean
  onExpand: () => void
  onRestore: (habit: Habit) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <section className="card card-pad c12" data-testid="habits-archived-section">
      <button
        type="button"
        className="habits-archived-toggle flex w-full items-center gap-2 text-left"
        aria-expanded={open}
        data-testid="habits-archived-toggle"
        onClick={() => {
          const next = !open
          setOpen(next)
          if (next) onExpand()
        }}
      >
        {open ? <ChevronDown className="h-4 w-4 text-fg-faint" /> : <ChevronRight className="h-4 w-4 text-fg-faint" />}
        <span className="card-title">Archived{loaded ? ` (${archived.length})` : ''}</span>
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-2">
          {loading ? (
            <p className="text-sm text-fg-subtle">Loading archived habits…</p>
          ) : archived.length === 0 ? (
            <p className="text-sm text-fg-subtle">No archived habits.</p>
          ) : (
            archived.map((habit) => (
              <div
                key={habit.id}
                className="habit-archived-row flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2"
                data-testid="habit-archived-row"
                data-habit-id={habit.id}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg">{habit.name}</p>
                  <p className="truncate text-xs text-fg-subtle">{scheduleDescription(habit)}</p>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm shrink-0"
                  onClick={() => onRestore(habit)}
                  aria-label={`Restore ${habit.name}`}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Restore
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  )
}
