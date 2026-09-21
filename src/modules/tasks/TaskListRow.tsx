import { useState } from 'react'
import { Check, Repeat, CalendarClock, X, Pencil } from 'lucide-react'
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
  /**
   * FEAT-052 (docs/backlog/EP-07-tasks-depth/FEAT-052-edit-task-from-row.md):
   * called after a successful content edit. Optional, same notify-only role
   * as `onAssigneeChange` — most pages don't derive anything from a task's
   * content, so most consumers pass nothing and the row's own local draft
   * (below) is enough. TasksAllPage.tsx doesn't need it either: it doesn't
   * group by content.
   */
  onContentChange?: (taskId: string, content: string) => void
  /**
   * BUG-006 (docs/backlog/EP-07-tasks-depth/BUG-006-no-due-date-change-in-list-view.md):
   * called after a successful due-date change. TasksAllPage.tsx passes this
   * — it buckets `openTasks` into Overdue/This week/date groups, so a stale
   * bucket after a change would show the row in the wrong section until the
   * next reload, the same staleness `onAssigneeChange` exists to prevent for
   * TasksAssignedPage.tsx's assignee-derived sections.
   */
  onDueDateChange?: (taskId: string, dueDate: string | null) => void
  /**
   * FEAT-051 (docs/backlog/EP-07-tasks-depth/FEAT-051-task-list-picker.md):
   * every list the caller can file a task into, for the "Move to…" picker.
   * Resolved ONCE by the parent page, same "not a per-row fetch" story as
   * `coMembers`. Optional and hide-when-absent, same convention.
   */
  availableLists?: TaskList[]
  /**
   * FEAT-051: called after a successful list change. Every current consumer
   * derives `list` (above) from its own local `tasks` array via a
   * `listId → TaskList` lookup, so without this the dot/name shown here
   * would stay on the old list until the next reload — the same staleness
   * `onAssigneeChange`/`onDueDateChange` exist to prevent.
   */
  onListChange?: (taskId: string, listId: string | null) => void
  /**
   * BUG-011 (docs/backlog/EP-07-tasks-depth/BUG-011-no-way-to-set-priority.md):
   * opens `TaskDetailModal.tsx` for this task. This row's own inline editors
   * (content, list, due date, assignee) don't cover priority or note, so the
   * modal is the row's only route to editing those — same optional,
   * hide-when-absent convention as `coMembers`/`onAssigneeChange`/etc above.
   * TasksListDetailPage.tsx and TasksAssignedPage.tsx don't pass this yet, so
   * they're unaffected.
   */
  onOpenDetail?: (task: Task) => void
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

