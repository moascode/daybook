import { useCallback } from 'react'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useTasksStore } from '@/stores/tasks.store'
import { BulletNode } from './BulletNode'
import type { Task } from '@/types/tasks.types'

function dueDateSorter(a: Task, b: Task): number {
  if (!a.dueDate && !b.dueDate) return a.sortOrder - b.sortOrder
  if (!a.dueDate) return 1
  if (!b.dueDate) return -1
  return a.dueDate.localeCompare(b.dueDate)
}

interface BulletTreeProps {
  parentId: string | null
  depth: number
  focusId: string | null
  sortByDue?: boolean
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
}

export function BulletTree({
  parentId,
  depth,
  focusId,
  sortByDue = false,
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
}: BulletTreeProps) {
  const tasks = useTasksStore((s) => s.tasks)
  const hideCompleted = useTasksStore((s) => s.hideCompleted)

  const getFilteredChildren = useCallback(
    (pid: string | null): Task[] =>
      tasks
        .filter((t) => {
          if (t.parentId !== pid) return false
          if (hideCompleted && t.isCompleted) return false
          return true
        })
        .sort((a, b) =>
          sortByDue ? dueDateSorter(a, b) : a.sortOrder - b.sortOrder,
        ),
    [tasks, hideCompleted, sortByDue],
  )

  const checkHasChildren = useCallback(
    (taskId: string): boolean => tasks.some((t) => t.parentId === taskId),
    [tasks],
  )

  const children = getFilteredChildren(parentId)
  if (children.length === 0) return null

  const childIds = children.map((t) => t.id)

  // Indent guide line: draw a subtle vertical line that runs next to nested items.
  // The line is positioned at depth*22 + 12 px from the left (aligning to the
  // collapse-chevron center of the parent row above).
  const guideLeft = depth * 22 + 12

  return (
    <SortableContext items={childIds} strategy={verticalListSortingStrategy}>
      <div className="relative">
        {/* Vertical guide line for nested items */}
        {depth > 0 && (
          <div
            className="pointer-events-none absolute top-1 bottom-2 w-px bg-gray-200"
            style={{ left: guideLeft - 22 }}  /* shift left to align with parent chevron */
            aria-hidden
          />
        )}

        {children.map((task) => (
          <div key={task.id}>
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
              onSetDueDate={onSetDueDate}
              autoFocus={focusId === task.id}
            />

            {!task.isCollapsed && (
              <BulletTree
                parentId={task.id}
                depth={depth + 1}
                focusId={focusId}
                sortByDue={sortByDue}
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
                onSetDueDate={onSetDueDate}
              />
            )}
          </div>
        ))}
      </div>
    </SortableContext>
  )
}
