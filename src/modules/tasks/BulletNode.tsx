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
  Target,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { BulletEditor } from './BulletEditor'
import { BulletNote } from './BulletNote'
import type { Task } from '@/types/tasks.types'

interface BulletNodeProps {
  task: Task
  depth: number
  hasChildren: boolean
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
  autoFocus?: boolean
}

export function BulletNode({
  task,
  depth,
  hasChildren,
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
  autoFocus,
}: BulletNodeProps) {
  const [showNote, setShowNote] = useState(task.note.length > 0)

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
          'hover:bg-gray-50',
          task.isCompleted && 'opacity-60',
        )}
        style={{ paddingLeft: depth * 22 }}
      >
        {/* Drag handle — inline at the start of the row so it stays within the hover zone */}
        <button
          className={cn(
            'flex h-7 w-5 shrink-0 items-center justify-center',
            'text-gray-300 opacity-0 group-hover/node:opacity-100',
            'transition-opacity cursor-grab active:cursor-grabbing touch-none',
            'rounded hover:text-gray-500 pointer-events-none group-hover/node:pointer-events-auto',
          )}
          aria-label="Drag to reorder"
          title="Drag to reorder"
          {...attributes}
          {...listeners}
          tabIndex={-1}
        >
          <GripVertical className="h-3 w-3" />
        </button>

        {/* Collapse chevron — aligned to the bullet column */}
        <button
          className={cn(
            'flex h-7 w-5 shrink-0 items-center justify-center rounded transition-colors',
            hasChildren
              ? 'text-gray-300 hover:text-gray-600 cursor-pointer'
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
              : 'border-gray-300 bg-white hover:border-brand-400',
          )}
          onClick={() => onToggleComplete(task.id)}
          aria-label={task.isCompleted ? 'Mark incomplete' : 'Mark complete'}
          title={task.isCompleted ? 'Mark incomplete (click)' : 'Mark complete (click or Cmd+Enter)'}
          tabIndex={-1}
        >
          {task.isCompleted && (
            <Check className="h-2 w-2 text-white" strokeWidth={3.5} />
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

        {/* ── Hover actions ────────────────────────────────── */}
        <div
          className={cn(
            'flex shrink-0 items-center gap-0.5 py-0.5',
            'opacity-0 group-hover/node:opacity-100 transition-opacity duration-100',
          )}
        >
          {/* Note indicator or toggle */}
          <button
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded transition-colors',
              showNote || task.note.length > 0
                ? 'text-amber-400 hover:text-amber-600 hover:bg-amber-50'
                : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100',
            )}
            onClick={handleToggleNote}
            title={showNote ? 'Hide note' : task.note ? 'Show note' : 'Add note'}
            tabIndex={-1}
          >
            <StickyNote className="h-3.5 w-3.5" />
          </button>

          {/* Options dropdown */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className="flex h-6 w-6 items-center justify-center rounded text-gray-300 transition-colors hover:bg-gray-100 hover:text-gray-600"
                aria-label="Task options"
                tabIndex={-1}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="z-50 min-w-[180px] overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-xl shadow-gray-200/60 animate-in fade-in-0 zoom-in-95"
                sideOffset={4}
                align="end"
              >
                <DropdownMenu.Item
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 outline-none hover:bg-gray-50 focus:bg-gray-50"
                  onSelect={() => onToggleComplete(task.id)}
                >
                  <CheckSquare className="h-3.5 w-3.5 text-gray-400" />
                  {task.isCompleted ? 'Mark incomplete' : 'Mark complete'}
                </DropdownMenu.Item>

                <DropdownMenu.Item
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 outline-none hover:bg-gray-50 focus:bg-gray-50"
                  onSelect={() => onZoomIn(task.id)}
                >
                  <Target className="h-3.5 w-3.5 text-gray-400" />
                  Focus on this task
                </DropdownMenu.Item>

                <DropdownMenu.Item
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 outline-none hover:bg-gray-50 focus:bg-gray-50"
                  onSelect={handleToggleNote}
                >
                  <StickyNote className="h-3.5 w-3.5 text-gray-400" />
                  {showNote ? 'Hide note' : 'Add note'}
                </DropdownMenu.Item>

                <DropdownMenu.Separator className="my-1 h-px bg-gray-100" />

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
    </div>
  )
}
