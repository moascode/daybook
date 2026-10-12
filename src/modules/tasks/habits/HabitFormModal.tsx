import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { COLOR_PRESETS, WEEKDAY_FULL, WEEKDAY_LABELS } from './habitMath'
import type { Habit, HabitLinkedKind } from '@/types/habits.types'

export interface HabitFormValues {
  name: string
  color: string
  targetPerWeek: number
  schedule: number[] | null
  linkedKind: HabitLinkedKind | null
}

function valuesFromHabit(habit: Habit): HabitFormValues {
  return {
    name: habit.name,
    color: habit.color,
    targetPerWeek: habit.targetPerWeek,
    schedule: habit.schedule,
    linkedKind: habit.linkedKind,
  }
}

function blankValues(): HabitFormValues {
  return { name: '', color: COLOR_PRESETS[0], targetPerWeek: 7, schedule: null, linkedKind: null }
}

/** Create/edit modal for a habit — the same form either way (item #1):
 * editing pre-fills every field `habit` (non-null) is passed, and saves
 * through the caller's `onSubmit`, which routes to `createHabit` or
 * `updateHabit` depending on which the caller is doing. */
export function HabitFormModal({
  open,
  habit,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  /** The habit being edited, or null when this is "New habit". */
  habit: Habit | null
  onOpenChange: (open: boolean) => void
  onSubmit: (values: HabitFormValues) => Promise<void>
}) {
  const [values, setValues] = useState<HabitFormValues>(blankValues())
  const [saving, setSaving] = useState(false)
  const linkNoSpend = values.linkedKind === 'wallet:no-spend'

  // Re-seed the form whenever a different habit is opened for editing, or
  // the modal is opened fresh for "New habit".
  useEffect(() => {
    // Re-seeding on open/habit change, not a derivable render-time value.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setValues(habit ? valuesFromHabit(habit) : blankValues())
  }, [open, habit])

  const toggleScheduleDay = (day: number) => {
    setValues((prev) => {
      const base = prev.schedule ?? [0, 1, 2, 3, 4, 5, 6]
      const next = base.includes(day) ? base.filter((d) => d !== day) : [...base, day].sort()
      return { ...prev, schedule: next.length === 7 ? null : next }
    })
  }

  const handleSubmit = async () => {
    if (!values.name.trim()) return
    setSaving(true)
    try {
      await onSubmit({
        ...values,
        name: values.name.trim(),
        targetPerWeek: linkNoSpend ? 7 : values.targetPerWeek,
        schedule: linkNoSpend ? null : values.schedule,
      })
      onOpenChange(false)
    } catch {
      // The caller's create/update already toasted the failure — leave the
      // modal open with the user's input intact so they can retry.
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={habit ? 'Edit habit' : 'New habit'} className="max-w-sm">
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={values.name}
          onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
          placeholder="e.g. Read for 20 minutes"
          data-testid="habit-name-input"
        />

        <label className="flex items-center gap-2 text-sm text-fg-muted">
          <input
            type="checkbox"
            checked={linkNoSpend}
            disabled={!!habit}
            onChange={(e) => setValues((v) => ({ ...v, linkedKind: e.target.checked ? 'wallet:no-spend' : null }))}
            data-testid="habit-link-no-spend-checkbox"
          />
          Link to Wallet — done automatically on any day with no expense
          {habit && <span className="text-fg-faint"> (set once, at creation)</span>}
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
                    onClick={() => setValues((v) => ({ ...v, color: c }))}
                    aria-label={`Colour ${c}`}
                    aria-pressed={values.color === c}
                  >
                    <span
                      className={cn(
                        'h-6 w-6 rounded-full border-2 transition-transform',
                        values.color === c ? 'scale-110 border-fg' : 'border-transparent',
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
                {WEEKDAY_LABELS.map((label, day) => {
                  const due = values.schedule === null || values.schedule.includes(day)
                  return (
                    <button
                      key={day}
                      type="button"
                      data-testid={`habit-schedule-day-${day}`}
                      onClick={() => toggleScheduleDay(day)}
                      aria-pressed={due}
                      aria-label={WEEKDAY_FULL[day]}
                      className={cn(
                        'h-8 w-8 rounded-full border text-xs',
                        due ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line-strong bg-surface text-fg-muted',
                      )}
                    >
                      {label}
                    </button>
                  )
                })}
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
                value={values.targetPerWeek}
                onChange={(e) =>
                  setValues((v) => ({ ...v, targetPerWeek: Math.min(7, Math.max(1, Number(e.target.value) || 1)) }))
                }
                className="w-16 rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
              <span className="text-sm text-fg-muted">times/week</span>
            </div>
          </>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            data-testid="habit-create-save-btn"
            onClick={handleSubmit}
            disabled={!values.name.trim()}
            loading={saving}
          >
            {habit ? 'Save' : 'Create'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
