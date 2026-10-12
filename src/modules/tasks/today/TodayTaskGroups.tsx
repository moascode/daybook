import { AlertTriangle, Clock, CheckCircle2 } from 'lucide-react'
import { TaskRow } from '@/modules/tasks/TaskRow'
import type { TaskList } from '@/hooks/useTaskLists'
import type { Task } from '@/types/tasks.types'

interface TodayTaskGroupsProps {
  overdueTasks: Task[]
  todayTasks: Task[]
  doneTodayTasks: Task[]
  doneCollapsed: boolean
  onToggleDoneCollapsed: () => void
  listById: Map<string, TaskList>
  coMembers: { userId: string; username: string }[]
  rescheduleLabel: string
  onRescheduleAll: () => void
  onToggleComplete: (id: string) => void
  onOpenDetail: (task: Task) => void
  onContentChange: (taskId: string, content: string) => void
  onDueDateChange: (taskId: string, dueDate: string | null) => void
  onDelete: (task: Task) => void
}

/** Overdue / Today / Done today — the Today page's grouped task list (mockup's `.tgroup` headings + `.task` rows). */
export function TodayTaskGroups({
  overdueTasks,
  todayTasks,
  doneTodayTasks,
  doneCollapsed,
  onToggleDoneCollapsed,
  listById,
  coMembers,
  rescheduleLabel,
  onRescheduleAll,
  onToggleComplete,
  onOpenDetail,
  onContentChange,
  onDueDateChange,
  onDelete,
}: TodayTaskGroupsProps) {
  return (
    <section className="c8 stack">
      {overdueTasks.length > 0 && (
        <div>
          <div className="tgroup">
            <AlertTriangle className="icon-sm text-neg-fg" aria-hidden="true" />
            <span className="text-neg-fg">Overdue</span>
            <span className="n">{overdueTasks.length}</span>
            <span className="line" />
            <button type="button" className="btn btn-quiet btn-sm" onClick={onRescheduleAll} data-testid="reschedule-all-btn">
              {rescheduleLabel}
            </button>
          </div>
          {overdueTasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              list={t.listId ? listById.get(t.listId) : undefined}
              coMembers={coMembers}
              onToggleComplete={onToggleComplete}
              onOpenDetail={onOpenDetail}
              onContentChange={onContentChange}
              onDueDateChange={onDueDateChange}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}

      <div>
        <div className="tgroup">
          <Clock className="icon-sm text-accent" aria-hidden="true" />
          <span>Today</span>
          <span className="n">{todayTasks.length}</span>
          <span className="line" />
        </div>
        {todayTasks.length === 0 ? (
          <p className="py-3 text-sm text-fg-subtle">Nothing due today.</p>
        ) : (
          todayTasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              list={t.listId ? listById.get(t.listId) : undefined}
              coMembers={coMembers}
              onToggleComplete={onToggleComplete}
              onOpenDetail={onOpenDetail}
              onContentChange={onContentChange}
              onDueDateChange={onDueDateChange}
              onDelete={onDelete}
            />
          ))
        )}
      </div>

      {doneTodayTasks.length > 0 && (
        <div>
          <div className="tgroup">
            <CheckCircle2 className="icon-sm text-pos-fg" aria-hidden="true" />
            <span>Done today</span>
            <span className="n">{doneTodayTasks.length}</span>
            <span className="line" />
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={onToggleDoneCollapsed}
              aria-expanded={!doneCollapsed}
              data-testid="done-today-toggle"
            >
              {doneCollapsed ? 'Show' : 'Hide'}
            </button>
          </div>
          {!doneCollapsed &&
            doneTodayTasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                list={t.listId ? listById.get(t.listId) : undefined}
                coMembers={coMembers}
                onToggleComplete={onToggleComplete}
                onOpenDetail={onOpenDetail}
                onContentChange={onContentChange}
                onDueDateChange={onDueDateChange}
                onDelete={onDelete}
              />
            ))}
        </div>
      )}
    </section>
  )
}
