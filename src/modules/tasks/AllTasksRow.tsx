import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, Repeat, MoreHorizontal, Pencil, CalendarClock, FolderInput, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTasks } from '@/hooks/useTasks'
import { useAppStore } from '@/stores/app.store'
import { Button } from '@/components/ui/Button'
import { avatarClass } from '@/lib/avatar'
import { MENU_CONTENT, MENU_ITEM, addedLabel, dateColumns, recurrenceLabel } from '@/modules/tasks/taskRowFormat'
import type { TaskList } from '@/hooks/useTaskLists'
import type { Task } from '@/types/tasks.types'

interface AllTasksRowProps {
  task: Task
  list: TaskList | undefined
  /** Every list the task can move to, for the kebab's "Move to list" submenu. */
  availableLists: TaskList[]
  /** Co-members, for resolving the assignee avatar. Excludes the viewer (GET /groups/members). */
  coMembers: { userId: string; username: string }[]
  /** Resolved by the parent's `useWalletRefChips()` — once per page, not per row. */
  walletChip?: string | null
  onToggleComplete: (id: string) => void
  onOpenDetail: (task: Task) => void
  /** Notify-only callbacks: the row persists each edit itself, the page keeps its local arrays in step. */
  onContentChange: (taskId: string, content: string) => void
  onDueDateChange: (taskId: string, dueDate: string | null) => void
  onListChange: (taskId: string, listId: string | null) => void
}

/**
 * One row of the All tasks page, in the mockup's `.task` layout: title with a
 * `.task-sub` chip line (list, subtasks, recurrence, Wallet link, age when
 * undated), two date columns, the assignee avatar and a kebab. List moves,
 * rescheduling and the detail modal live in the kebab, where the mockup puts
 * row actions, rather than as inline controls crowding the name.
 */
