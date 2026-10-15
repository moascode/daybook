import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, Repeat, MoreHorizontal, Pencil, CalendarClock, FolderInput, UserRound, Trash2, X } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ReminderChip } from '@/modules/tasks/ReminderChip'
import { cn, todayISO } from '@/lib/utils'
import { useTasks } from '@/hooks/useTasks'
import { useAssignees } from '@/hooks/useAssignees'
import { useAppStore } from '@/stores/app.store'
import { Button } from '@/components/ui/Button'
import { avatarClass } from '@/lib/avatar'
import { MENU_CONTENT, MENU_ITEM, addedLabel, dateColumns, dayDiff, recurrenceLabel } from '@/modules/tasks/taskRowFormat'
import { TaskTimeChips } from '@/modules/tasks/TaskTimeChips'
import type { TaskList } from '@/hooks/useTaskLists'
import type { Task } from '@/types/tasks.types'

/**
 * Completed rows show WHEN they were finished, not a due date — the exact
 * column is the completion time ("09:48"), the relative column is a day
 * label ("Today" / "Yesterday" / "Sat 16"), always, regardless of what the
 * task was ever due. `taskRowFormat.ts`'s own `dateColumns` deliberately
 * doesn't cover this (its completed branch exists only for AllTasksRow's
 * mixed open+done list, where "Done 14 Oct" reads fine folded into one
 * column) — this row renders completed tasks on their own two columns
 * instead, so it gets its own formatter.
 */
function completedDateColumns(task: Task): { exact: string; relative: string; state: 'ok' } {
  if (!task.completedAt) return { exact: '', relative: '', state: 'ok' }
  const day = task.completedAt.slice(0, 10)
  const parsed = parseISO(task.completedAt.replace(' ', 'T'))
  const exact = format(parsed, 'HH:mm')
  const diff = dayDiff(day, todayISO())
  const relative = diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : format(parsed, 'EEE d')
  return { exact, relative, state: 'ok' }
}

export interface TaskListRowProps {
  task: Task
  list: TaskList | undefined
  onToggleComplete: (id: string) => void
  /**
   * Household co-members, for the kebab's "Assign to…" submenu
   * (`useAssignees` resolves "Me" + these). Optional and hide-when-absent —
   * a page that hasn't resolved its household yet (or never needs to) omits
   * this and the submenu simply isn't offered.
   */
  coMembers?: { userId: string; username: string }[]
  /** Called after a successful assignee change, so a page keeping its own
   *  local `tasks` state (every current consumer does, not the outliner's
   *  Zustand store) can keep a derived section (e.g. "handed out") honest. */
  onAssigneeChange?: (taskId: string, assigneeId: string | null) => void
  /** Called after a successful content edit — most pages don't derive
   *  anything from a task's content, so this is optional. */
  onContentChange?: (taskId: string, content: string) => void
  /** Called after a successful due-date change, so a page bucketing rows by
   *  due date can move this one to its new bucket. */
  onDueDateChange?: (taskId: string, dueDate: string | null) => void
  /** Every list the caller can file a task into, for the kebab's "Move to
   *  list" submenu. Optional and hide-when-absent. */
  availableLists?: TaskList[]
  /** Called after a successful list change. */
  onListChange?: (taskId: string, listId: string | null) => void
  /** Opens `TaskDetailModal.tsx` for this task — this row's own editors
   *  don't cover priority or note. Optional and hide-when-absent. */
  onOpenDetail?: (task: Task) => void
  /** The resolved chip text for a task's `walletRef` (the parent page's own
   *  `useWalletRefChips().resolveChip()` call). Optional and hide-when-absent. */
  walletChip?: string | null
  /**
   * One extra free-text chip in `.task-sub`, for a page-specific fact the
   * row's own fixed chip set doesn't cover. TasksAssignedPage.tsx's
   * "Waiting on you" section uses this for "Asked N days ago" — the mockup
   * repurposes this row's date columns for that section (asker-relative
   * time instead of the due date), but every other page needs those
   * columns to stay due-date columns, so this stays a chip instead of a
   * third column meaning.
   */
  extraChip?: string | null
  /**
   * Overrides whose avatar the row shows — default is the task's assignee.
   * TasksAssignedPage.tsx's "Waiting on you" section passes the task's
   * OWNER here instead: every row there is already assigned to the viewer
   * (that's what "waiting on you" means), so showing the assignee would
   * just be the viewer's own avatar on every row — the asker is the
   * information actually worth an avatar there. `null` renders no avatar at
   * all (an explicit "nobody", distinct from "not overridden").
   */
  avatarUserId?: string | null
  /**
   * Called when the user picks Delete in the kebab. The row makes NO API
   * call and keeps no undo state — the parent performs the real delete
   * (`useTasks().deleteTaskById`, the store-independent variant — every page
   * rendering this row keeps its own local arrays, not the outliner's
   * Zustand store, so the store-backed `deleteTask` silently no-ops for
   * tasks assigned in by a co-member or living in a shared list) and owns
   * the undo-snapshot/toast itself. Optional — hides the Delete item.
   */
  onDelete?: (taskId: string) => void
}

