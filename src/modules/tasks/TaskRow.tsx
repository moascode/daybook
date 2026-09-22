import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, Repeat, MoreHorizontal, Pencil, CalendarClock, Trash2, X } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { cn, todayISO } from '@/lib/utils'
import { useTasks } from '@/hooks/useTasks'
import { useWalletRefChips } from '@/hooks/useWalletRefChips'
import { Button } from '@/components/ui/Button'
import type { TaskList } from '@/hooks/useTaskLists'
import type { Task } from '@/types/tasks.types'

export interface TaskRowProps {
  task: Task
  /** The task's list, resolved by the parent page from `task.listId` — same per-row lookup TaskListRow.tsx already uses (not a per-row fetch). Renders the `.lchip` when present. */
  list?: TaskList
  /** Household co-members, for resolving `task.assigneeId` to the avatar's initials/name. Same shape and "resolved once by the parent" story as TaskListRow.tsx's `coMembers`. */
  coMembers?: { userId: string; username: string }[]
  onToggleComplete: (id: string) => void
  onOpenDetail: (task: Task) => void
  /** FEAT-052-style notify-only callback after a successful click-to-edit content save, mirroring TaskListRow.tsx's `onContentChange`. */
  onContentChange?: (taskId: string, content: string) => void
  /** Notify-only callback after a successful reschedule (via the kebab menu's inline date picker), mirroring TaskListRow.tsx's `onDueDateChange`. */
  onDueDateChange?: (taskId: string, dueDate: string | null) => void
  /** Notify-only callback after a successful delete (the row calls `useTasks().deleteTaskById` itself — the guard-free variant, since TasksTodayPage.tsx keeps its own local task list rather than the outliner store), so the parent can remove it. */
  onDelete?: (taskId: string) => void
}

const AVATAR_BG = ['bg-alt-bg text-alt-fg', 'bg-info-bg text-info-fg', 'bg-calm-bg text-calm-fg', 'bg-warn-bg text-warn-fg']

function avatarClass(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) | 0
  return AVATAR_BG[Math.abs(hash) % AVATAR_BG.length]
}

/** 'late' (red) / 'soon' (amber) / 'ok' / 'none' — drives `.task-when`'s colour. */
function dueState(task: Task): 'late' | 'soon' | 'ok' | 'none' {
  if (!task.dueDate) return 'none'
  if (task.isCompleted) return 'ok'
  const today = todayISO()
  if (task.dueDate < today) return 'late'
  if (task.dueDate === today) return 'soon'
  return 'ok'
}

// Accepts either a plain YYYY-MM-DD (due_date) or a "YYYY-MM-DD HH:MM:SS"
// SQLite datetime (completed_at) — only the date portion is ever displayed,
// and parseISO chokes on the space-separated SQLite form.
function formatDue(dateStr: string): string {
  return format(parseISO(dateStr.slice(0, 10)), 'dd MMM')
}

// A completed-today task shows the exact clock time it was finished (mockup:
// proposal-v2/tasks.html `.task.done` rows — "09:48"/"07:10"/"08:30"), not a
// date — the date is redundant when it's the same day the row is already
// grouped under. Older completions fall back to formatDue's date form, since
// "at what time three weeks ago" isn't useful. completedAt is a space-separated
// SQLite datetime ("YYYY-MM-DD HH:MM:SS"); parseISO needs the 'T' separator.
function formatCompletedAt(completedAt: string): string {
  const datePart = completedAt.slice(0, 10)
  if (datePart === todayISO()) {
    return format(parseISO(completedAt.replace(' ', 'T')), 'HH:mm')
  }
  return formatDue(completedAt)
}

function daysLate(dateIso: string): number {
  const [y1, m1, d1] = dateIso.split('-').map(Number)
  const [y2, m2, d2] = todayISO().split('-').map(Number)
  const ms = Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)
  return Math.round(ms / 86_400_000)
}

function daypart(timeStr: string): string {
  const hour = Number(timeStr.slice(0, 2))
  if (hour < 12) return 'Morning'
  if (hour < 17) return 'Afternoon'
  return 'Evening'
}

function formatExactTime(timeStr: string): string {
  return format(parseISO(`2000-01-01T${timeStr}`), 'h:mm a')
}

// The "one urgent case" (FEAT-054): a today item whose dueTime falls within
// the next 60 minutes gets the precise clock time instead of the daypart
// bucket, since "Morning"/"Afternoon"/"Evening" loses the urgency once it's
// actually about to hit.
function isUrgent(timeStr: string): boolean {
  const now = new Date()
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const [h, m] = timeStr.split(':').map(Number)
  const taskMinutes = h * 60 + m
  // Clamp at 1440 (end of day) instead of wrapping past midnight — a task due
  // at 23:50 is urgent only until 24:00, not "00:50 tomorrow".
  const upperBound = Math.min(nowMinutes + 60, 1440)
  return taskMinutes >= nowMinutes && taskMinutes <= upperBound
}

