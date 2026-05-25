import { useState, useCallback } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  ChevronRight,
  ChevronDown,
  Circle,
  MoreHorizontal,
  Trash2,
  StickyNote,
  GripVertical,
  Check,
  CheckSquare,
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
    data: {
      depth,
      parentId: task.parentId,
      sortOrder: task.sortOrder,
    },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const handleToggleNote = useCallback(() => {
    setShowNote((prev) => !prev)
  }, [])

  const handleSaveNote = useCallback(
    (id: string, note: string) => {
      onUpdateNote(id, note)
      if (note.length === 0) {
        setShowNote(false)
      }
    },
    [onUpdateNote],
  )

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group',
        isDragging && 'opacity-40 bg-blue-50 rounded-lg',
      )}
    >
      {/* ── Main bullet line ─────────────────────────────────────── */}
      <div
        className="flex items-center gap-0.5 py-0.5 rounded hover:bg-gray-50/80 transition-colors"
        style={{ paddingLeft: depth * 24 }}
      >
        {/* Drag handle — visible on hover */}
        <button
          className="flex-shrink-0 w-5 h-6 flex items-center justify-center text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing touch-none"
          aria-label="Drag to reorder"
          title="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>

        {/* Collapse toggle */}
        <button
          className={cn(
            'flex-shrink-0 w-5 h-6 flex items-center justify-center rounded transition-colors',
            hasChildren
              ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-200'
              : 'text-transparent pointer-events-none',
          )}
          onClick={() => onToggleCollapse(task.id)}
          aria-label={task.isCollapsed ? 'Expand children' : 'Collapse children'}
          tabIndex={-1}
        >
          {hasChildren && (
            task.isCollapsed
              ? <ChevronRight className="h-3.5 w-3.5" />
              : <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>

        {/* ── Checkbox — click to mark complete ─────────────────── */}
        <button
          className={cn(
            'flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-all flex-none',
            task.isCompleted
              ? 'bg-brand-500 border-brand-500 text-white'
              : 'border-gray-300 text-transparent hover:border-brand-400 hover:text-brand-300',
          )}
          onClick={() => onToggleComplete(task.id)}
          aria-label={task.isCompleted ? 'Mark incomplete' : 'Mark complete'}
          title={task.isCompleted ? 'Mark incomplete' : 'Mark complete'}
          tabIndex={-1}
        >
          <Check className="h-2.5 w-2.5" strokeWidth={3} />
        </button>

        {/* Bullet dot — click to zoom in to this task */}
        <button
          className={cn(
            'flex-shrink-0 w-5 h-6 flex items-center justify-center rounded transition-colors',
            'text-gray-300 hover:text-brand-400',
          )}
          onClick={() => onZoomIn(task.id)}
          aria-label="Zoom into task"
          title="Focus on this task"
          tabIndex={-1}
        >
          <Circle className={cn(
            'h-2 w-2',
            hasChildren ? 'fill-current' : '',
          )} />
        </button>

        {/* Content editor */}
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

        {/* Note indicator dot — visible when note exists */}
        {task.note.length > 0 && !showNote && (
          <button
            className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-amber-400 hover:text-amber-600 transition-colors"
            onClick={handleToggleNote}
            aria-label="Show note"
            title="Show note"
            tabIndex={-1}
          >
            <div className="h-1.5 w-1.5 rounded-full bg-current" />
          </button>
        )}

        {/* Options menu */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded text-gray-300 opacity-0 group-hover:opacity-100 hover:text-gray-500 hover:bg-gray-200 transition-all"
              aria-label="Task options"
              tabIndex={-1}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="z-50 min-w-[180px] rounded-lg border border-gray-200 bg-white p-1 shadow-lg animate-in fade-in-0 zoom-in-95"
              sideOffset={4}
              align="end"
            >
              {/* Mark complete / incomplete */}
              <DropdownMenu.Item
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-700 outline-none cursor-pointer hover:bg-gray-100 focus:bg-gray-100"
                onSelect={() => onToggleComplete(task.id)}
              >
                <CheckSquare className="h-4 w-4" />
                {task.isCompleted ? 'Mark incomplete' : 'Mark complete'}
              </DropdownMenu.Item>

              {/* Add / hide note */}
              <DropdownMenu.Item
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-700 outline-none cursor-pointer hover:bg-gray-100 focus:bg-gray-100"
                onSelect={handleToggleNote}
              >
                <StickyNote className="h-4 w-4" />
                {showNote ? 'Hide note' : 'Add note'}
              </DropdownMenu.Item>

              <DropdownMenu.Separator className="my-1 h-px bg-gray-100" />

              {/* Delete */}
              <DropdownMenu.Item
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-red-600 outline-none cursor-pointer hover:bg-red-50 focus:bg-red-50"
                onSelect={() => onDelete(task.id)}
              >
                <Trash2 className="h-4 w-4" />
                Delete task
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      {/* Note field */}
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
