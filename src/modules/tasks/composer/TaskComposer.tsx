import { forwardRef, useRef, useState } from 'react'
import { Send, Loader2, CheckSquare, Flame, AtSign } from 'lucide-react'
import { useAppStore } from '@/stores/app.store'
import { parseTaskComposerInput, type TaskComposerList, type ParsedTaskDraft } from './parseTaskComposerInput'

export type { TaskComposerList }

/** One canonical shape for a parsed draft — see `parseTaskComposerInput.ts`'s `ParsedTaskDraft`. */
export type TaskComposerDraft = ParsedTaskDraft

/**
 * The app-wide co-member shape (keyed by `userId`, matching every other
 * `coMembers` consumer in Tasks) — deliberately distinct from the parser's
 * internal `TaskComposerCoMember` (`{ id, username }`), which this component
 * maps into at the `parseTaskComposerInput` call site below.
 */
export interface TaskComposerMember {
  userId: string
  username: string
}

export interface TaskComposerProps {
  lists: TaskComposerList[]
  coMembers: TaskComposerMember[]
  onCreateTask: (draft: TaskComposerDraft) => Promise<void>
  onOpenHabitModal: () => void
  /**
   * Parent opens the shared `TaskFormModal` blank, carrying through whatever
   * text was already typed — mirrors Wallet's `onOpenBlankForm({ merchant })`
   * pattern (Composer.tsx). Used by the "Task" shortcut.
   */
  onOpenTaskForm: (initialContent?: string) => void
  /**
   * Parent opens the SAME `TaskFormModal`, but with its assignee field
   * focused — used by the "Assign" shortcut. There's no existing task to
   * assign yet, so this creates one and assigns it in the same step.
   */
  onOpenAssignForm: (initialContent?: string) => void
}

/**
 * The composer bar for `/tasks` Today (mirrors `wallet/composer/Composer.tsx`'s
 * shape): free-text quick-add input, `N`-hotkey focus target (via the
 * forwarded ref), and a rules-only parse — no AI call (CLAUDE.md rule 12).
 */
export const TaskComposer = forwardRef<HTMLInputElement, TaskComposerProps>(function TaskComposer(
  { lists, coMembers, onCreateTask, onOpenHabitModal, onOpenTaskForm, onOpenAssignForm },
  ref,
) {
  const username = useAppStore((s) => s.user?.username ?? '')
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // A ref, not just `submitting` state — two Enter keydowns landing before
  // React flushes the first `setSubmitting(true)` would both read `false`
  // from the render closure and fire two creates. See Composer.tsx's identical guard.
  const submittingRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function setRefs(node: HTMLInputElement | null) {
    inputRef.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) ref.current = node
  }

  async function handleSubmit() {
    const trimmed = text.trim()
    if (!trimmed || submittingRef.current) return

    const parsed = parseTaskComposerInput(
      trimmed,
      lists,
      coMembers.map((m) => ({ id: m.userId, username: m.username })),
    )

    submittingRef.current = true
    setSubmitting(true)
    try {
      await onCreateTask({
        content: parsed.content,
        listId: parsed.listId,
        priority: parsed.priority,
        assigneeId: parsed.assigneeId,
        dueDate: parsed.dueDate,
        dueTime: parsed.dueTime,
      })
      setText('')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleSubmit()
    }
  }

  const initial = (username || '?').charAt(0).toUpperCase()

  return (
    <div className="composer">
      <div className="composer-top">
        <span className="avatar" style={{ background: 'rgb(var(--accent-bg))', color: 'rgb(var(--accent-fg))' }}>
          {initial}
        </span>
        <label className="composer-field">
          <input
            ref={setRefs}
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Add a task — try "pay rent tomorrow 9am #household !high @tumpa"'
            aria-label="Add a task"
            data-testid="today-composer-input"
            disabled={submitting}
          />
          <span className="kbd">N</span>
        </label>
        <button
          type="button"
          className="composer-send"
          onClick={() => void handleSubmit()}
          disabled={submitting || !text.trim()}
          aria-label="Send"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>

      <div className="composer-acts">
        <button
          type="button"
          className="composer-act"
          onClick={() => {
            onOpenTaskForm(text.trim() || undefined)
            setText('')
          }}
        >
          <span className="cdot bg-info-bg text-info-fg">
            <CheckSquare className="icon-sm" aria-hidden="true" />
          </span>
          Task
        </button>
        <button type="button" className="composer-act" onClick={onOpenHabitModal}>
          <span className="cdot bg-alt-bg text-alt-fg">
            <Flame className="icon-sm" aria-hidden="true" />
          </span>
          Habit
        </button>
        <button
          type="button"
          className="composer-act"
          onClick={() => {
            onOpenAssignForm(text.trim() || undefined)
            setText('')
          }}
        >
          <span className="cdot bg-pos-bg text-pos-fg">
            <AtSign className="icon-sm" aria-hidden="true" />
          </span>
          Assign
        </button>
      </div>
    </div>
  )
})
