import { useState, useCallback } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  ChevronRight,
  MoreHorizontal,
  Trash2,
  StickyNote,
  GripVertical,
  Check,
  CheckSquare,
  Square,
  Target,
  CalendarClock,
  BookCopy,
  Repeat,
} from 'lucide-react'
import { format, parseISO, isBefore, startOfDay } from 'date-fns'
import { cn } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { DatePicker } from '@/components/ui/DatePicker'
import { BulletEditor } from './BulletEditor'
import { BulletNote } from './BulletNote'
import type { Task, TaskRecurrenceFrequency, TaskRecurrenceData } from '@/types/tasks.types'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface BulletNodeProps {
  task: Task
  depth: number
  hasChildren: boolean
  selectMode?: boolean
  selected?: boolean
  onToggleSelect?: (id: string) => void
  onUpdate: (id: string, content: string) => void
  onUpdateNote: (id: string, note: string) => void
  onToggleComplete: (id: string) => void
  onToggleCollapse: (id: string) => void
  onEnter: (id: string) => void
  onBackspaceEmpty: (id: string) => void
  onIndent: (id: string) => void
  onOutdent: (id: string) => void
  onDelete: (id: string) => void
  onZoomIn: (id: string) => void
  onSetDueDate: (id: string, date: string | null) => void
  onSetRecurrence: (id: string, recurrence: TaskRecurrenceFrequency | null, data: TaskRecurrenceData | null) => void
  onSaveAsTemplate: (task: Task) => void
  autoFocus?: boolean
}

