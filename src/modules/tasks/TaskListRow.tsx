import { useState } from 'react'
import { Check } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { cn, todayISO } from '@/lib/utils'
import { useTasks } from '@/hooks/useTasks'
import type { TaskList } from '@/hooks/useTaskLists'
import type { Task } from '@/types/tasks.types'

export interface TaskListRowProps {
  task: Task
  list: TaskList | undefined
  onToggleComplete: (id: string) => void
  /**
   * FEAT-027 (docs/backlog/EP-07-tasks-depth/FEAT-027-tasks-assigned-to-me.md):
   * household co-members, for the inline "Assign to…" picker. Resolved ONCE by
   * the parent page (a `GET /groups/members` call), never per-row — mirrors how
   * `list` is a per-row lookup into a parent-resolved map rather than its own
   * fetch. Optional and omitted by every page except TasksAssignedPage.tsx for
   * now, so the picker simply doesn't render there (same optional-prop,
   * hide-when-absent pattern this component already uses for `list`).
   */
  coMembers?: { userId: string; username: string }[]
  /**
   * FEAT-027: called after a successful assignee change, so a parent page
   * keeping its own local `tasks` state (every current consumer does — see
   * `coMembers`'s doc comment) can update its own copy. Without this, a page
   * deriving a section from `task.assigneeId` (e.g. TasksAssignedPage.tsx's
   * "handed out" filter) would show a stale, self-contradicting state after a
   * successful change until the next full reload.
   */
  onAssigneeChange?: (taskId: string, assigneeId: string | null) => void
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
 * docs/archive/design-adoption/tasks-design-adoption.md §All tasks). Unlike `TaskRow.tsx`
 * (Today's grouping-aware row, which assumes overdue/today/done-today
 * context and has no list chip/subtask progress), this row is due-date
 * agnostic and always shows the task's list colour chip and subtask
 * progress — a different concern, hence a separate component (CLAUDE.md
 * rule 7) rather than forcing new props onto `TaskRow`.
 */
export function TaskListRow({ task, list, onToggleComplete, coMembers, onAssigneeChange }: TaskListRowProps) {
  const state = dueState(task)
  const { assignTask } = useTasks()

  // Controlled locally rather than reading `task.assigneeId` straight through:
  // every page rendering this row keeps its own local `tasks` state (not the
  // Zustand store — see TasksAssignedPage.tsx), so a successful PATCH here
  // wouldn't otherwise cause a re-render that shows the new value. Re-synced
  // from the prop during render (React's documented pattern for "adjusting
  // state when a prop changes" without an effect's extra render) rather than
  // in a `useEffect`, so an assignment made elsewhere or a reload still wins.
  const [assigneeDraft, setAssigneeDraft] = useState(task.assigneeId ?? '')
  const [syncedAssigneeId, setSyncedAssigneeId] = useState(task.assigneeId)
  if (task.assigneeId !== syncedAssigneeId) {
    setSyncedAssigneeId(task.assigneeId)
    setAssigneeDraft(task.assigneeId ?? '')
  }

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

      {/* FEAT-027 — only rendered where a parent page resolved co-members
          (currently just TasksAssignedPage.tsx); every other page passes no
          `coMembers` and gets the row's existing layout, unchanged. */}
      {coMembers && (
        <select
          aria-label={`Assign ${task.content || 'task'} to`}
          data-testid={`task-row-assignee-${task.id}`}
          value={assigneeDraft}
          onChange={(e) => {
            const value = e.target.value
            const previous = assigneeDraft
            setAssigneeDraft(value)
            assignTask(task.id, value || null)
              .then(() => onAssigneeChange?.(task.id, value || null))
              .catch(() => {
                // assignTask already surfaced the error (reportAndReconcile);
                // revert the optimistic draft so the control doesn't keep
                // showing a change that never persisted.
                setAssigneeDraft(previous)
              })
          }}
          className={cn(
            'shrink-0 rounded-md border border-line-strong bg-surface px-1.5 py-1 text-xs text-fg-subtle',
            'focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20',
          )}
        >
          <option value="">Unassigned</option>
          {coMembers.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.username}
            </option>
          ))}
        </select>
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
