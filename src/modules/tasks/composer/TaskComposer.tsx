import { forwardRef, useEffect, useRef, useState } from 'react'
import { Send, Loader2, CheckSquare, Repeat, Users } from 'lucide-react'
import { useAppStore } from '@/stores/app.store'
import { useToastStore } from '@/stores/toast.store'
import { errorMessage } from '@/lib/utils'
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
  const addToast = useToastStore((s) => s.addToast)
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

  // "N" (mockup: the composer's own `.kbd` hint) focuses this composer from
  // anywhere on the page — ignored while the user is already typing
  // somewhere else, or holding a modifier (which would otherwise steal a
  // browser/OS shortcut like Cmd+N).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== 'n') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

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
    } catch (err) {
      // onCreateTask (TasksTodayPage.tsx's handleCreateTask) already toasts
      // its own failures — this catch exists only so a defect in a FUTURE
      // caller can't silently eat the typed text (CLAUDE.md §2 rule 10): the
      // draft stays in the input either way, instead of vanishing.
      addToast({ message: errorMessage(err, 'Could not add that task — please try again.') })
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
          <span className="cdot bg-accent-bg text-accent-fg">
            <CheckSquare className="icon-sm" aria-hidden="true" />
          </span>
          Task
        </button>
        <button type="button" className="composer-act" onClick={onOpenHabitModal}>
          <span className="cdot bg-calm-bg text-calm-fg">
            <Repeat className="icon-sm" aria-hidden="true" />
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
          <span className="cdot bg-info-bg text-info-fg">
            <Users className="icon-sm" aria-hidden="true" />
          </span>
          Assign
        </button>
      </div>
    </div>
  )
})