export function BulletNode({
  task,
  depth,
  hasChildren,
  selectMode = false,
  selected = false,
  onToggleSelect,
  onUpdate,
  onUpdateNote,
  onToggleComplete,
  onToggleCollapse,
  onEnter,
  onBackspaceEmpty,
  onIndent,
  onOutdent,
  onDelete,
  onZoomIn,
  onSetDueDate,
  onSetRecurrence,
  onSaveAsTemplate,
  autoFocus,
}: BulletNodeProps) {
  const [showNote, setShowNote] = useState(task.note.length > 0)
  const [showDueDateDialog, setShowDueDateDialog] = useState(false)
  const [pendingDueDate, setPendingDueDate] = useState(task.dueDate ?? '')
  const [showRecurrenceDialog, setShowRecurrenceDialog] = useState(false)
  const [pendingFrequency, setPendingFrequency] = useState<TaskRecurrenceFrequency | ''>(task.recurrence ?? '')
  const [pendingInterval, setPendingInterval] = useState(task.recurrenceData?.interval ?? 1)
  const [pendingWeekdays, setPendingWeekdays] = useState<number[]>(task.recurrenceData?.weekdays ?? [])
  const [pendingEndType, setPendingEndType] = useState<'never' | 'date' | 'count'>(
    task.recurrenceData?.end?.type ?? 'never',
  )
  const [pendingEndValue, setPendingEndValue] = useState(
    task.recurrenceData?.end ? String(task.recurrenceData.end.value) : '',
  )

  const today = startOfDay(new Date())
  const isOverdue =
    !!task.dueDate && isBefore(startOfDay(parseISO(task.dueDate)), today)

  const handleSaveDueDate = useCallback(() => {
    onSetDueDate(task.id, pendingDueDate || null)
    setShowDueDateDialog(false)
  }, [task.id, pendingDueDate, onSetDueDate])

  const toggleWeekday = useCallback((day: number) => {
    setPendingWeekdays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()))
  }, [])

  const handleSaveRecurrence = useCallback(() => {
    if (!pendingFrequency) {
      onSetRecurrence(task.id, null, null)
      setShowRecurrenceDialog(false)
      return
    }
    const data: TaskRecurrenceData = { interval: pendingInterval > 0 ? pendingInterval : 1 }
    if (pendingFrequency === 'custom') data.weekdays = pendingWeekdays
    if (pendingEndType === 'date' && pendingEndValue) {
      data.end = { type: 'date', value: pendingEndValue }
    } else if (pendingEndType === 'count' && pendingEndValue) {
      data.end = { type: 'count', value: Number(pendingEndValue) || 1 }
    }
    onSetRecurrence(task.id, pendingFrequency, data)
    setShowRecurrenceDialog(false)
  }, [task.id, pendingFrequency, pendingInterval, pendingWeekdays, pendingEndType, pendingEndValue, onSetRecurrence])

  const handleClearRecurrence = useCallback(() => {
    setPendingFrequency('')
    onSetRecurrence(task.id, null, null)
    setShowRecurrenceDialog(false)
  }, [task.id, onSetRecurrence])

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: { depth, parentId: task.parentId, sortOrder: task.sortOrder },
  })

  const handleToggleNote = useCallback(() => setShowNote((v) => !v), [])

  const handleSaveNote = useCallback(
    (id: string, note: string) => {
      onUpdateNote(id, note)
      if (note.length === 0) setShowNote(false)
    },
    [onUpdateNote],
  )

  return (
    <div
      ref={setNodeRef}
      data-testid="bullet-node"
      data-task-id={task.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('group/node select-none', isDragging && 'opacity-40')}
    >
      {/* ── Row ─────────────────────────────────────────────── */}
      <div
        className={cn(
          'relative flex items-start rounded-md transition-colors',
          'hover:bg-surface-sunken',
          task.isCompleted && 'opacity-60',
        )}
        style={{ paddingLeft: depth * 22 }}
      >
        {/* CD-20: multi-select checkbox — replaces the drag handle in select mode. */}
        {selectMode ? (
          <button
            className={cn(
              'flex h-7 w-5 shrink-0 items-center justify-center rounded transition-colors',
              selected ? 'text-brand-500' : 'text-fg-faint hover:text-fg-subtle',
            )}
            onClick={() => onToggleSelect?.(task.id)}
            role="checkbox"
            aria-checked={selected}
            aria-label={selected ? 'Deselect task' : 'Select task'}
            data-testid="task-select-checkbox"
          >
            {selected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
          </button>
        ) : (
          /* Drag handle — inline at the start of the row so it stays within the hover zone */
          <button
            className={cn(
              'flex h-7 w-5 shrink-0 items-center justify-center',
              'text-fg-faint opacity-0 group-hover/node:opacity-100',
              'transition-opacity cursor-grab active:cursor-grabbing touch-none',
              'rounded hover:text-fg-subtle pointer-events-none group-hover/node:pointer-events-auto',
            )}
            aria-label="Drag to reorder"
            title="Drag to reorder"
            {...attributes}
            {...listeners}
            tabIndex={-1}
          >
            <GripVertical className="h-3 w-3" />
          </button>
        )}

        {/* Collapse chevron — aligned to the bullet column */}
        <button
          className={cn(
            'flex h-7 w-5 shrink-0 items-center justify-center rounded transition-colors',
            hasChildren
              ? 'text-fg-faint hover:text-fg-muted cursor-pointer'
              : 'text-transparent pointer-events-none',
          )}
          onClick={() => hasChildren && onToggleCollapse(task.id)}
          aria-label={task.isCollapsed ? 'Expand' : 'Collapse'}
          tabIndex={-1}
        >
          {hasChildren && (
            <ChevronRight
              className={cn(
                'h-3 w-3 transition-transform duration-200',
                !task.isCollapsed && 'rotate-90',
              )}
            />
          )}
        </button>

        {/* ── Circular checkbox ─────────────────────────────── */}
        <button
          className={cn(
            'mt-1.5 mr-2 h-[15px] w-[15px] shrink-0 rounded-full border-[1.5px]',
            'flex items-center justify-center transition-all duration-150',
            task.isCompleted
              ? 'border-brand-500 bg-brand-500 shadow-sm'
              : 'border-line-strong bg-surface hover:border-brand-400',
          )}
          onClick={() => onToggleComplete(task.id)}
          aria-label={task.isCompleted ? 'Mark incomplete' : 'Mark complete'}
          title={task.isCompleted ? 'Mark incomplete (click)' : 'Mark complete (click or Cmd+Enter)'}
          tabIndex={-1}
        >
          {task.isCompleted && (
            <Check className="h-2 w-2 text-fg-on-accent" strokeWidth={3.5} />
          )}
        </button>

        {/* ── Text editor ──────────────────────────────────── */}
        <div className="min-w-0 flex-1 py-0.5">
          <BulletEditor
            taskId={task.id}
            content={task.content}
            isCompleted={task.isCompleted}
            onUpdate={onUpdate}
            onEnter={onEnter}
            onBackspaceEmpty={onBackspaceEmpty}
            onIndent={onIndent}
            onOutdent={onOutdent}
            onToggleComplete={onToggleComplete}
            onToggleCollapse={onToggleCollapse}
            autoFocus={autoFocus}
          />
        </div>

        {/* ── Due date badge ───────────────────────────────── */}
        {task.dueDate && (
          <div className="flex shrink-0 items-center self-center mr-1">
            <span
              data-testid={isOverdue ? 'overdue-indicator' : undefined}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                isOverdue
                  ? 'bg-red-100 text-red-700'
                  : 'bg-blue-50 text-blue-600',
              )}
            >
              <CalendarClock className="h-2.5 w-2.5" />
              {format(parseISO(task.dueDate), 'dd MMM yyyy')}
            </span>
          </div>
        )}

        {/* ── Recurrence badge (FEAT-028) ──────────────────── */}
        {task.recurrence && (
          <div className="flex shrink-0 items-center self-center mr-1">
            <span
              data-testid="recurrence-badge"
              className="inline-flex items-center gap-1 rounded-full bg-surface-sunken px-1.5 py-0.5 text-[10px] font-medium text-fg-muted"
            >
              <Repeat className="h-2.5 w-2.5" />
              {task.recurrence}
            </span>
          </div>
        )}

        {/* ── Hover actions ────────────────────────────────── */}
        <div
          className={cn(
            'flex shrink-0 items-center gap-0.5 py-0.5',
            // CD-13: touch devices have no hover, so keep the actions visible on
            // small screens and only hide-until-hover from md up.
            'opacity-100 md:opacity-0 md:group-hover/node:opacity-100 transition-opacity duration-100',
          )}
        >
          {/* Note indicator or toggle */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              'rounded',
              showNote || task.note.length > 0
                ? 'text-amber-400 hover:text-amber-600 hover:bg-amber-50 active:bg-amber-100'
                : 'text-fg-faint hover:text-fg-subtle hover:bg-surface-hover',
            )}
            onClick={handleToggleNote}
            title={showNote ? 'Hide note' : task.note ? 'Show note' : 'Add note'}
            aria-label={showNote ? 'Hide note' : task.note ? 'Show note' : 'Add note'}
            tabIndex={-1}
          >
            <StickyNote className="h-3.5 w-3.5" />
          </Button>

          {/* Options dropdown */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="rounded text-fg-faint hover:bg-surface-hover hover:text-fg-muted"
                aria-label="Task options"
                tabIndex={-1}
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
                  onSelect={() => onToggleComplete(task.id)}
                >
                  <CheckSquare className="h-3.5 w-3.5 text-fg-faint" />
                  {task.isCompleted ? 'Mark incomplete' : 'Mark complete'}
                </DropdownMenu.Item>

                <DropdownMenu.Item
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-fg-muted outline-none hover:bg-surface-sunken focus:bg-surface-sunken"
                  onSelect={() => onZoomIn(task.id)}
                >
                  <Target className="h-3.5 w-3.5 text-fg-faint" />
                  Focus on this task
                </DropdownMenu.Item>

                <DropdownMenu.Item
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-fg-muted outline-none hover:bg-surface-sunken focus:bg-surface-sunken"
                  onSelect={handleToggleNote}
                >
                  <StickyNote className="h-3.5 w-3.5 text-fg-faint" />
                  {showNote ? 'Hide note' : 'Add note'}
                </DropdownMenu.Item>

                <DropdownMenu.Item
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-fg-muted outline-none hover:bg-surface-sunken focus:bg-surface-sunken"
                  onSelect={() => {
                    setPendingDueDate(task.dueDate ?? '')
                    setShowDueDateDialog(true)
                  }}
                >
                  <CalendarClock className="h-3.5 w-3.5 text-fg-faint" />
                  Set due date
                </DropdownMenu.Item>

                <DropdownMenu.Item
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-fg-muted outline-none hover:bg-surface-sunken focus:bg-surface-sunken"
                  data-testid="bullet-menu-repeats"
                  onSelect={() => {
                    setPendingFrequency(task.recurrence ?? '')
                    setPendingInterval(task.recurrenceData?.interval ?? 1)
                    setPendingWeekdays(task.recurrenceData?.weekdays ?? [])
                    setPendingEndType(task.recurrenceData?.end?.type ?? 'never')
                    setPendingEndValue(task.recurrenceData?.end ? String(task.recurrenceData.end.value) : '')
                    setShowRecurrenceDialog(true)
                  }}
                >
                  <Repeat className="h-3.5 w-3.5 text-fg-faint" />
                  {task.recurrence ? 'Repeats…' : 'Make it repeat…'}
                </DropdownMenu.Item>

                <DropdownMenu.Item
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-fg-muted outline-none hover:bg-surface-sunken focus:bg-surface-sunken"
                  onSelect={() => onSaveAsTemplate(task)}
                >
                  <BookCopy className="h-3.5 w-3.5 text-fg-faint" />
                  Save as template
                </DropdownMenu.Item>

                <DropdownMenu.Separator className="my-1 h-px bg-surface-hover" />

                <DropdownMenu.Item
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-red-600 outline-none hover:bg-red-50 focus:bg-red-50"
                  onSelect={() => onDelete(task.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete task
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>

      {/* ── Note ────────────────────────────────────────────── */}
      {showNote && (
        <BulletNote
          taskId={task.id}
          note={task.note}
          depth={depth}
          onSave={handleSaveNote}
        />
      )}

      {/* ── Due date dialog ─────────────────────────────────── */}
      <Modal
        open={showDueDateDialog}
        onOpenChange={(open) => { if (!open) setShowDueDateDialog(false) }}
        title="Set due date"
        className="max-w-sm"
      >
        <div className="flex flex-col gap-4">
          <DatePicker
            label="Due date"
            value={pendingDueDate}
            onChange={(e) => setPendingDueDate(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            {pendingDueDate && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setPendingDueDate(''); onSetDueDate(task.id, null); setShowDueDateDialog(false) }}
              >
                Clear
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => setShowDueDateDialog(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveDueDate}>
              Save
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Recurrence dialog (FEAT-028) ────────────────────── */}
      <Modal
        open={showRecurrenceDialog}
        onOpenChange={(open) => { if (!open) setShowRecurrenceDialog(false) }}
        title="Repeats"
        className="max-w-sm"
      >
        <div data-testid="recurrence-dialog">
        {!task.dueDate ? (
          <p className="text-sm text-fg-muted">Set a due date first — a repeating task needs one to know when the next one is due.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="recurrence-frequency" className="text-sm font-medium text-fg-muted">
                Frequency
              </label>
              <select
                id="recurrence-frequency"
                data-testid="recurrence-frequency-select"
                value={pendingFrequency}
                onChange={(e) => setPendingFrequency(e.target.value as TaskRecurrenceFrequency | '')}
                className="rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              >
                <option value="">Does not repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
                <option value="custom">Custom (specific weekdays)</option>
              </select>
            </div>

            {pendingFrequency && pendingFrequency !== 'custom' && (
              <div className="flex items-center gap-2">
                <label htmlFor="recurrence-interval" className="text-sm text-fg-muted">
                  Every
                </label>
                <input
                  id="recurrence-interval"
                  data-testid="recurrence-interval-input"
                  type="number"
                  min={1}
                  value={pendingInterval}
                  onChange={(e) => setPendingInterval(Math.max(1, Number(e.target.value) || 1))}
                  className="w-16 rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
                <span className="text-sm text-fg-muted">
                  {{ daily: 'day(s)', weekly: 'week(s)', monthly: 'month(s)', yearly: 'year(s)' }[pendingFrequency]}
                </span>
              </div>
            )}

            {pendingFrequency === 'custom' && (
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-fg-muted">On these days</span>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAY_LABELS.map((label, day) => (
                    <button
                      key={day}
                      type="button"
                      data-testid={`recurrence-weekday-${day}`}
                      onClick={() => toggleWeekday(day)}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-xs',
                        pendingWeekdays.includes(day)
                          ? 'border-brand-500 bg-brand-50 text-brand-700'
                          : 'border-line-strong bg-surface text-fg-muted',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {pendingFrequency && (
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-fg-muted">Ends</span>
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Ends"
                    data-testid="recurrence-end-select"
                    value={pendingEndType}
                    onChange={(e) => setPendingEndType(e.target.value as 'never' | 'date' | 'count')}
                    className="rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  >
                    <option value="never">Never</option>
                    <option value="date">On date</option>
                    <option value="count">After N times</option>
                  </select>
                  {pendingEndType === 'date' && (
                    <input
                      type="date"
                      aria-label="End date"
                      data-testid="recurrence-end-value-input"
                      value={pendingEndValue}
                      onChange={(e) => setPendingEndValue(e.target.value)}
                      className="rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                  )}
                  {pendingEndType === 'count' && (
                    <input
                      type="number"
                      min={1}
                      aria-label="Number of times"
                      data-testid="recurrence-end-value-input"
                      value={pendingEndValue}
                      onChange={(e) => setPendingEndValue(e.target.value)}
                      className="w-20 rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              {task.recurrence && (
                <Button variant="ghost" size="sm" data-testid="recurrence-clear-btn" onClick={handleClearRecurrence}>
                  Stop repeating
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => setShowRecurrenceDialog(false)}>
                Cancel
              </Button>
              <Button size="sm" data-testid="recurrence-save-btn" onClick={handleSaveRecurrence}>
                Save
              </Button>
            </div>
          </div>
        )}
        </div>
      </Modal>
    </div>
  )
}
