import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, Repeat, MoreHorizontal, Pencil, CalendarClock, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTasks } from '@/hooks/useTasks'
import { avatarClass } from '@/lib/avatar'
import { useWalletRefChips } from '@/hooks/useWalletRefChips'
import { useAppStore } from '@/stores/app.store'
import { Button } from '@/components/ui/Button'
import { todayDueColumns, recurrenceLabel, MENU_ITEM, MENU_CONTENT } from '@/modules/tasks/taskRowFormat'
import { TaskTimeChips } from '@/modules/tasks/TaskTimeChips'
import type { TaskList } from '@/hooks/useTaskLists'
import type { Task } from '@/types/tasks.types'

export interface TaskRowProps {
  task: Task
  /** The task's list, resolved by the parent page from `task.listId` — same per-row lookup TaskListRow.tsx already uses (not a per-row fetch). Renders the `.lchip` when present. */
  list?: TaskList
  /** Household co-members, for resolving `task.assigneeId` to the avatar's initials/name. Same shape and "resolved once by the parent" story as TaskListRow.tsx's `coMembers`. */
  coMembers?: { userId: string; username: string }[]
  onToggleComplete: (id: string) => void
  onOpenDetail: (task: Task) => void
  /** FEAT-052-style notify-only callback after a successful click-to-edit content save, mirroring TaskListRow.tsx's `onContentChange`. */
  onContentChange?: (taskId: string, content: string) => void
  /** Notify-only callback after a successful reschedule (via the kebab menu's inline date picker), mirroring TaskListRow.tsx's `onDueDateChange`. */
  onDueDateChange?: (taskId: string, dueDate: string | null) => void
  /**
   * Delete request — the PARENT performs the delete (`useTasks().deleteTaskById`,
   * the guard-free variant, since TasksTodayPage.tsx keeps its own local task
   * list rather than the outliner store) and owns the resulting undo-toast
   * (CD-20: every task delete, single or bulk, is undo-toast, never a confirm
   * dialog). The row only asks; it never deletes directly, so TaskRow's kebab
   * and TaskDetailModal's "Delete task" share one delete+undo implementation.
   */
  onDelete?: (task: Task) => void
}

/**
 * One row of the Today page, on the mockup's fixed `.task task--cols` grid
 * (also used by AllTasksRow.tsx — same tracks, same column classes, so a
 * Today row and an All-tasks row line up identically): checkbox, a wrapping
 * title with a `.task-sub` chip line, the two due-date columns, the assignee
 * avatar, and a kebab. Today's due-column semantics are intentionally
 * narrower than AllTasksRow's — see taskRowFormat.ts's `todayDueColumns`.
 */
