import { forwardRef, useEffect, useRef, useState } from 'react'
import { Send, Loader2, CheckSquare, Repeat, Users, Clock, ListChecks } from 'lucide-react'
import { useAppStore } from '@/stores/app.store'
import { useToastStore } from '@/stores/toast.store'
import { errorMessage, todayISO } from '@/lib/utils'
import { isPushActiveHere } from '@/lib/pushStatus'
import { reminderLabel } from '@/modules/tasks/taskRowFormat'
import type { Task } from '@/types/tasks.types'
import { ComposerReminderFields } from './ComposerReminderFields'
import { ComposerChecklistItems } from './ComposerChecklistItems'
import { useComposerExtras } from './useComposerExtras'
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
  /**
   * Reminder and Checklist create their tasks inside the composer (they are
   * not a parsed draft), so the page is told about them here to put them in
   * its own local list — same upsert-by-id contract as every other page-local
   * mutation. Without it the tasks still save, but only appear after a reload.
   */
  onTasksCreated?: (tasks: Task[]) => void
  /** A list's own page files Reminder/Checklist tasks into that list, as it does for typed ones. */
  defaultListId?: string | null
  /**
   * Today files every task it creates under today's date (BUG-009), so a
   * checklist made there must too or it would vanish from the page it was
   * made on. A reminder is deliberately exempt: it stays undated.
   */
  defaultDueDate?: string | null
}

type ComposerMode = 'task' | 'reminder' | 'checklist'

/**
 * The composer bar for `/tasks` Today (mirrors `wallet/composer/Composer.tsx`'s
 * shape): free-text quick-add input, `N`-hotkey focus target (via the
 * forwarded ref), and a rules-only parse — no AI call (CLAUDE.md rule 12).
 */
