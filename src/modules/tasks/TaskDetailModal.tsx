import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { DatePicker } from '@/components/ui/DatePicker'
import { cn, errorMessage } from '@/lib/utils'
import { api } from '@/lib/api'
import { useTasks } from '@/hooks/useTasks'
import { useToastStore } from '@/stores/toast.store'
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
  // Render-time re-sync from the prop (React's documented pattern), same as
  // TaskListRow.tsx's drafts — this modal's caller keeps its own local
  // `tasks` state, so an edit made elsewhere needs to win over a stale draft.
  const [nameDraft, setNameDraft] = useState(task?.content ?? '')
  const [noteDraft, setNoteDraft] = useState(task?.note ?? '')
  const [syncedTaskId, setSyncedTaskId] = useState(task?.id ?? null)
  if (task && task.id !== syncedTaskId) {
    setSyncedTaskId(task.id)
    setNameDraft(task.content)
    setNoteDraft(task.note)
  }

  const { updateTaskContent, updateTaskList, updateTaskDueDate, updateTaskPriority, assignTask } = useTasks()

  if (!task) {
    return <Modal open={false} onOpenChange={onOpenChange} title="Task" children={null} />
  }

  const saveName = () => {
    const trimmed = nameDraft.trim()
    if (trimmed === task.content) return
    updateTaskContent(task.id, trimmed)
      .then((updated) => {
        setNameDraft(updated.content)
        onSaved?.(updated)
      })
      .catch(() => {
        // updateTaskContent already surfaced the error (toast); revert the
        // draft so the field doesn't keep showing an unsaved edit.
        setNameDraft(task.content)
      })
  }

  const saveList = (value: string) => {
    updateTaskList(task.id, value || null)
      .then((updated) => onSaved?.(updated))
      .catch(() => {
        // updateTaskList already surfaced the error (toast).
      })
  }

  const saveDueDate = (value: string) => {
    updateTaskDueDate(task.id, value || null)
      .then((updated) => onSaved?.(updated))
      .catch(() => {
        // updateTaskDueDate already surfaced the error (toast).
      })
  }

  const savePriority = (value: TaskPriority) => {
    updateTaskPriority(task.id, value)
      .then((updated) => onSaved?.(updated))
      .catch(() => {
        // updateTaskPriority already surfaced the error (toast).
      })
  }

  const saveAssignee = (value: string) => {
    assignTask(task.id, value || null)
      .then((updated) => onSaved?.(updated))
      .catch(() => {
        // assignTask already surfaced the error (toast).
      })
  }

  const saveNote = () => {
    const trimmed = noteDraft
    if (trimmed === task.note) return
    // Deliberately NOT the general `updateTask` — it no-ops silently for a
    // task loaded via a store-bypassing fetch (this modal's callers are
    // exactly such callers: Today/All/Upcoming keep their own local `tasks`
    // state, not the Zustand store), the same bug class `updateTaskContent`
    // etc. exist to avoid. Mirrors their guard-free direct-PATCH pattern.
    api
      .patch<{ note: string }>(`/tasks/${task.id}`, { note: trimmed })
      .then((row) => {
        onSaved?.({ ...task, note: row.note })
      })
      .catch((err: unknown) => {
        useToastStore.getState().addToast({ message: errorMessage(err, 'Could not save your change — please try again.') })
        setNoteDraft(task.note)
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
            value={task.listId ?? ''}
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
            value={task.dueDate ?? ''}
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
            value={task.priority}
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
              value={task.assigneeId ?? ''}
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
