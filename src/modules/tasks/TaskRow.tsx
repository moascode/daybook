import { Check } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { cn, todayISO } from '@/lib/utils'
import type { Task } from '@/types/tasks.types'

export interface TaskRowProps {
  task: Task
  onToggleComplete: (id: string) => void
}

/** 'late' (red) / 'soon' (amber) / 'ok' / 'none' — drives `.task-when`'s colour. */
function dueState(task: Task): 'late' | 'soon' | 'ok' | 'none' {
  if (!task.dueDate) return 'none'
  if (task.isCompleted) return 'ok'
  const today = todayISO()
  if (task.dueDate < today) return 'late'
  if (task.dueDate === today) return 'soon'
  return 'ok'
}

// Accepts either a plain YYYY-MM-DD (due_date) or a "YYYY-MM-DD HH:MM:SS"
// SQLite datetime (completed_at) — only the date portion is ever displayed,
// and parseISO chokes on the space-separated SQLite form.
function formatDue(dateStr: string): string {
  return format(parseISO(dateStr.slice(0, 10)), 'dd MMM')
}

/**
 * One task row for the Today page — reuses the `.task`/`.tcheck`/`.task-when`
 * idiom already defined in src/styles/tasks.css (dormant since R1, first
 * applied here): checkbox border colour = priority, due column red when
 * overdue / amber when due today.
 */
export function TaskRow({ task, onToggleComplete }: TaskRowProps) {
  const state = dueState(task)

  return (
    <div className={cn('task', task.isCompleted && 'done')} data-testid="today-task-row" data-task-id={task.id}>
      <button
        type="button"
        className={cn(
          'tcheck',
          task.isCompleted && 'on',
          !task.isCompleted && task.priority === 'high' && 'pri-high',
          !task.isCompleted && task.priority === 'med' && 'pri-med',
        )}
        aria-label={task.isCompleted ? 'Mark incomplete' : 'Mark complete'}
        onClick={() => onToggleComplete(task.id)}
      >
        <Check />
      </button>

      <div className="min-w-0">
        <p className="task-title">{task.content || 'Untitled task'}</p>
        {task.note && <p className="task-sub truncate">{task.note}</p>}
      </div>

      {task.dueDate && (
        <span className={cn('task-when', state === 'late' && 'late', state === 'soon' && 'soon')}>
          {task.isCompleted && task.completedAt
            ? `Done ${formatDue(task.completedAt)}`
            : state === 'late'
              ? `Overdue · ${formatDue(task.dueDate)}`
              : state === 'soon'
                ? 'Today'
                : formatDue(task.dueDate)}
        </span>
      )}
    </div>
  )
}