export function TaskRow({
  task,
  list,
  coMembers,
  onToggleComplete,
  onOpenDetail,
  onContentChange,
  onDueDateChange,
  onDelete,
}: TaskRowProps) {
  const { updateTaskContent, updateTaskDueDate } = useTasks()
  const { resolveChip } = useWalletRefChips()
  const self = useAppStore((s) => s.user)

  // Click-to-edit content — same render-time re-sync pattern as
  // TaskListRow.tsx's `contentDraft` (not a `useEffect`, since a page keeping
  // its own local `tasks` state needs an edit made elsewhere, or a reload, to
  // win over a stale draft).
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
        setContentDraft(task.content)
      })
  }

  const [showDatePicker, setShowDatePicker] = useState(false)
  const [dueDateDraft, setDueDateDraft] = useState(task.dueDate ?? '')
  const [syncedDueDate, setSyncedDueDate] = useState(task.dueDate)
  if (task.dueDate !== syncedDueDate) {
    setSyncedDueDate(task.dueDate)
    setDueDateDraft(task.dueDate ?? '')
  }

  const saveDueDate = (value: string | null) => {
    if ((value ?? '') === (task.dueDate ?? '')) {
      setShowDatePicker(false)
      return
    }
    const previous = dueDateDraft
    setDueDateDraft(value ?? '')
    setShowDatePicker(false)
    updateTaskDueDate(task.id, value)
      .then((updated) => onDueDateChange?.(task.id, updated.dueDate))
      .catch(() => {
        setDueDateDraft(previous)
      })
  }

  // `coMembers` excludes the viewer, so a task assigned to yourself needs the
  // viewer resolved separately or its avatar renders blank.
  const assignee =
    coMembers?.find((m) => m.userId === task.assigneeId) ??
    (self && task.assigneeId === self.id ? { userId: self.id, username: self.username } : undefined)
  const walletChip = resolveChip(task.walletRef)
  const recurrence = recurrenceLabel(task)
  const cols = todayDueColumns(task)
  const label = task.content || 'task'

  return (
    <div className={cn('task task--cols', task.isCompleted && 'done')} data-testid="today-task-row" data-task-id={task.id}>
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

      <div className="task-name">
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
              aria-label={`Edit ${label}`}
              data-testid="today-task-row-content-input"
              className="w-full rounded border border-brand-500 bg-surface px-1 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          ) : (
            <p
              className="task-title cursor-text"
              onClick={() => setIsEditingContent(true)}
              title={task.content}
              data-testid="today-task-row-title"
            >
              {task.content || 'Untitled task'}
            </p>
          )}
          {task.note && <p className="task-sub truncate">{task.note}</p>}

          <div className="task-sub">
            {list ? (
              <span className="lchip" data-testid="today-task-row-list-chip">
                <i style={{ background: list.color }} aria-hidden="true" />
                {list.name}
              </span>
            ) : (
              // A task with listId === null (Unsorted) previously rendered no
              // chip at all — silently indistinguishable from a task whose list
              // just hadn't loaded yet. Always show a chip; use a neutral dot
              // (--line-strong, the same token borders/dividers use) rather than
              // inventing a new "no list" color.
              <span className="lchip" data-testid="today-task-row-list-chip">
                <i style={{ background: 'rgb(var(--line-strong))' }} aria-hidden="true" />
                Unsorted
              </span>
            )}

            <TaskTimeChips task={task} />

            {task.subtaskTotal > 0 && (
              <span className="sub-count" data-testid="today-task-row-subtasks">
                {task.subtaskDone} of {task.subtaskTotal}
              </span>
            )}

            {recurrence && (
              <span className="chip chip-mute inline-flex items-center gap-1" data-testid="today-task-row-recurrence" title={recurrence}>
                <Repeat className="h-3 w-3" aria-hidden="true" />
                {recurrence}
              </span>
            )}

            {walletChip && (
              <span className="chip chip-mute" data-testid="today-task-row-wallet-chip">
                {walletChip}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Each cell below is its own track of `.task--cols` (tasks.css): exact
          date, relative date, avatar, actions — fixed widths, so Today rows
          line up with each other (and with AllTasksRow) whatever a given row
          holds, however long its title wraps. */}
      {showDatePicker ? (
        <span className="task-when-edit">
          <input
            type="date"
            autoFocus
            aria-label={`Due date for ${label}`}
            data-testid={`today-task-row-due-input-${task.id}`}
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
      ) : (
        <>
          <span className={cn('task-when col-exact', cols.state === 'late' && 'late', cols.state === 'soon' && 'soon')}>
            {cols.relative}
          </span>
          <span className="task-when">{cols.exact}</span>
          <span className="col-avatar flex justify-center">
            {assignee && (
              <span
                className={cn('avatar', avatarClass(assignee.userId))}
                style={{ width: 24, height: 24, fontSize: 10 }}
                title={assignee.username}
                data-testid="today-task-row-assignee"
              >
                {assignee.username.charAt(0).toUpperCase()}
              </span>
            )}
          </span>
        </>
      )}

      <div className="trow-actions items-center text-fg-faint" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="rounded text-fg-faint hover:bg-surface-hover hover:text-fg-muted"
              aria-label="Task options"
              data-testid={`today-task-row-options-${task.id}`}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content className={MENU_CONTENT} sideOffset={4} align="end">
              <DropdownMenu.Item className={MENU_ITEM} onSelect={() => onOpenDetail(task)}>
                <Pencil className="h-3.5 w-3.5 text-fg-faint" />
                Edit details
              </DropdownMenu.Item>
              <DropdownMenu.Item className={MENU_ITEM} onSelect={() => setShowDatePicker(true)}>
                <CalendarClock className="h-3.5 w-3.5 text-fg-faint" />
                Reschedule
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={cn(MENU_ITEM, 'text-red-600 hover:bg-red-50 focus:bg-red-50')}
                onSelect={() => onDelete?.(task)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete task
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  )
}
