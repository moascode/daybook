import { Clock } from 'lucide-react'
import { reminderLabel } from '@/modules/tasks/taskRowFormat'
import type { Task } from '@/types/tasks.types'

/**
 * The reminder chip on a task row (FEAT-055) — the mockup's clock + time.
 * Renders nothing for a done task (a reminder that can no longer fire is not
 * worth a chip) or one without a valid reminder.
 */
export function ReminderChip({ task, testId }: { task: Task; testId: string }) {
  if (task.isCompleted) return null
  const label = reminderLabel(task.remindAt)
  if (!label) return null
  return (
    <span className="chip chip-warn inline-flex items-center gap-1" data-testid={testId} title={`Reminder ${label}`}>
      <Clock className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  )
}