export const TaskComposer = forwardRef<HTMLInputElement, TaskComposerProps>(function TaskComposer(
  { lists, coMembers, onCreateTask, onOpenHabitModal, onOpenTaskForm, onOpenAssignForm, onTasksCreated, defaultListId = null, defaultDueDate = null },
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
  const { createReminder, createChecklist } = useComposerExtras()
  const [mode, setMode] = useState<ComposerMode>('task')
  const [remindDate, setRemindDate] = useState(todayISO)
  const [remindTime, setRemindTime] = useState('')
  const [items, setItems] = useState<string[]>([''])
  // Set once a checklist's parent exists, so retrying failed items adds them
  // to THAT parent instead of creating a second checklist.
  const [checklistParent, setChecklistParent] = useState<Task | null>(null)
  const [itemsFocusSignal, setItemsFocusSignal] = useState(0)

  function exitMode() {
    setMode('task')
    setRemindTime('')
    setRemindDate(todayISO())
    setItems([''])
    setChecklistParent(null)
    inputRef.current?.focus()
  }

  function toggleMode(next: Exclude<ComposerMode, 'task'>) {
    if (mode === next) return exitMode()
    setMode(next)
    setRemindTime('')
    setItems([''])
    setChecklistParent(null)
    inputRef.current?.focus()
  }

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

  async function submitReminder(content: string) {
    const remindAt = `${remindDate}T${remindTime}`
    submittingRef.current = true
    setSubmitting(true)
    try {
      const { task, reminderSaved, error } = await createReminder(content, remindAt, defaultListId)
      onTasksCreated?.([task])
      setText('')
      if (!reminderSaved) {
        // The task exists, so the composer resets — but the user is told the
        // reminder itself is missing and how to fix it.
        addToast({
          message: errorMessage(error, 'Task added, but its reminder could not be saved — open it to set one.'),
          duration: 6000,
        })
      } else {
        const label = reminderLabel(remindAt) ?? remindAt
        const pushOn = await isPushActiveHere()
        addToast({
          message: pushOn
            ? `Reminder set for ${label}.`
            : `Reminder set for ${label}. It will show in Daybook's notifications — turn on phone notifications in Settings to get a push.`,
          duration: pushOn ? 4000 : 7000,
        })
      }
      exitMode()
    } catch (err) {
      // addTask already toasted an API failure; this covers anything it did not.
      addToast({ message: errorMessage(err, 'Could not set that reminder — please try again.') })
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  async function submitChecklist(title: string) {
    const filled = items.map((i) => i.trim()).filter(Boolean)
    if (filled.length === 0) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      const { parent, failedItems, createdCount, listSaved } = await createChecklist(title, filled, checklistParent, {
        listId: defaultListId,
        dueDate: defaultDueDate,
      })
      setChecklistParent(parent)
      onTasksCreated?.([parent])
      if (!listSaved) {
        addToast({ message: `Checklist "${parent.content}" was created, but its list or date could not be set, so it may not show on this page. Open it from All tasks to fix that.`, duration: 7000 })
      }
      if (failedItems.length === 0) {
        addToast({ message: `Checklist "${parent.content}" created with ${parent.subtaskTotal} item${parent.subtaskTotal === 1 ? '' : 's'}.` })
        setText('')
        exitMode()
      } else {
        // Keep exactly the items that failed so Send retries them — never drop them.
        setItems(failedItems)
        const attempted = failedItems.length + createdCount
        addToast({
          message: `Checklist "${parent.content}" created, but ${failedItems.length} of ${attempted} item${attempted === 1 ? '' : 's'} failed to save. They are still here — press Send to retry.`,
          duration: 8000,
        })
      }
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not create that checklist — please try again.') })
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  async function handleSubmit() {
    const trimmed = text.trim()
    if (!trimmed || submittingRef.current) return
    if (mode === 'reminder') {
      if (!remindDate || !remindTime) return
      return submitReminder(trimmed)
    }
    if (mode === 'checklist') return submitChecklist(trimmed)

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
    if (e.key === 'Escape' && mode !== 'task') {
      e.preventDefault()
      exitMode()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      // In checklist mode Enter in the title means "start on the items".
      if (mode === 'checklist') setItemsFocusSignal((n) => n + 1)
      else void handleSubmit()
    }
  }

  const canSend =
    !!text.trim() &&
    (mode === 'task' ||
      (mode === 'reminder' && !!remindDate && !!remindTime) ||
      (mode === 'checklist' && items.some((i) => i.trim())))

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
            placeholder={
              mode === 'reminder'
                ? 'Remind me to… e.g. "check on the roast"'
                : mode === 'checklist'
                  ? 'Checklist title — e.g. "Packing list"'
                  : 'Add a task — try "pay rent tomorrow 9am #household !high @tumpa"'
            }
            aria-label={mode === 'reminder' ? 'Reminder text' : mode === 'checklist' ? 'Checklist title' : 'Add a task'}
            data-testid="today-composer-input"
            disabled={submitting || checklistParent !== null}
          />
          <span className="kbd">N</span>
        </label>
        <button
          type="button"
          className="composer-send"
          onClick={() => void handleSubmit()}
          disabled={submitting || !canSend}
          aria-label="Send"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>

      {mode === 'reminder' && (
        <ComposerReminderFields
          date={remindDate}
          time={remindTime}
          onDateChange={setRemindDate}
          onTimeChange={setRemindTime}
          disabled={submitting}
        />
      )}
      {mode === 'checklist' && (
        <ComposerChecklistItems
          items={items}
          onChange={setItems}
          onExit={exitMode}
          focusFirstSignal={itemsFocusSignal}
          disabled={submitting}
        />
      )}
      {mode === 'checklist' && checklistParent && (
        <p className="mt-2 text-xs text-fg-subtle" data-testid="composer-checklist-retry-note">
          Checklist "{checklistParent.content}" was created — these items are the ones that did not save.
        </p>
      )}

      <div className="composer-acts">
        <button
          type="button"
          className="composer-act"
          onClick={() => {
            onOpenTaskForm(text.trim() || undefined)
            setText('')
            if (mode !== 'task') exitMode()
          }}
        >
          <span className="cdot bg-accent-bg text-accent-fg">
            <CheckSquare className="icon-sm" aria-hidden="true" />
          </span>
          Task
        </button>
        <button
          type="button"
          className="composer-act"
          aria-pressed={mode === 'reminder'}
          data-testid="composer-act-reminder"
          onClick={() => toggleMode('reminder')}
        >
          <span className="cdot bg-warn-bg text-warn-fg">
            <Clock className="icon-sm" aria-hidden="true" />
          </span>
          Reminder
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
            if (mode !== 'task') exitMode()
          }}
        >
          <span className="cdot bg-info-bg text-info-fg">
            <Users className="icon-sm" aria-hidden="true" />
          </span>
          Assign
        </button>
        <button
          type="button"
          className="composer-act"
          aria-pressed={mode === 'checklist'}
          data-testid="composer-act-checklist"
          onClick={() => toggleMode('checklist')}
        >
          <span className="cdot bg-surface-sunken text-fg-muted">
            <ListChecks className="icon-sm" aria-hidden="true" />
          </span>
          Checklist
        </button>
      </div>
    </div>
  )
})
