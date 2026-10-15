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
  /** Every N days (2..365); null when the habit uses `schedule` instead. */
  intervalDays: number | null
  linkedKind: HabitLinkedKind | null
}

function valuesFromHabit(habit: Habit): HabitFormValues {
  return {
    name: habit.name,
    color: habit.color,
    targetPerWeek: habit.targetPerWeek,
    schedule: habit.schedule,
    intervalDays: habit.intervalDays,
    linkedKind: habit.linkedKind,
  }
}

type Frequency = 'daily' | 'days' | 'interval'

const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: 'daily', label: 'Every day' },
  { value: 'days', label: 'Specific days' },
  { value: 'interval', label: 'Every N days' },
]

const DEFAULT_INTERVAL = 2
const MIN_INTERVAL = 2
const MAX_INTERVAL = 365

function frequencyOf(values: HabitFormValues): Frequency {
  if (values.intervalDays !== null) return 'interval'
  return values.schedule !== null ? 'days' : 'daily'
}

/** Inline validation message for the N-days field, or null when it is a whole number in range. */
function intervalProblem(raw: string): string | null {
  const n = Number(raw)
  if (raw.trim() === '' || !Number.isInteger(n) || n < MIN_INTERVAL || n > MAX_INTERVAL) {
    return `Enter a whole number from ${MIN_INTERVAL} to ${MAX_INTERVAL}.`
  }
  return null
}

function blankValues(): HabitFormValues {
  return { name: '', color: COLOR_PRESETS[0], targetPerWeek: 7, schedule: null, intervalDays: null, linkedKind: null }
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
  // Explicit, not derived from `values`: "Specific days" with all seven days
  // on is stored as schedule=null, which would otherwise snap the choice back
  // to "Every day" under the user's cursor.
  const [frequency, setFrequency] = useState<Frequency>('daily')
  // Text, so the field can be emptied while typing; validated on save.
  const [intervalText, setIntervalText] = useState(String(DEFAULT_INTERVAL))
  const [intervalError, setIntervalError] = useState<string | null>(null)

  // Re-seed the form whenever a different habit is opened for editing, or
  // the modal is opened fresh for "New habit".
  useEffect(() => {
    // Re-seeding on open/habit change, not a derivable render-time value.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (open) {
      const seeded = habit ? valuesFromHabit(habit) : blankValues()
      setValues(seeded)
      setFrequency(frequencyOf(seeded))
      setIntervalText(String(seeded.intervalDays ?? DEFAULT_INTERVAL))
      setIntervalError(null)
    }
    /* eslint-enable react-hooks/set-state-in-effect */
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
    const useInterval = !linkNoSpend && frequency === 'interval'
    if (useInterval) {
      const problem = intervalProblem(intervalText)
      if (problem) {
        setIntervalError(problem)
        return
      }
    }
    const intervalDays = useInterval ? Number(intervalText) : null
    setSaving(true)
    try {
      await onSubmit({
        ...values,
        name: values.name.trim(),
        // An N-day cycle fits ceil(7/N) due days in a week; the server derives
        // the same figure, so this is only the optimistic value.
        targetPerWeek: linkNoSpend ? 7 : intervalDays !== null ? Math.ceil(7 / intervalDays) : values.targetPerWeek,
        schedule: linkNoSpend || frequency !== 'days' ? null : values.schedule,
        intervalDays,
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
              <span className="text-sm font-medium text-fg-muted">Repeat</span>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Habit cadence">
                {FREQUENCY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    data-testid={`habit-frequency-${opt.value}`}
                    aria-pressed={frequency === opt.value}
                    onClick={() => {
                      setFrequency(opt.value)
                      setIntervalError(null)
                      // "Every day" lights every weekday toggle, so they never disagree.
                      if (opt.value === 'daily') setValues((prev) => ({ ...prev, schedule: null }))
                    }}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs',
                      frequency === opt.value
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-line-strong bg-surface text-fg-muted',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {frequency === 'interval' && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <label htmlFor="habit-interval-days" className="text-sm text-fg-muted">
                    Every
                  </label>
                  <input
                    id="habit-interval-days"
                    data-testid="habit-interval-input"
                    type="number"
                    inputMode="numeric"
                    min={MIN_INTERVAL}
                    max={MAX_INTERVAL}
                    value={intervalText}
                    onChange={(e) => {
                      setIntervalText(e.target.value)
                      setIntervalError(null)
                    }}
                    aria-invalid={intervalError !== null}
                    className="w-20 rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                  <span className="text-sm text-fg-muted">days</span>
                </div>
                {intervalError && (
                  <p className="text-xs text-red-500" role="alert" data-testid="habit-interval-error">
                    {intervalError}
                  </p>
                )}
              </div>
            )}

            {frequency !== 'interval' && (
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
                      onClick={() => {
                        // Turning a day off from "Every day" is choosing specific days.
                        setFrequency('days')
                        toggleScheduleDay(day)
                      }}
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
            )}

            {frequency !== 'interval' && (
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
            )}
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