/**
 * The contextual due column (mockup: proposal-v2/tasks.html's FIRST
 * `.task-when` — "3 days late", "by 18:00", "Morning", the exact completion
 * time). This row's group (Overdue/Today/Done today) only ever holds tasks
 * due today, before today, or completed today, so "in N days" future
 * phrasing is out of scope here on purpose.
 */
function dueLabel(task: Task, state: ReturnType<typeof dueState>): string {
  if (task.isCompleted && task.completedAt) return formatCompletedAt(task.completedAt)
  if (!task.dueDate) return ''
  if (state === 'late') {
    const late = daysLate(task.dueDate)
    if (late === 1) return 'Yesterday'
    return `${late} days late`
  }
  if (state === 'soon') {
    // "Anytime", not "Today" — the second due column already carries "Today"
    // (dueLabelAnchor below), so repeating it here would be redundant.
    if (!task.dueTime) return 'Anytime'
    return isUrgent(task.dueTime) ? formatExactTime(task.dueTime) : daypart(task.dueTime)
  }
  return format(parseISO(task.dueDate), 'EEE dd MMM')
}

/**
 * The second, plain due column (mockup: the SECOND `.task-when` — "Thu 14",
 * "Sat 16", "Today"). Product-owner review of FEAT-054 confirmed the mockup
 * genuinely shows both columns together, not one swapped for the other at a
 * breakpoint — this row's own state colouring (late/soon) stays on the first
 * column only; this one is always plain/muted.
 */
function dueLabelAnchor(task: Task, state: ReturnType<typeof dueState>): string {
  if (task.isCompleted) return 'Today'
  if (!task.dueDate) return ''
  if (state === 'late') return format(parseISO(task.dueDate), 'EEE d')
  return 'Today'
}

function recurrenceLabel(task: Task): string | null {
  if (!task.recurrence) return null
  const interval = task.recurrenceData?.interval ?? 1
  if (task.recurrence === 'custom') return 'Repeats on a custom schedule'
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[task.recurrence]
  return interval > 1 ? `Repeats every ${interval} ${unit}s` : `Repeats ${task.recurrence}`
}

/**
 * One task row for the Today page — reuses the `.task`/`.tcheck`/`.task-when`
 * idiom already defined in src/styles/tasks.css. Now also renders a
 * `.task-meta` wrapper (FEAT-054, docs/backlog/EP-07-tasks-depth/FEAT-054-tasks-today-design-adoption.md)
 * with the list chip, subtask progress, recurrence and Wallet-linked chips,
 * an assignee avatar, and a kebab menu — the same trailing-content idiom
 * TaskListRow.tsx already established, applied here for parity.
 */
