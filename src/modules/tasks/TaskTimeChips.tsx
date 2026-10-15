import { formatTrackedMinutes } from '@/modules/tasks/trackedTime'
import type { Task } from '@/types/tasks.types'

/** `.task-sub` chips for a row: a running-timer marker and the banked minutes. Renders nothing for an untimed task. */
export function TaskTimeChips({ task }: { task: Pick<Task, 'trackedMinutes' | 'timerStartedAt'> }) {
  return (
    <>
      {task.timerStartedAt && (
        <span className="chip chip-pos" data-testid="task-row-timer-running">
          Timer running
        </span>
      )}
      {task.trackedMinutes > 0 && (
        <span className="chip chip-mute" data-testid="task-row-tracked">
          {formatTrackedMinutes(task.trackedMinutes)}
        </span>
      )}
    </>
  )
}
