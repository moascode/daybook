import { useEffect, useState } from 'react'
import { Flame, Plus, Trash2, Archive } from 'lucide-react'
import { cn, errorMessage } from '@/lib/utils'
import { useHabits } from '@/hooks/useHabits'
import { useToastStore } from '@/stores/toast.store'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import type { Habit } from '@/types/habits.types'

const COLOR_PRESETS = [
  '#10b981', '#059669', '#3b82f6', '#6366f1',
  '#8b5cf6', '#ef4444', '#f97316', '#eab308',
  '#ec4899', '#14b8a6',
]

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/**
 * Habits — `/tasks/habits` (FEAT-029, docs/backlog/EP-07-tasks-depth/FEAT-029-tasks-habits.md).
 * A habit is a repeated commitment tracked by day, not a due-dated task
 * instance — rings/streaks/grid/weekday chart all come pre-computed from
 * `GET /habits` (worker/routes/habits.ts's computeStats), so this page is a
 * pure renderer over `habit.stats` plus the create/toggle/archive actions.
 */
export function TasksHabitsPage() {
  const { habits, loadHabits, createHabit, updateHabit, deleteHabit, toggleHabitEntry } = useHabits()
  const addToast = useToastStore((s) => s.addToast)
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  const [name, setName] = useState('')
  const [color, setColor] = useState(COLOR_PRESETS[0])
  const [targetPerWeek, setTargetPerWeek] = useState(7)
  const [schedule, setSchedule] = useState<number[] | null>(null)
  const [linkNoSpend, setLinkNoSpend] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadHabits()
      .catch((err) => {
        if (!cancelled) addToast({ message: errorMessage(err, 'Could not load your habits.') })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [loadHabits, addToast])

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
    } catch {
      // createHabit already toasted the failure.
    }
  }

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Habits</h1>
          <p className="page-sub">Repeated commitments, tracked by day — a different shape from a due-dated task.</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)} data-testid="habit-new-btn">
          <Plus className="h-4 w-4" />
          New habit
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-fg-subtle">Loading your habits…</p>
      ) : habits.length === 0 ? (
        <p className="py-3 text-sm text-fg-subtle" data-testid="habits-empty">
          No habits yet. Start with something you already do — a habit tracks
          whether you kept it, not whether it's on your to-do list today.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {habits.map((habit) => (
            <HabitCard
              key={habit.id}
              habit={habit}
              onToggleDay={(date) => toggleHabitEntry(habit.id, date)}
              onArchive={() => updateHabit(habit.id, { archived: true })}
              onDelete={() => deleteHabit(habit.id)}
            />
          ))}
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

function HabitCard({
  habit,
  onToggleDay,
  onArchive,
  onDelete,
}: {
  habit: Habit
  onToggleDay: (date: string) => void
  onArchive: () => void
  onDelete: () => void
}) {
  const worstWeekday = habit.stats.weekdayRates
    .map((rate, day) => ({ day, rate }))
    .filter((w) => w.rate < 0.7)
    .sort((a, b) => a.rate - b.rate)[0]
  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

  return (
    <div className="card card-pad" data-testid="habit-card" data-habit-id={habit.id}>
      <div className="card-head">
        <span className="card-title flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: habit.color }} aria-hidden="true" />
          {habit.name}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded p-1 text-fg-faint hover:bg-surface-hover hover:text-fg-muted"
            aria-label="Archive habit"
            onClick={onArchive}
          >
            <Archive className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="rounded p-1 text-fg-faint hover:bg-red-50 hover:text-red-600"
            aria-label="Delete habit"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-4 text-sm">
        <span className="flex items-center gap-1 font-medium text-fg" data-testid="habit-current-streak">
          <Flame className="h-4 w-4 text-orange-500" />
          {habit.stats.currentStreak} day{habit.stats.currentStreak === 1 ? '' : 's'}
        </span>
        <span className="text-fg-subtle" data-testid="habit-best-streak">
          Best: {habit.stats.bestStreak}
        </span>
        {habit.linkedKind === 'wallet:no-spend' && <span className="chip chip-mute">Linked · Wallet</span>}
      </div>

      {/* 28-day grid — kept (green), missed-due (red), not-due (grey) */}
      <div className="mb-3 grid grid-cols-7 gap-1" data-testid="habit-grid">
        {habit.stats.entries.map((entry) => (
          <button
            key={entry.date}
            type="button"
            disabled={!!habit.linkedKind}
            title={`${entry.date}${entry.due ? (entry.done ? ' — kept' : ' — missed') : ' — not due'}`}
            onClick={() => !habit.linkedKind && onToggleDay(entry.date)}
            data-testid={`habit-grid-day-${entry.date}`}
            className={cn(
              'h-4 w-4 rounded-sm',
              !entry.due && 'bg-surface-sunken',
              entry.due && entry.done && 'bg-emerald-500',
              entry.due && !entry.done && 'bg-red-300',
              habit.linkedKind ? 'cursor-default' : 'cursor-pointer',
            )}
          />
        ))}
      </div>

      {/* Weekday chart */}
      <div className="flex items-end gap-1.5" data-testid="habit-weekday-chart">
        {habit.stats.weekdayRates.map((rate, day) => (
          <div key={day} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex h-10 w-full items-end rounded bg-surface-sunken">
              <div
                className="w-full rounded bg-brand-500"
                style={{ height: `${Math.round(rate * 100)}%` }}
                aria-hidden="true"
              />
            </div>
            <span className="text-[10px] text-fg-faint">{WEEKDAY_LABELS[day]}</span>
          </div>
        ))}
      </div>

      {worstWeekday && (
        <p className="mt-2 text-xs text-fg-subtle" data-testid="habit-insight">
          {dayName[worstWeekday.day]} is the weakest day — kept {Math.round(worstWeekday.rate * 100)}% of the time.
        </p>
      )}
    </div>
  )
}
