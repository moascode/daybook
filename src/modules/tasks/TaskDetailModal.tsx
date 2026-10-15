import { useRef, useState } from 'react'
import { Trash2, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { DatePicker } from '@/components/ui/DatePicker'
import { Button } from '@/components/ui/Button'
import { cn, errorMessage } from '@/lib/utils'
import { api } from '@/lib/api'
import { useTasks } from '@/hooks/useTasks'
import { useAssignees } from '@/hooks/useAssignees'
import { TaskTimeRow } from '@/modules/tasks/TaskTimeRow'
import { useToastStore } from '@/stores/toast.store'
import { TaskSubtasks } from '@/modules/tasks/TaskSubtasks'
import { useSubtasks } from '@/modules/tasks/useSubtasks'
import type { TaskList } from '@/hooks/useTaskLists'
import type { Task, TaskPriority, TaskRecurrenceFrequency } from '@/types/tasks.types'

export interface TaskDetailModalProps {
  task: Task | null
  open: boolean
  onOpenChange: (open: boolean) => void
  availableLists: TaskList[]
  coMembers?: { userId: string; username: string }[]
  onSaved?: (updated: Task) => void
  /** Notify-only callback after a successful "Delete task" (CD-20: undo-toast, not a confirm dialog) — lets the parent's own local task arrays drop it. */
  onDeleted?: (taskId: string) => void
}

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'med', label: 'Medium' },
  { value: 'high', label: 'High' },
]

