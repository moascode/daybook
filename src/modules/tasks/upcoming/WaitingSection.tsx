import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, MoreHorizontal, Pencil, CalendarClock, X } from 'lucide-react'
import { useDraggable } from '@dnd-kit/core'
import { useClickUnlessDragged } from './useClickUnlessDragged'
import { cn } from '@/lib/utils'
import { avatarClass } from '@/lib/avatar'
import { addedLabel, MENU_CONTENT, MENU_ITEM } from '@/modules/tasks/taskRowFormat'
import type { TaskList } from '@/hooks/useTaskLists'
import type { Task } from '@/types/tasks.types'

const UNSORTED_COLOR = '#6b7280'
/** First page of "Waiting for a date" — the rest is behind "Show all". */
const PAGE_SIZE = 8

interface WaitingRowProps {
  task: Task
  list: Pick<TaskList, 'id' | 'name' | 'color'> | undefined
  assignee: { userId: string; username: string } | undefined
  onComplete: (id: string) => void
  onOpenDetail: (task: Task) => void
  onSetDate: (date: string) => void
}

function WaitingRow({ task, list, assignee, onComplete, onOpenDetail, onSetDate }: WaitingRowProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id })
  const openDetailClick = useClickUnlessDragged(() => onOpenDetail(task))
  const color = list?.color ?? UNSORTED_COLOR
  const label = task.content || 'Untitled task'
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined

  const [showDatePicker, setShowDatePicker] = useState(false)
  const [draft, setDraft] = useState('')

  const commit = (value: string) => {
    setShowDatePicker(false)
    if (value) onSetDate(value)
    setDraft('')
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      // select-none/touch-none: without them, a mouse-down-and-drag that
      // starts over the title text can race the browser's own native text
      // selection instead of (or alongside) dnd-kit's drag — the gesture is
      // ambiguous to the browser otherwise, since nothing here says "this
      // text isn't selectable." BCard below carries the same two classes
      // for the same reason.
      className={cn('task task--cols select-none touch-none', isDragging && 'relative z-10 opacity-50')}
      data-task-id={task.id}
      data-testid={`upcoming-waiting-row-${task.id}`}
    >
      <button type="button" className="tcheck" aria-label="Mark complete" onClick={() => onComplete(task.id)}>
        <Check />
      </button>

      <div className="task-name">
        <div className="min-w-0 flex-1">
          <p
            data-testid={`upcoming-waiting-open-${task.id}`}
            role="button"
            tabIndex={0}
            {...openDetailClick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onOpenDetail(task)
              }
            }}
            title={task.content}
            className="task-title cursor-pointer"
          >
            {label}
          </p>
          <div className="task-sub">
            <span className="lchip" title={list?.name ?? 'Unsorted'}>
              <i style={{ background: color }} aria-hidden="true" />
              {list?.name ?? 'Unsorted'}
            </span>
            <span className="chip chip-mute">{addedLabel(task.createdAt)}</span>
          </div>
        </div>
      </div>

      {showDatePicker ? (
        <span className="task-when-edit">
          <input
            type="date"
            autoFocus
            aria-label={`Schedule ${label}`}
            data-testid={`upcoming-schedule-${task.id}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(draft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(draft)
              if (e.key === 'Escape') {
                setDraft('')
                setShowDatePicker(false)
              }
            }}
            className="rounded border border-brand-500 bg-surface px-1 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
          <button
            type="button"
            aria-label="Cancel scheduling"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setDraft('')
              setShowDatePicker(false)
            }}
            className="text-fg-faint hover:text-fg-muted"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ) : (
        <>
          <span className="task-when col-exact">—</span>
          <button
            type="button"
            data-testid={`upcoming-schedule-trigger-${task.id}`}
            onClick={() => setShowDatePicker(true)}
            className="btn btn-quiet btn-sm"
          >
            Schedule
          </button>
          <span className="col-avatar flex justify-center">
            {assignee && (
              <span
                className={cn('avatar', avatarClass(assignee.userId))}
                style={{ width: 24, height: 24, fontSize: 10 }}
                title={assignee.username}
              >
                {assignee.username.charAt(0).toUpperCase()}
              </span>
            )}
          </span>
        </>
      )}

      <div className="trow-actions items-center text-fg-faint">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="icon-btn"
              aria-label={`More actions for ${label}`}
              data-testid={`upcoming-waiting-options-${task.id}`}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className={MENU_CONTENT} sideOffset={4} align="end">
              <DropdownMenu.Item className={MENU_ITEM} onSelect={() => onOpenDetail(task)}>
                <Pencil className="h-3.5 w-3.5 text-fg-faint" />
                Edit details
              </DropdownMenu.Item>
              <DropdownMenu.Item className={MENU_ITEM} onSelect={() => setShowDatePicker(true)}>
                <CalendarClock className="h-3.5 w-3.5 text-fg-faint" />
                Schedule
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  )
}

interface WaitingSectionProps {
  undated: Task[]
  listById: Map<string, TaskList>
  coMembers: { userId: string; username: string }[]
  currentUser: { id: string; username: string } | null
  onComplete: (id: string) => void
  onOpenDetail: (task: Task) => void
  onSetDate: (taskId: string, date: string) => void
  onAutoSchedule: () => void
  autoScheduling: boolean
}

/**
 * "Waiting for a date" (FEAT-057 mockup) — undated tasks, draggable onto any
 * day column (same DndContext as WeekBoard), with "Auto-schedule into the
 * gaps" above the list and a "Showing N of M" / "Show all" footer instead
 * of unbounded growth.
 */
export function WaitingSection({
  undated,
  listById,
  coMembers,
  currentUser,
  onComplete,
  onOpenDetail,
  onSetDate,
  onAutoSchedule,
  autoScheduling,
}: WaitingSectionProps) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? undated : undated.slice(0, PAGE_SIZE)

  const resolveAssignee = (task: Task) =>
    coMembers.find((m) => m.userId === task.assigneeId) ??
    (currentUser && task.assigneeId === currentUser.id ? { userId: currentUser.id, username: currentUser.username } : undefined)

  return (
    <section className="card card-pad" data-testid="upcoming-waiting-section">
      <div className="card-head">
        <div>
          <span className="card-title">Waiting for a date</span>
          <div className="card-sub">
            {undated.length} task{undated.length === 1 ? '' : 's'} with nowhere to go
          </div>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm ml-auto"
          data-testid="upcoming-auto-schedule"
          disabled={undated.length === 0 || autoScheduling}
          onClick={onAutoSchedule}
        >
          Auto-schedule into the gaps
        </button>
      </div>

      {undated.length === 0 ? (
        <p className="py-3 text-sm text-fg-subtle">Nothing is waiting on a date.</p>
      ) : (
        <>
          {visible.map((t) => (
            <WaitingRow
              key={t.id}
              task={t}
              list={t.listId ? listById.get(t.listId) : undefined}
              assignee={resolveAssignee(t)}
              onComplete={onComplete}
              onOpenDetail={onOpenDetail}
              onSetDate={(date) => onSetDate(t.id, date)}
            />
          ))}
          <div className="flex items-center gap-3 pt-2">
            <span className="text-sm text-fg-subtle" data-testid="upcoming-waiting-showing">
              Showing {visible.length} of {undated.length}
            </span>
            {!showAll && undated.length > PAGE_SIZE && (
              <button
                type="button"
                className="btn btn-secondary ml-auto"
                data-testid="upcoming-waiting-show-all"
                onClick={() => setShowAll(true)}
              >
                Show all
              </button>
            )}
          </div>
        </>
      )}
    </section>
  )
}
