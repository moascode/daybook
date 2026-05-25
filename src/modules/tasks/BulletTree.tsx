import { useCallback } from 'react'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useTasksStore } from '@/stores/tasks.store'
import { BulletNode } from './BulletNode'
import type { Task } from '@/types/tasks.types'

interface BulletTreeProps {
  parentId: string | null
  depth: number
  focusId: string | null
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
}

export function BulletTree({
  parentId,
  depth,
  focusId,
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
}: BulletTreeProps) {
  const tasks = useTasksStore((s) => s.tasks)
  const hideCompleted = useTasksStore((s) => s.hideCompleted)

  const getFilteredChildren = useCallback(
    (pid: string | null): Task[] => {
      return tasks
        .filter((t) => {
          if (t.parentId !== pid) return false
          if (hideCompleted && t.isCompleted) return false
          return true
        })
        .sort((a, b) => a.sortOrder - b.sortOrder)
    },
    [tasks, hideCompleted],
  )

  const children = getFilteredChildren(parentId)
  const childIds = children.map((t) => t.id)

  const checkHasChildren = useCallback(
    (taskId: string): boolean => {
      return tasks.some((t) => t.parentId === taskId)
    },
    [tasks],
  )

  if (children.length === 0) {
    return null
  }

  return (
    <SortableContext items={childIds} strategy={verticalListSortingStrategy}>
      <div role="list">
        {children.map((task) => (
          <div key={task.id} role="listitem">
            <BulletNode
              task={task}
              depth={depth}
              hasChildren={checkHasChildren(task.id)}
              onUpdate={onUpdate}
              onUpdateNote={onUpdateNote}
              onToggleComplete={onToggleComplete}
              onToggleCollapse={onToggleCollapse}
              onEnter={onEnter}
              onBackspaceEmpty={onBackspaceEmpty}
              onIndent={onIndent}
              onOutdent={onOutdent}
              onDelete={onDelete}
              onZoomIn={onZoomIn}
              autoFocus={focusId === task.id}
            />

            {/* Recursively render children if not collapsed */}
            {!task.isCollapsed && (
              <BulletTree
                parentId={task.id}
                depth={depth + 1}
                focusId={focusId}
                onUpdate={onUpdate}
                onUpdateNote={onUpdateNote}
                onToggleComplete={onToggleComplete}
                onToggleCollapse={onToggleCollapse}
                onEnter={onEnter}
                onBackspaceEmpty={onBackspaceEmpty}
                onIndent={onIndent}
                onOutdent={onOutdent}
                onDelete={onDelete}
                onZoomIn={onZoomIn}
              />
            )}
          </div>
        ))}
      </div>
    </SortableContext>
  )
}