const RECURRENCE_OPTIONS: { value: TaskRecurrenceFrequency | ''; label: string }[] = [
  { value: '', label: 'None' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
]

const fieldInputClass = cn(
  'w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm',
  'focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20',
)

/**
 * Shared full-editing modal for a single task, opened from a row affordance
 * on Today/All-tasks/Upcoming. Every field auto-saves on blur/change — same
 * convention as `TaskListRow.tsx`'s inline editors — rather than a single
 * Save button, and `onSaved` lets a caller with its own local `tasks` array
 * (every current consumer keeps one; none of them are the Zustand store)
 * update its own copy instead of showing stale data until the next reload.
 */
export function TaskDetailModal({
  task,
  open,
  onOpenChange,
  availableLists,
  coMembers,
  onSaved,
  onDeleted,
}: TaskDetailModalProps) {
  const addToast = useToastStore((s) => s.addToast)
  const removeToast = useToastStore((s) => s.removeToast)
  const undoToastIdRef = useRef<string | null>(null)
  // `current` is this modal's own up-to-date copy of the task, re-synced
  // from the `task` prop whenever a DIFFERENT task opens, or the SAME task
  // reopens (open flips false→true) — the latter matters because a row's
  // own inline editors (e.g. TaskListRow's content/list/due-date pickers)
  // can change the task while this modal is closed, and closing/reopening
  // should show that, not whatever was last open in the modal. Every field
  // reads from and saves onto `current`, not `task` directly: the caller's
  // `onSaved` updates its own local list (Today/All/Upcoming each keep one,
  // never the Zustand store), but none of them also refresh the `task` prop
  // this modal was opened with — so five fields auto-saving independently in
  // one sitting would otherwise each read a `task` snapshot from BEFORE any
  // of the others' edits, and the field that resolves last would silently
  // revert every field saved before it back to that stale snapshot.
  const [current, setCurrent] = useState<Task | null>(task)
  const [nameDraft, setNameDraft] = useState(task?.content ?? '')
  const [noteDraft, setNoteDraft] = useState(task?.note ?? '')
  // FEAT-055: the reminder's day and time are edited as two fields but saved
  // as one value, so each keeps its own draft until BOTH are set.
  const [remindDate, setRemindDate] = useState(task?.remindAt?.slice(0, 10) ?? '')
  const [remindTime, setRemindTime] = useState(task?.remindAt?.slice(11, 16) ?? '')
  const [syncedTaskId, setSyncedTaskId] = useState(task?.id ?? null)
  const [syncedOpen, setSyncedOpen] = useState(open)
  const taskChanged = task && task.id !== syncedTaskId
  const reopened = task && open && !syncedOpen
  if (taskChanged || reopened) {
    setSyncedTaskId(task.id)
    setCurrent(task)
    setNameDraft(task.content)
    setNoteDraft(task.note)
    setRemindDate(task.remindAt?.slice(0, 10) ?? '')
    setRemindTime(task.remindAt?.slice(11, 16) ?? '')
  }
  if (open !== syncedOpen) setSyncedOpen(open)

  const {
    updateTaskContent,
    updateTaskNote,
    updateTaskList,
    updateTaskDueDate,
    updateTaskDueTime,
    updateTaskPriority,
    assignTask,
    deleteTaskById,
  } = useTasks()
  const assignees = useAssignees(coMembers ?? [])

  // Counts reported by the checklist section feed back into `current` and the
  // caller's list, so a row's "1 of 3" badge follows an add/tick made here.
  const subtasks = useSubtasks(current?.id ?? null, open, (total, done) => {
    if (!current) return
    const updated = { ...current, subtaskTotal: total, subtaskDone: done }
    setCurrent(updated)
    onSaved?.(updated)
  })

  if (!task || !current) {
    return <Modal open={false} onOpenChange={onOpenChange} title="Task" children={null} />
  }

  const commit = (updated: Task) => {
    setCurrent(updated)
    onSaved?.(updated)
  }

  const saveName = () => {
    const trimmed = nameDraft.trim()
    if (trimmed === current.content) return
    updateTaskContent(current.id, trimmed)
      .then((updated) => {
        setNameDraft(updated.content)
        commit(updated)
      })
      .catch(() => {
        // updateTaskContent already surfaced the error (toast); revert the
        // draft so the field doesn't keep showing an unsaved edit.
        setNameDraft(current.content)
      })
  }

  const saveList = (value: string) => {
    updateTaskList(current.id, value || null)
      .then(commit)
      .catch(() => {
        // updateTaskList already surfaced the error (toast).
      })
  }

  const saveDueDate = (value: string) => {
    updateTaskDueDate(current.id, value || null)
      .then(commit)
      .catch(() => {
        // updateTaskDueDate already surfaced the error (toast).
      })
  }

  const savePriority = (value: TaskPriority) => {
    updateTaskPriority(current.id, value)
      .then(commit)
      .catch(() => {
        // updateTaskPriority already surfaced the error (toast).
      })
  }

  const saveAssignee = (value: string) => {
    assignTask(current.id, value || null)
      .then(commit)
      .catch(() => {
        // assignTask already surfaced the error (toast).
      })
  }

  const saveNote = () => {
    const trimmed = noteDraft
    if (trimmed === current.note) return
    updateTaskNote(current.id, trimmed)
      .then(commit)
      .catch(() => {
        // updateTaskNote already surfaced the error (toast); revert the
        // draft so the field doesn't keep showing an unsaved edit.
        setNoteDraft(current.note)
      })
  }

  // `updateTaskDueTime` (useTasks.ts) returns void, not the updated row, so
  // this merges the field locally rather than waiting on a round trip that
  // wouldn't tell us anything the optimistic merge doesn't already know —
  // same "commit what we asked for" shape `commit` uses everywhere else here.
  const saveDueTime = (value: string) => {
    const dueTime = value || null
    updateTaskDueTime(current.id, dueTime)
      .then(() => commit({ ...current, dueTime }))
      .catch(() => {
        // updateTaskDueTime already surfaced the error (toast).
      })
  }

  // Recurrence has no guard-free helper on useTasks.ts (unlike the other
  // fields here) — a direct PATCH, same guard-free story as
  // `updateTaskContent`/`updateTaskDueDate` (this modal's `current` task can
  // be one `loadTasks(view)` fetched, bypassing the outliner store, so the
  // store-backed `updateTask` would silently no-op). The worker clears
  // `recurrence_data` for us when `recurrence` is nulled without it
  // (worker/routes/tasks.ts), so clearing just sends `recurrence: null`.
  const saveRecurrence = async (frequency: TaskRecurrenceFrequency | '', interval: number) => {
    const recurrence = frequency || null
    const recurrenceData = recurrence ? { interval: Math.max(1, interval) } : null
    try {
      await api.patch(`/tasks/${current.id}`, { recurrence, recurrenceData })
      commit({ ...current, recurrence, recurrenceData })
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not save that repeat schedule — please try again.') })
    }
  }

  // Reminder: a direct PATCH like recurrence above. Saves only when day AND
  // time are both present; clearing sends null and empties both drafts.
  const saveRemindAt = async (date: string, time: string) => {
    if (!date || !time) return
    try {
      const row = await api.patch<{ remind_at?: string | null }>(`/tasks/${current.id}`, { remindAt: `${date}T${time}` })
      commit({ ...current, remindAt: row.remind_at ?? `${date}T${time}` })
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not save that reminder — please try again.') })
    }
  }

  const clearRemindAt = async () => {
    try {
      await api.patch(`/tasks/${current.id}`, { remindAt: null })
      setRemindDate('')
      setRemindTime('')
      commit({ ...current, remindAt: null })
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not clear that reminder — please try again.') })
    }
  }

  /**
   * "Delete task" — undo-toast, never a confirm dialog (CD-20). Restores via
   * a direct POST (the same shape `TasksListDetailPage.tsx`'s `undoDelete`
   * and `useTasks.ts`'s own `restoreDeleted` use) rather than routing
   * through the outliner store, since this modal's caller keeps its own
   * local task arrays.
   */
  const handleDelete = async () => {
    const snapshot = current
    onOpenChange(false)
    let deletedIds: string[]
    try {
      deletedIds = await deleteTaskById(snapshot.id)
    } catch {
      // deleteTaskById already surfaced the failure (reportAndReconcile).
      return
    }
    for (const id of deletedIds) onDeleted?.(id)

    if (undoToastIdRef.current) removeToast(undoToastIdRef.current)
    undoToastIdRef.current = addToast({
      message: 'Task deleted',
      action: {
        label: 'Undo',
        onClick: () => {
          void (async () => {
            try {
              await api.post('/tasks', {
                id: snapshot.id,
                parentId: snapshot.parentId,
                content: snapshot.content,
                note: snapshot.note,
                isCompleted: snapshot.isCompleted,
                isCollapsed: snapshot.isCollapsed,
                sortOrder: snapshot.sortOrder,
                dueDate: snapshot.dueDate ?? null,
                listId: snapshot.listId ?? null,
                priority: snapshot.priority,
                dueTime: snapshot.dueTime ?? null,
                assigneeId: snapshot.assigneeId ?? null,
                assignedAt: snapshot.assignedAt ?? null,
                recurrence: snapshot.recurrence ?? null,
                recurrenceData: snapshot.recurrenceData ?? null,
                recurrenceParentId: snapshot.recurrenceParentId ?? null,
                walletRef: snapshot.walletRef ?? null,
                trackedMinutes: snapshot.trackedMinutes,
                remindAt: snapshot.remindAt ?? null,
                createdAt: snapshot.createdAt,
                updatedAt: snapshot.updatedAt,
              })
              onSaved?.(snapshot)
            } catch (err) {
              addToast({ message: errorMessage(err, 'Could not undo that delete — please try again.') })
            }
          })()
          undoToastIdRef.current = null
        },
      },
      duration: 5000,
    })
  }

  const recurrenceInterval = current.recurrenceData?.interval ?? 1

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Task details" className="max-w-md">
      <div data-testid="task-detail-modal" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="task-detail-name" className="text-sm font-medium text-fg-muted">
            Name
          </label>
          <input
            id="task-detail-name"
            type="text"
            data-testid="task-detail-name"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            className={fieldInputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="task-detail-list" className="text-sm font-medium text-fg-muted">
            List
          </label>
          <select
            id="task-detail-list"
            data-testid="task-detail-list"
            value={current.listId ?? ''}
            onChange={(e) => saveList(e.target.value)}
            className={fieldInputClass}
          >
            <option value="">Unsorted</option>
            {availableLists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="task-detail-date" className="text-sm font-medium text-fg-muted">
            Due date
          </label>
          <DatePicker
            id="task-detail-date"
            data-testid="task-detail-date"
            value={current.dueDate ?? ''}
            onChange={(e) => saveDueDate(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="task-detail-due-time" className="text-sm font-medium text-fg-muted">
            Due time
          </label>
          <input
            id="task-detail-due-time"
            type="time"
            data-testid="task-detail-due-time"
            value={current.dueTime ?? ''}
            onChange={(e) => saveDueTime(e.target.value)}
            disabled={!current.dueDate}
            className={cn(fieldInputClass, 'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-fg-faint')}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="task-detail-remind-date" className="text-sm font-medium text-fg-muted">
            Remind me on
          </label>
          <div className="flex items-center gap-2">
            <input
              id="task-detail-remind-date"
              type="date"
              data-testid="task-detail-remind-date"
              value={remindDate}
              onChange={(e) => {
                setRemindDate(e.target.value)
                void saveRemindAt(e.target.value, remindTime)
              }}
              className={fieldInputClass}
            />
            <input
              type="time"
              aria-label="Remind me at"
              data-testid="task-detail-remind-time"
              value={remindTime}
              onChange={(e) => {
                setRemindTime(e.target.value)
                void saveRemindAt(remindDate, e.target.value)
              }}
              className={fieldInputClass}
            />
            {(remindDate || remindTime || current.remindAt) && (
              <button
                type="button"
                aria-label="Clear reminder"
                data-testid="task-detail-remind-clear"
                onClick={() => void clearRemindAt()}
                className="flex-shrink-0 rounded p-1 text-fg-faint hover:bg-surface-hover hover:text-fg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {(remindDate !== '') !== (remindTime !== '') && (
            <p className="text-xs text-fg-subtle">Set both a day and a time to save the reminder.</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="task-detail-priority" className="text-sm font-medium text-fg-muted">
            Priority
          </label>
          <select
            id="task-detail-priority"
            data-testid="task-detail-priority"
            value={current.priority}
            onChange={(e) => savePriority(e.target.value as TaskPriority)}
            className={fieldInputClass}
          >
            {PRIORITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="task-detail-recurrence" className="text-sm font-medium text-fg-muted">
            Repeat
          </label>
          <div className="flex items-center gap-2">
            <select
              id="task-detail-recurrence"
              data-testid="task-detail-recurrence"
              value={current.recurrence ?? ''}
              onChange={(e) => void saveRecurrence(e.target.value as TaskRecurrenceFrequency | '', recurrenceInterval)}
              className={fieldInputClass}
            >
              {RECURRENCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {current.recurrence && (
              <label className="flex flex-shrink-0 items-center gap-1.5 text-sm text-fg-muted">
                every
                <input
                  type="number"
                  min={1}
                  data-testid="task-detail-recurrence-interval"
                  aria-label="Repeat interval"
                  value={recurrenceInterval}
                  onChange={(e) => void saveRecurrence(current.recurrence!, Number(e.target.value) || 1)}
                  className={cn(fieldInputClass, 'w-16 px-2 text-center')}
                />
              </label>
            )}
          </div>
        </div>

        {coMembers && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="task-detail-assignee" className="text-sm font-medium text-fg-muted">
              Assignee
            </label>
            <select
              id="task-detail-assignee"
              data-testid="task-detail-assignee"
              value={current.assigneeId ?? ''}
              onChange={(e) => saveAssignee(e.target.value)}
              className={fieldInputClass}
            >
              <option value="">Unassigned</option>
              {assignees.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.username}
                </option>
              ))}
            </select>
          </div>
        )}

        <TaskTimeRow
          task={current}
          inputClassName={fieldInputClass}
          onChange={(fields) => commit({ ...current, ...fields })}
        />

        <TaskSubtasks
          items={subtasks.items}
          loading={subtasks.loading}
          loadError={subtasks.loadError}
          onAdd={subtasks.addItem}
          onToggle={(id) => void subtasks.toggleItem(id)}
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="task-detail-note" className="text-sm font-medium text-fg-muted">
            Note
          </label>
          <textarea
            id="task-detail-note"
            data-testid="task-detail-note"
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={saveNote}
            rows={4}
            className={fieldInputClass}
          />
        </div>

        {/* CD-20: undo-toast, never a confirm dialog — see handleDelete above. */}
        <div className="flex justify-end border-t border-line-subtle pt-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="task-detail-delete"
            className="text-red-600 hover:bg-red-50"
            onClick={() => void handleDelete()}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete task
          </Button>
        </div>
      </div>
    </Modal>
  )
}