/**
 * One task row for Assigned to me, Completed and a list's detail page — the
 * mockup's fixed `.task task--cols` grid (`AllTasksRow.tsx`'s layout,
 * `tasks.css`), not the old flexible `.task-name`/`.task-meta` grid. Every
 * optional editor (list, assignee, reschedule) now lives in the kebab menu
 * instead of a per-row inline `<select>` — the mockup puts row actions in
 * one "more" menu, and a fixed grid has no spare track for N independent
 * dropdowns anyway.
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
  walletChip,
  extraChip,
  avatarUserId,
  onDelete,
}: TaskListRowProps) {
  const { assignTask, updateTaskContent, updateTaskDueDate, updateTaskList } = useTasks()
  const self = useAppStore((s) => s.user)
  const assignees = useAssignees(coMembers ?? [])

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
      .then((updated) => onDueDateChange?.(task.id, updated.dueDate))
      .catch(() => setDueDateDraft(previous))
  }

  const moveToList = (listId: string | null) => {
    if (listId === task.listId) return
    updateTaskList(task.id, listId)
      .then(() => onListChange?.(task.id, listId))
      .catch(() => {
        // updateTaskList already surfaced the error (reportAndReconcile).
      })
  }

  const changeAssignee = (assigneeId: string | null) => {
    if (assigneeId === task.assigneeId) return
    assignTask(task.id, assigneeId)
      .then(() => onAssigneeChange?.(task.id, assigneeId))
      .catch(() => {
        // assignTask already surfaced the error (reportAndReconcile).
      })
  }

  const label = task.content || 'task'
  const cols = task.isCompleted ? completedDateColumns(task) : dateColumns(task)
  const recurrence = recurrenceLabel(task)

  // Default: the task's own assignee. `avatarUserId === undefined` means
  // "not overridden" — `null` is a real, explicit "show nobody" (see the
  // prop's own doc comment).
  const effectiveAvatarUserId = avatarUserId !== undefined ? avatarUserId : task.assigneeId
  const avatarPerson =
    effectiveAvatarUserId === null
      ? undefined
      : (coMembers ?? []).find((m) => m.userId === effectiveAvatarUserId) ??
        (self && effectiveAvatarUserId === self.id ? { userId: self.id, username: self.username } : undefined)

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
            <TaskTimeChips task={task} />

            {task.subtaskTotal > 0 && (
              <span className="sub-count" data-testid="all-tasks-row-subtasks">
                {task.subtaskDone} of {task.subtaskTotal}
              </span>
            )}
            <ReminderChip task={task} testId="all-tasks-row-reminder" />
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
            {extraChip && (
              <span className="chip chip-mute" data-testid="all-tasks-row-extra-chip">
                {extraChip}
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
          {/* Completed rows show WHEN they were finished — not editable
              (there's no due date to reschedule once a task is done; the
              checkbox above is how it comes back to being open). Open rows'
              relative column doubles as the due-date editor, same as
              AllTasksRow.tsx. */}
          {task.isCompleted ? (
            <span className="task-when">{cols.relative}</span>
          ) : (
            <button
              type="button"
              onClick={() => setShowDatePicker(true)}
              aria-label={task.dueDate ? `Change due date for ${label}` : `Set due date for ${label}`}
              data-testid={`all-tasks-row-due-${task.id}`}
              className="task-when rounded hover:text-fg"
            >
              {cols.relative}
            </button>
          )}
          <span className="col-avatar flex justify-center">
            {avatarPerson && (
              <span
                className={cn('avatar', avatarClass(avatarPerson.userId))}
                style={{ width: 24, height: 24, fontSize: 10 }}
                title={avatarPerson.username}
                data-testid="all-tasks-row-assignee"
              >
                {avatarPerson.username.charAt(0).toUpperCase()}
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
              data-testid={`task-row-more-${task.id}`}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className={MENU_CONTENT}
              sideOffset={4}
              align="end"
              data-testid={`task-row-more-menu-${task.id}`}
            >
              {onOpenDetail && (
                <DropdownMenu.Item
                  className={MENU_ITEM}
                  onSelect={() => onOpenDetail(task)}
                  data-testid={`task-row-detail-${task.id}`}
                >
                  <Pencil className="h-3.5 w-3.5 text-fg-faint" />
                  Edit details
                </DropdownMenu.Item>
              )}
              {!task.isCompleted && (
                <DropdownMenu.Item className={MENU_ITEM} onSelect={() => setShowDatePicker(true)}>
                  <CalendarClock className="h-3.5 w-3.5 text-fg-faint" />
                  Reschedule
                </DropdownMenu.Item>
              )}
              {availableLists && (
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
              )}
              {coMembers && (
                <DropdownMenu.Sub>
                  <DropdownMenu.SubTrigger className={MENU_ITEM} data-testid={`task-row-assign-${task.id}`}>
                    <UserRound className="h-3.5 w-3.5 text-fg-faint" />
                    Assign to
                  </DropdownMenu.SubTrigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.SubContent className={MENU_CONTENT} sideOffset={4}>
                      <DropdownMenu.RadioGroup
                        value={task.assigneeId ?? ''}
                        onValueChange={(value) => changeAssignee(value || null)}
                      >
                        <DropdownMenu.RadioItem
                          value=""
                          className={cn(MENU_ITEM, 'data-[state=checked]:font-semibold data-[state=checked]:text-fg')}
                          data-testid={`task-row-assign-unassigned-${task.id}`}
                        >
                          Unassigned
                        </DropdownMenu.RadioItem>
                        {assignees.map((m) => (
                          <DropdownMenu.RadioItem
                            key={m.userId}
                            value={m.userId}
                            className={cn(MENU_ITEM, 'data-[state=checked]:font-semibold data-[state=checked]:text-fg')}
                            data-testid={`task-row-assign-option-${task.id}-${m.userId}`}
                          >
                            {m.username}
                          </DropdownMenu.RadioItem>
                        ))}
                      </DropdownMenu.RadioGroup>
                    </DropdownMenu.SubContent>
                  </DropdownMenu.Portal>
                </DropdownMenu.Sub>
              )}
              {onDelete && (
                <DropdownMenu.Item
                  className={cn(MENU_ITEM, 'text-neg-fg')}
                  onSelect={() => onDelete(task.id)}
                  data-testid={`task-row-delete-${task.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  )
}