// FEAT-028 (docs/backlog/EP-07-tasks-depth/FEAT-028-task-recurrence.md):
// short read-only label for the recurrence chip. Editing recurrence is
// outliner-only (BulletNode.tsx's "Repeats…" dialog) — see FEAT-052 for the
// tracked gap of editing it from a row like this one.
function recurrenceLabel(task: Task): string | null {
  if (!task.recurrence) return null
  const interval = task.recurrenceData?.interval ?? 1
  if (task.recurrence === 'custom') return 'Repeats weekly'
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[task.recurrence]
  return interval > 1 ? `Repeats every ${interval} ${unit}s` : `Repeats ${task.recurrence}`
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
export function TaskListRow({
  task,
  list,
  onToggleComplete,
  coMembers,
  onAssigneeChange,
  onContentChange,
  onDueDateChange,
  availableLists,
  onListChange,
  onOpenDetail,
}: TaskListRowProps) {
  const state = dueState(task)
  const { assignTask, updateTaskContent, updateTaskDueDate, updateTaskList } = useTasks()

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

  // FEAT-052: click-to-edit content. Same render-time re-sync pattern as
  // assigneeDraft above — this row's own local `tasks` array isn't the
  // Zustand store either, so an edit made elsewhere (or a reload) needs to
  // win over a stale draft.
  const [isEditingContent, setIsEditingContent] = useState(false)
  const [contentDraft, setContentDraft] = useState(task.content)
  const [syncedContent, setSyncedContent] = useState(task.content)
  if (task.content !== syncedContent) {
    setSyncedContent(task.content)
    if (!isEditingContent) setContentDraft(task.content)
  }

  const saveContent = () => {
    setIsEditingContent(false)
    const trimmed = contentDraft.trim()
    if (trimmed === task.content) return
    updateTaskContent(task.id, trimmed)
      .then((updated) => onContentChange?.(task.id, updated.content))
      .catch(() => {
        // updateTaskContent already surfaced the error (reportAndReconcile);
        // revert the draft so the row doesn't keep showing an unsaved edit.
        setContentDraft(task.content)
      })
  }

  // BUG-006: an inline due-date control, toggled by the calendar icon below.
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [dueDateDraft, setDueDateDraft] = useState(task.dueDate ?? '')
  const [syncedDueDate, setSyncedDueDate] = useState(task.dueDate)
  if (task.dueDate !== syncedDueDate) {
    setSyncedDueDate(task.dueDate)
    setDueDateDraft(task.dueDate ?? '')
  }

  const saveDueDate = (value: string | null) => {
    const previous = dueDateDraft
    setDueDateDraft(value ?? '')
    setShowDatePicker(false)
    updateTaskDueDate(task.id, value)
      .then((updated) => onDueDateChange?.(task.id, updated.dueDate))
      .catch(() => {
        setDueDateDraft(previous)
      })
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
      {!availableLists && list && (
        <span
          className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
          style={{ background: list.color }}
          aria-hidden="true"
          title={list.name}
          data-testid="all-tasks-row-list-chip"
        />
      )}

      {/* FEAT-051 — only rendered where a parent page resolved the list of
          options (see the prop's own doc comment); every other page passes
          nothing and gets the plain read-only dot above, unchanged. */}
      {availableLists && (
        <span
          className="inline-flex shrink-0 items-center gap-1"
          data-testid="all-tasks-row-list-chip"
          title={list?.name ?? 'Unsorted'}
        >
          <span
            className="h-2 w-2 flex-shrink-0 rounded-full"
            style={{ background: list?.color ?? '#6b7280' }}
            aria-hidden="true"
          />
          <select
            aria-label={`Move ${task.content || 'task'} to a list`}
            data-testid={`task-row-list-${task.id}`}
            value={task.listId ?? ''}
            onChange={(e) => {
              const value = e.target.value || null
              updateTaskList(task.id, value)
                .then(() => onListChange?.(task.id, value))
                .catch(() => {
                  // updateTaskList already surfaced the error (reportAndReconcile).
                })
            }}
            className={cn(
              'shrink-0 truncate rounded-md border border-line-strong bg-surface px-1.5 py-1 text-xs text-fg-subtle',
              // BUG-010 (docs/backlog/EP-07-tasks-depth/BUG-010-all-tasks-row-layout-squeezes-name.md):
              // capped so a long list name can't claim space budgeted for the
              // `.task` grid's 1fr name column — it truncates inside its own
              // control instead.
              'max-w-[92px]',
              'focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20',
            )}
          >
            <option value="">Unsorted</option>
            {availableLists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </span>
      )}

      <div className="min-w-0 flex-1">
        {isEditingContent ? (
          <input
            type="text"
            autoFocus
            value={contentDraft}
            onChange={(e) => setContentDraft(e.target.value)}
            onBlur={saveContent}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                setContentDraft(task.content)
                setIsEditingContent(false)
              }
            }}
            aria-label={`Edit ${task.content || 'task'}`}
            data-testid="all-tasks-row-content-input"
            className="w-full rounded border border-brand-500 bg-surface px-1 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        ) : (
          <p
            className="task-title cursor-text"
            onClick={() => setIsEditingContent(true)}
            data-testid="all-tasks-row-title"
          >
            {task.content || 'Untitled task'}
          </p>
        )}
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
            'shrink-0 truncate rounded-md border border-line-strong bg-surface px-1.5 py-1 text-xs text-fg-subtle',
            // BUG-010: same cap as the list picker above — a long co-member
            // username can't squeeze the name column.
            'max-w-[92px]',
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

      {task.recurrence && (
        <span
          className="chip chip-mute inline-flex items-center gap-1"
          data-testid="all-tasks-row-recurrence"
          title={recurrenceLabel(task) ?? undefined}
        >
          <Repeat className="h-3 w-3" aria-hidden="true" />
        </span>
      )}

      {/* BUG-006: due date is now editable from this row, not just displayed.
          The badge itself (when present) opens the picker; otherwise a bare
          calendar icon does, matching BulletNode.tsx's due-date affordance. */}
      {showDatePicker ? (
        <span className="inline-flex shrink-0 items-center gap-1">
          <input
            type="date"
            autoFocus
            aria-label={`Due date for ${task.content || 'task'}`}
            data-testid={`all-tasks-row-due-input-${task.id}`}
            value={dueDateDraft}
            onChange={(e) => setDueDateDraft(e.target.value)}
            onBlur={() => saveDueDate(dueDateDraft || null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveDueDate(dueDateDraft || null)
              if (e.key === 'Escape') {
                setDueDateDraft(task.dueDate ?? '')
                setShowDatePicker(false)
              }
            }}
            className="rounded border border-brand-500 bg-surface px-1 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
          {dueDateDraft && (
            <button
              type="button"
              aria-label="Clear due date"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => saveDueDate(null)}
              className="text-fg-faint hover:text-fg-muted"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ) : task.dueDate ? (
        <button
          type="button"
          onClick={() => setShowDatePicker(true)}
          data-testid={`all-tasks-row-due-${task.id}`}
          className={cn('task-when', state === 'late' && 'late', state === 'soon' && 'soon')}
        >
          {task.isCompleted && task.completedAt
            ? `Done ${formatDue(task.completedAt)}`
            : state === 'late'
              ? `Overdue · ${formatDue(task.dueDate)}`
              : state === 'soon'
                ? 'Today'
                : formatDue(task.dueDate)}
        </button>
      ) : (
        !task.isCompleted && (
          <button
            type="button"
            onClick={() => setShowDatePicker(true)}
            aria-label={`Set due date for ${task.content || 'task'}`}
            data-testid={`all-tasks-row-set-due-${task.id}`}
            className="shrink-0 rounded p-1 text-fg-faint hover:bg-surface-hover hover:text-fg-muted"
          >
            <CalendarClock className="h-3.5 w-3.5" />
          </button>
        )
      )}

      {/* BUG-011: this row's inline editors don't cover priority or note —
          the modal does. Hide-when-absent, same as every other optional
          affordance in this row. */}
      {onOpenDetail && (
        <button
          type="button"
          onClick={() => onOpenDetail(task)}
          aria-label={`Edit details for ${task.content || 'task'}`}
          data-testid={`task-row-detail-${task.id}`}
          className="shrink-0 rounded p-1 text-fg-faint hover:bg-surface-hover hover:text-fg-muted"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
