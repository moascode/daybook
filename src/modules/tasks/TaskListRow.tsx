import { Check } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { cn, todayISO } from '@/lib/utils'
import type { TaskList } from '@/hooks/useTaskLists'
import type { Task } from '@/types/tasks.types'

export interface TaskListRowProps {
  task: Task
  list: TaskList | undefined
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
 * One task row for the All tasks page (R5 PR-2,
 * docs/v2/tasks/02-design-adoption.md §All tasks). Unlike `TaskRow.tsx`
 * (Today's grouping-aware row, which assumes overdue/today/done-today
 * context and has no list chip/subtask progress), this row is due-date
 * agnostic and always shows the task's list colour chip and subtask
 * progress — a different concern, hence a separate component (CLAUDE.md
 * rule 7) rather than forcing new props onto `TaskRow`.
 */
export function TaskListRow({ task, list, onToggleComplete }: TaskListRowProps) {
  const state = dueState(task)

  return (
    <div className={cn('task', task.isCompleted && 'done')} data-testid="all-tasks-row" data-task-id={task.id}>
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

      {/* Per-list colour is user data (D-10), not a semantic token — an
          inline style is the correct, documented exception (same as
          ModuleSidebar's list dots). */}
      {list && (
        <span
          className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
          style={{ background: list.color }}
          aria-hidden="true"
          title={list.name}
          data-testid="all-tasks-row-list-chip"
        />
      )}

      <div className="min-w-0 flex-1">
        <p className="task-title">{task.content || 'Untitled task'}</p>
        {task.note && <p className="task-sub truncate">{task.note}</p>}
      </div>

      {task.subtaskTotal > 0 && (
        <span className="chip chip-mute" data-testid="all-tasks-row-subtasks">
          {task.subtaskDone}/{task.subtaskTotal}
        </span>
      )}

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