export function TaskRow({
  task,
  list,
  coMembers,
  onToggleComplete,
  onOpenDetail,
  onContentChange,
  onDueDateChange,
  onDelete,
}: TaskRowProps) {
  const state = dueState(task)
  const { updateTaskContent, updateTaskDueDate, deleteTaskById } = useTasks()
  const { resolveChip } = useWalletRefChips()

  // Click-to-edit content — same render-time re-sync pattern as
  // TaskListRow.tsx's `contentDraft` (not a `useEffect`, since a page keeping
  // its own local `tasks` state needs an edit made elsewhere, or a reload, to
  // win over a stale draft).
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
    if ((value ?? '') === (task.dueDate ?? '')) {
      setShowDatePicker(false)
      return
    }
    const previous = dueDateDraft
    setDueDateDraft(value ?? '')
    setShowDatePicker(false)
    updateTaskDueDate(task.id, value)
      .then((updated) => onDueDateChange?.(task.id, updated.dueDate))
      .catch(() => {
        setDueDateDraft(previous)
      })
  }

  const assignee = coMembers?.find((m) => m.userId === task.assigneeId)
  const walletChip = resolveChip(task.walletRef)
  const recurrence = recurrenceLabel(task)

  return (
    <div className={cn('task', task.isCompleted && 'done')} data-testid="today-task-row" data-task-id={task.id}>
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
              aria-label={`Edit ${task.content || 'task'}`}
              data-testid="today-task-row-content-input"
              className="w-full rounded border border-brand-500 bg-surface px-1 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          ) : (
            <p className="task-title cursor-text" onClick={() => setIsEditingContent(true)} title={task.content}>
              {task.content || 'Untitled task'}
            </p>
          )}
          {task.note && <p className="task-sub truncate">{task.note}</p>}

          {/* Mockup fidelity (product-owner review of FEAT-054): the list
              chip and its sibling chips sit on their own line directly under
              the title — `.task-sub` (proposal-v2/tasks.html) — not mixed
              into the trailing due/avatar/kebab group. `.task-sub` is
              already `display:flex` in tasks.css; this is its first real use
              as a chip row rather than a single note line. */}
          <div className="task-sub">
            {list ? (
              <span className="lchip" data-testid="today-task-row-list-chip">
                <i style={{ background: list.color }} aria-hidden="true" />
                {list.name}
              </span>
            ) : (
              // A task with listId === null (Unsorted) previously rendered no
              // chip at all — silently indistinguishable from a task whose list
              // just hadn't loaded yet. Always show a chip; use a neutral dot
              // (--line-strong, the same token borders/dividers use) rather than
              // inventing a new "no list" color.
              <span className="lchip" data-testid="today-task-row-list-chip">
                <i style={{ background: 'rgb(var(--line-strong))' }} aria-hidden="true" />
                Unsorted
              </span>
            )}

            {task.subtaskTotal > 0 && (
              <span className="sub-count" data-testid="today-task-row-subtasks">
                {task.subtaskDone} of {task.subtaskTotal}
              </span>
            )}

            {recurrence && (
              <span className="chip chip-mute inline-flex items-center gap-1" data-testid="today-task-row-recurrence" title={recurrence}>
                <Repeat className="h-3 w-3" aria-hidden="true" />
                {recurrence}
              </span>
            )}

            {walletChip && (
              <span className="chip chip-mute" data-testid="today-task-row-wallet-chip">
                {walletChip}
              </span>
            )}
          </div>
        </div>
      </div>

      {/*
        Trailing group (BUG, product-owner review of FEAT-054): due-date /
        avatar / kebab used to be three loose flex children mixed in with the
        leading chips above. Each optional field (especially the avatar,
        which rendered NOTHING when `assignee` was undefined) changed the
        group's total content width, so the kebab menu — meant to anchor
        every row at the same x-position, like Wallet's TransactionList.tsx
        trailing columns — drifted per row. `.task-meta` is now ONLY this
        trailing group (its own grid column per `.task:has(.task-meta)` in
        tasks.css), and the due label / avatar slots reserve their size even
        when empty, so all three behave like fixed columns regardless of
        what a given row has to show.
      */}
      <div className="task-meta">
        <div className="flex flex-shrink-0 items-center gap-2">
          {showDatePicker ? (
            <span className="inline-flex shrink-0 items-center gap-1">
              <input
                type="date"
                autoFocus
                aria-label={`Due date for ${task.content || 'task'}`}
                data-testid={`today-task-row-due-input-${task.id}`}
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
            // Two columns (product-owner review of FEAT-054, confirmed
            // against the rendered mockup): a contextual label ("3 days
            // late", "by 18:00", "Anytime") plus a plain anchor ("Thu 14",
            // "Today") — both shown together, not one swapped for the other.
            // Always rendered (not gated on task.dueDate) so the slots hold
            // their min-width even with no due label — otherwise the
            // avatar/kebab after them would shift left, same failure mode as
            // the avatar bug below.
            <>
              <span
                className={cn(
                  'task-when min-w-[70px] shrink-0 text-right',
                  state === 'late' && 'late',
                  state === 'soon' && 'soon',
                )}
              >
                {dueLabel(task, state)}
              </span>
              <span className="task-when min-w-[52px] shrink-0 text-right">{dueLabelAnchor(task, state)}</span>
            </>
          )}

          {assignee ? (
            <span
              className={cn('avatar', avatarClass(assignee.userId))}
              title={assignee.username}
              data-testid="today-task-row-assignee"
            >
              {assignee.username.charAt(0).toUpperCase()}
            </span>
          ) : (
            // Reserve the same 28x28 footprint `.avatar` occupies rather than
            // omitting the element — visibility:hidden keeps layout without
            // drawing a circle that could be mistaken for a real (blank) avatar.
            <span className="avatar" aria-hidden="true" style={{ visibility: 'hidden' }} />
          )}

          <div className="trow-actions flex-shrink-0 items-center gap-0.5 text-fg-faint" onClick={(e) => e.stopPropagation()}>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="rounded text-fg-faint hover:bg-surface-hover hover:text-fg-muted"
                  aria-label="Task options"
                  data-testid={`today-task-row-options-${task.id}`}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="z-50 min-w-[180px] overflow-hidden rounded-xl border border-line bg-surface-raised p-1 shadow-xl shadow-line/60 animate-in fade-in-0 zoom-in-95"
                  sideOffset={4}
                  align="end"
                >
                  <DropdownMenu.Item
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-fg-muted outline-none hover:bg-surface-sunken focus:bg-surface-sunken"
                    onSelect={() => onOpenDetail(task)}
                  >
                    <Pencil className="h-3.5 w-3.5 text-fg-faint" />
                    Edit details
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-fg-muted outline-none hover:bg-surface-sunken focus:bg-surface-sunken"
                    onSelect={() => setShowDatePicker(true)}
                  >
                    <CalendarClock className="h-3.5 w-3.5 text-fg-faint" />
                    Reschedule
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-red-600 outline-none hover:bg-red-50 focus:bg-red-50"
                    onSelect={() => {
                      deleteTaskById(task.id)
                        .then(() => onDelete?.(task.id))
                        .catch(() => {
                          // deleteTaskById already surfaces the failure (reportAndReconcile) —
                          // nothing more for this row to do.
                        })
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete task
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>
      </div>
    </div>
  )
}
