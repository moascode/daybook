import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { DatePicker } from '@/components/ui/DatePicker'
import { cn } from '@/lib/utils'
import { useTasks } from '@/hooks/useTasks'
import type { TaskList } from '@/hooks/useTaskLists'
import type { Task, TaskPriority } from '@/types/tasks.types'

export interface TaskDetailModalProps {
  task: Task | null
  open: boolean
  onOpenChange: (open: boolean) => void
  availableLists: TaskList[]
  coMembers?: { userId: string; username: string }[]
  onSaved?: (updated: Task) => void
}

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'med', label: 'Medium' },
  { value: 'high', label: 'High' },
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
}: TaskDetailModalProps) {
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
  const [syncedTaskId, setSyncedTaskId] = useState(task?.id ?? null)
  const [syncedOpen, setSyncedOpen] = useState(open)
  const taskChanged = task && task.id !== syncedTaskId
  const reopened = task && open && !syncedOpen
  if (taskChanged || reopened) {
    setSyncedTaskId(task.id)
    setCurrent(task)
    setNameDraft(task.content)
    setNoteDraft(task.note)
  }
  if (open !== syncedOpen) setSyncedOpen(open)

  const { updateTaskContent, updateTaskNote, updateTaskList, updateTaskDueDate, updateTaskPriority, assignTask } =
    useTasks()

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
              {coMembers.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.username}
                </option>
              ))}
            </select>
          </div>
        )}

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
      </div>
    </Modal>
  )
}
