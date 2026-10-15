import { useState } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Task } from '@/types/tasks.types'

export interface TaskSubtasksProps {
  items: Task[]
  loading: boolean
  loadError: string | null
  onAdd: (content: string) => Promise<boolean>
  onToggle: (id: string) => void
}

/**
 * The checklist section of the task detail modal (FEAT-056): each item as a
 * checkbox + its text, and an input that adds the next. Enter adds and keeps
 * focus for the following item; the draft is cleared only once the server
 * accepted it, so a failed add leaves the text there to retry.
 */
export function TaskSubtasks({ items, loading, loadError, onAdd, onToggle }: TaskSubtasksProps) {
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const done = items.filter((t) => t.isCompleted).length

  async function submit() {
    const content = draft.trim()
    if (!content || adding) return
    setAdding(true)
    const ok = await onAdd(content)
    setAdding(false)
    if (ok) setDraft('')
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid="task-detail-subtasks">
      <span className="text-sm font-medium text-fg-muted">
        Checklist{items.length > 0 ? ` · ${done} of ${items.length}` : ''}
      </span>

      {loading && <p className="text-xs text-fg-subtle">Loading items…</p>}
      {loadError && (
        <p className="text-xs text-red-500" role="alert" data-testid="task-detail-subtasks-error">
          {loadError}
        </p>
      )}

      {items.length > 0 && (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2" data-testid="task-detail-subtask">
              <button
                type="button"
                role="checkbox"
                aria-checked={item.isCompleted}
                aria-label={`Item done: ${item.content || 'untitled'}`}
                onClick={() => onToggle(item.id)}
                className={cn('tcheck', item.isCompleted && 'on')}
              >
                <Check />
              </button>
              <span className={cn('min-w-0 flex-1 break-words text-sm', item.isCompleted && 'text-fg-faint line-through')}>
                {item.content || 'Untitled item'}
              </span>
            </li>
          ))}
        </ul>
      )}

      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void submit()
          }
        }}
        placeholder="Add an item and press Enter"
        aria-label="New subtask"
        data-testid="task-detail-subtask-input"
        disabled={loading || loadError !== null}
        className={cn(
          'w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm',
          'focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20',
          'disabled:cursor-not-allowed disabled:bg-surface-sunken',
        )}
      />
    </div>
  )
}
