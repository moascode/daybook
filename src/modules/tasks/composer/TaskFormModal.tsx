import { useEffect, useRef, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { DatePicker } from '@/components/ui/DatePicker'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import type { TaskPriority } from '@/types/tasks.types'

export interface TaskFormList {
  id: string
  name: string
}

export interface TaskFormCoMember {
  userId: string
  username: string
}

/** Same shape `TaskComposer`'s `onCreateTask` already takes — kept distinct
 * here (rather than importing `TaskComposerDraft`) so this modal has no
 * dependency on the composer's parser module. */
export interface TaskFormDraft {
  content: string
  listId: string | null
  priority: 'high' | 'med' | 'low' | null
  assigneeId: string | null
  dueDate: string | null
  dueTime: string | null
}

export interface TaskFormModalProps {
  open: boolean
  onClose: () => void
  lists: TaskFormList[]
  coMembers: TaskFormCoMember[]
  /** Pre-fills the content field — the composer-act shortcuts pass through
   * whatever text was already typed, mirroring Wallet's
   * `onOpenBlankForm({ merchant: trimmed })` pattern. */
  initialContent?: string
  /** 'assignee' autofocuses the Assignee field on open — the "Assign"
   * shortcut's entry point, since there's no existing task to assign yet. */
  focusField?: 'assignee'
  onSubmit: (draft: TaskFormDraft) => Promise<void>
}

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'med', label: 'Medium' },
  { value: 'high', label: 'High' },
]

interface FormState {
  content: string
  listId: string
  priority: TaskPriority
  assigneeId: string
  dueDate: string
  dueTime: string
}

function getInitialState(initialContent?: string): FormState {
  return {
    content: initialContent ?? '',
    listId: '',
    priority: 'none',
    assigneeId: '',
    dueDate: '',
    dueTime: '',
  }
}

/**
 * The shared "New task" modal (FEAT-054 follow-up, per product-owner review):
 * mirrors `TransactionForm.tsx`'s structure and `TaskDetailModal.tsx`'s field
 * conventions. Opened two ways from `TaskComposer.tsx`'s shortcut row — the
 * "Task" button opens it blank, "Assign" opens the SAME modal with
 * `focusField="assignee"` since assigning implies creating the task too.
 */
export function TaskFormModal({
  open,
  onClose,
  lists,
  coMembers,
  initialContent,
  focusField,
  onSubmit,
}: TaskFormModalProps) {
  const [form, setForm] = useState<FormState>(() => getInitialState(initialContent))
  const [saving, setSaving] = useState(false)
  const [prevOpen, setPrevOpen] = useState(open)
  const [prevInitialContent, setPrevInitialContent] = useState(initialContent)
  const contentRef = useRef<HTMLInputElement>(null)
  const assigneeRef = useRef<HTMLSelectElement>(null)

  // Reset the form when the modal (re)opens — adjust state during render
  // rather than in an effect, mirroring TransactionForm.tsx's identical
  // pattern.
  if (open !== prevOpen || initialContent !== prevInitialContent) {
    setPrevOpen(open)
    setPrevInitialContent(initialContent)
    if (open) {
      setForm(getInitialState(initialContent))
    }
  }

  // Autofocus: the content field normally, or the assignee field when opened
  // via the "Assign" shortcut. Radix Dialog focuses the first focusable
  // element itself on open, so this runs a tick after mount to win that race
  // rather than fighting it.
  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => {
      if (focusField === 'assignee') {
        assigneeRef.current?.focus()
      } else {
        contentRef.current?.focus()
      }
    }, 50)
    return () => window.clearTimeout(t)
  }, [open, focusField])

  const listOptions = [
    { value: '', label: 'Unsorted' },
    ...lists.map((l) => ({ value: l.id, label: l.name })),
  ]
  const assigneeOptions = [
    { value: '', label: 'Unassigned' },
    ...coMembers.map((m) => ({ value: m.userId, label: m.username })),
  ]

  const trimmedContent = form.content.trim()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (saving || !trimmedContent) return
    setSaving(true)
    try {
      await onSubmit({
        content: trimmedContent,
        listId: form.listId || null,
        priority: form.priority === 'none' ? null : form.priority,
        assigneeId: form.assigneeId || null,
        dueDate: form.dueDate || null,
        dueTime: form.dueDate ? form.dueTime || null : null,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="New task"
      className="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          ref={contentRef}
          label="Task"
          placeholder="What needs doing?"
          value={form.content}
          onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
          data-testid="task-form-content"
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            label="List"
            options={listOptions}
            value={form.listId}
            onChange={(e) => setForm((f) => ({ ...f, listId: e.target.value }))}
            data-testid="task-form-list"
          />
          <Select
            label="Priority"
            options={PRIORITY_OPTIONS}
            value={form.priority}
            onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as TaskPriority }))}
            data-testid="task-form-priority"
          />
        </div>

        <Select
          ref={assigneeRef}
          label="Assignee"
          options={assigneeOptions}
          value={form.assigneeId}
          onChange={(e) => setForm((f) => ({ ...f, assigneeId: e.target.value }))}
          data-testid="task-form-assignee"
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DatePicker
            label="Due date"
            value={form.dueDate}
            onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
            data-testid="task-form-due-date"
          />
          <Input
            label="Due time"
            type="time"
            value={form.dueTime}
            onChange={(e) => setForm((f) => ({ ...f, dueTime: e.target.value }))}
            disabled={!form.dueDate}
            data-testid="task-form-due-time"
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={saving || !trimmedContent} data-testid="task-form-submit">
            Add task
          </Button>
        </div>
      </form>
    </Modal>
  )
}