export function AllTasksRow({
  task,
  list,
  availableLists,
  coMembers,
  walletChip,
  onToggleComplete,
  onOpenDetail,
  onContentChange,
  onDueDateChange,
  onListChange,
}: AllTasksRowProps) {
  const { updateTaskContent, updateTaskDueDate, updateTaskList } = useTasks()
  const self = useAppStore((s) => s.user)

  // Click-to-edit content — same render-time re-sync as TaskListRow.tsx, since
  // the page keeps its own local task arrays rather than the Zustand store.
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
      .then((updated) => onContentChange(task.id, updated.content))
      .catch(() => {
        // updateTaskContent already surfaced the error; drop the unsaved draft.
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
    const previous = dueDateDraft
    setDueDateDraft(value ?? '')
    setShowDatePicker(false)
    updateTaskDueDate(task.id, value)
      .then((updated) => onDueDateChange(task.id, updated.dueDate))
      .catch(() => setDueDateDraft(previous))
  }

  const moveToList = (listId: string | null) => {
    if (listId === task.listId) return
    updateTaskList(task.id, listId)
      .then(() => onListChange(task.id, listId))
      .catch(() => {
        // updateTaskList already surfaced the error (reportAndReconcile).
      })
  }

  // `coMembers` excludes the viewer, so a self-assigned task resolves here.
  const assignee =
    coMembers.find((m) => m.userId === task.assigneeId) ??
    (self && task.assigneeId === self.id ? { userId: self.id, username: self.username } : undefined)
  const cols = dateColumns(task)
  const recurrence = recurrenceLabel(task)
  const label = task.content || 'task'

  return (
    <div className={cn('task task--cols', task.isCompleted && 'done')} data-testid="all-tasks-row" data-task-id={task.id}>
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
              data-testid="all-tasks-row-content-input"
              className="w-full rounded border border-brand-500 bg-surface px-1 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          ) : (
            <p
              className="task-title cursor-text"
              onClick={() => setIsEditingContent(true)}
              title={task.content}
              data-testid="all-tasks-row-title"
            >
              {task.content || 'Untitled task'}
            </p>
          )}
          <div className="task-sub">
            {/* Per-list colour is user data (D-10) — the documented inline-style exception. */}
            <span className="lchip" data-testid="all-tasks-row-list-chip" title={list?.name ?? 'Unsorted'}>
              <i style={{ background: list?.color ?? 'rgb(var(--line-strong))' }} aria-hidden="true" />
              {list?.name ?? 'Unsorted'}
            </span>
            {task.subtaskTotal > 0 && (
              <span className="sub-count" data-testid="all-tasks-row-subtasks">
                {task.subtaskDone} of {task.subtaskTotal}
              </span>
            )}
            {recurrence && (
              <span className="chip chip-mute inline-flex items-center gap-1" data-testid="all-tasks-row-recurrence">
                <Repeat className="h-3 w-3" aria-hidden="true" />
                {recurrence}
              </span>
            )}
            {walletChip && (
              <span className="chip chip-mute" data-testid="all-tasks-row-wallet-chip">
                {walletChip}
              </span>
            )}
            {!task.dueDate && !task.isCompleted && (
              <span className="chip chip-mute" data-testid="all-tasks-row-age">
                {addedLabel(task.createdAt)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Each cell below is its own track of `.task--cols` (tasks.css): exact
          date, relative date, avatar, actions — fixed widths, so they line up
          on every row however long the title runs. */}
      {showDatePicker ? (
        <span className="task-when-edit">
          <input
            type="date"
            autoFocus
            aria-label={`Due date for ${label}`}
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
      ) : (
        <>
          <span className={cn('task-when col-exact', cols.state === 'late' && 'late', cols.state === 'soon' && 'soon')}>
            {cols.exact}
          </span>
          {/* The relative column doubles as the date editor, so the due date
              stays one click away without an extra control. */}
          <button
            type="button"
            onClick={() => !task.isCompleted && setShowDatePicker(true)}
            disabled={task.isCompleted}
            aria-label={task.dueDate ? `Change due date for ${label}` : `Set due date for ${label}`}
            data-testid={`all-tasks-row-due-${task.id}`}
            className="task-when rounded hover:text-fg disabled:hover:text-fg-muted"
          >
            {cols.relative}
          </button>
          <span className="col-avatar flex justify-center">
            {assignee && (
              <span
                className={cn('avatar', avatarClass(assignee.userId))}
                style={{ width: 24, height: 24, fontSize: 10 }}
                title={assignee.username}
                data-testid="all-tasks-row-assignee"
              >
                {assignee.username.charAt(0).toUpperCase()}
              </span>
            )}
          </span>
        </>
      )}

      <div className="trow-actions items-center text-fg-faint">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="rounded text-fg-faint hover:bg-surface-hover hover:text-fg-muted"
              aria-label={`More actions for ${label}`}
              data-testid={`all-tasks-row-options-${task.id}`}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className={MENU_CONTENT} sideOffset={4} align="end">
              <DropdownMenu.Item
                className={MENU_ITEM}
                onSelect={() => onOpenDetail(task)}
                data-testid={`task-row-detail-${task.id}`}
              >
                <Pencil className="h-3.5 w-3.5 text-fg-faint" />
                Edit details
              </DropdownMenu.Item>
              {!task.isCompleted && (
                <DropdownMenu.Item className={MENU_ITEM} onSelect={() => setShowDatePicker(true)}>
                  <CalendarClock className="h-3.5 w-3.5 text-fg-faint" />
                  Reschedule
                </DropdownMenu.Item>
              )}
              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger className={MENU_ITEM} data-testid={`task-row-move-${task.id}`}>
                  <FolderInput className="h-3.5 w-3.5 text-fg-faint" />
                  Move to list
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent className={MENU_CONTENT} sideOffset={4}>
                    <DropdownMenu.RadioGroup
                      value={task.listId ?? ''}
                      onValueChange={(value) => moveToList(value || null)}
                    >
                      {[{ id: '', name: 'Unsorted', color: 'rgb(var(--line-strong))' }, ...availableLists].map(
                        (l) => (
                          <DropdownMenu.RadioItem
                            key={l.id || 'unsorted'}
                            value={l.id}
                            className={cn(MENU_ITEM, 'data-[state=checked]:font-semibold data-[state=checked]:text-fg')}
                          >
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ background: l.color }}
                              aria-hidden="true"
                            />
                            {l.name}
                          </DropdownMenu.RadioItem>
                        ),
                      )}
                    </DropdownMenu.RadioGroup>
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  )
}
