import { cn } from '@/lib/utils'

export interface ComposerReminderFieldsProps {
  date: string
  time: string
  onDateChange: (value: string) => void
  onTimeChange: (value: string) => void
  disabled?: boolean
}

const fieldClass = cn(
  'rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm',
  'focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20',
  'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-fg-faint',
)

/**
 * The extra row the composer shows in Reminder mode (FEAT-055): the day
 * (defaulting to today) and the time, which is required — a reminder without
 * a time has nothing to fire on, so the parent keeps Send disabled and this
 * row says why until one is picked.
 */
export function ComposerReminderFields({ date, time, onDateChange, onTimeChange, disabled }: ComposerReminderFieldsProps) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="composer-reminder-fields">
      <input
        type="date"
        aria-label="Reminder day"
        data-testid="composer-reminder-date"
        value={date}
        onChange={(e) => onDateChange(e.target.value)}
        disabled={disabled}
        className={fieldClass}
      />
      <input
        type="time"
        aria-label="Reminder clock time"
        data-testid="composer-reminder-time"
        value={time}
        onChange={(e) => onTimeChange(e.target.value)}
        disabled={disabled}
        className={fieldClass}
      />
      {(!date || !time) && (
        <span className="text-xs text-fg-subtle" data-testid="composer-reminder-hint">
          Pick a {date ? 'time' : 'day and time'} to set the reminder.
        </span>
      )}
    </div>
  )
}
