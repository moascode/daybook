import { useEffect, useState } from 'react'
import { Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn, errorMessage } from '@/lib/utils'
import { useTaskTimer } from '@/hooks/useTaskTimer'
import type { TrackedTimeFields } from '@/hooks/useTaskTimer'
import { useToastStore } from '@/stores/toast.store'
import { formatElapsed, parseServerUtc } from '@/modules/tasks/trackedTime'
import type { Task } from '@/types/tasks.types'

interface TaskTimeRowProps {
  task: Task
  inputClassName: string
  onChange: (fields: TrackedTimeFields) => void
}

const MAX_MINUTES = 100000

/** TaskDetailModal's "Time" field — start/stop timer with a live readout, plus a manual minutes input. */
export function TaskTimeRow({ task, inputClassName, onChange }: TaskTimeRowProps) {
  const addToast = useToastStore((s) => s.addToast)
  const { startTimer, stopTimer, setTrackedMinutes } = useTaskTimer()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const startedMs = task.timerStartedAt ? parseServerUtc(task.timerStartedAt) : null
  const running = startedMs !== null

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])

  const toggleTimer = async () => {
    setBusy(true)
    try {
      if (running) {
        onChange(await stopTimer(task.id))
      } else {
        const { fields, stoppedTimers } = await startTimer(task.id)
        onChange(fields)
        for (const other of stoppedTimers) {
          addToast({ message: `Stopped timer on ${other.content || 'Untitled task'}` })
        }
      }
    } catch (err) {
      addToast({
        message: errorMessage(err, running ? 'Could not stop the timer — please try again.' : 'Could not start the timer — please try again.'),
      })
    } finally {
      setBusy(false)
    }
  }

  const saveMinutes = async (raw: string) => {
    const text = raw.trim()
    const value = Number(text)
    if (text === '' || !Number.isInteger(value) || value < 0 || value > MAX_MINUTES) {
      setError(`Enter a whole number of minutes from 0 to ${MAX_MINUTES}.`)
      return
    }
    setError(null)
    if (value === task.trackedMinutes) return
    try {
      onChange(await setTrackedMinutes(task.id, value))
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not save the tracked time — please try again.') })
    }
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid="task-detail-time">
      <span className="text-sm font-medium text-fg-muted">Time</span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy}
          data-testid="task-timer-toggle"
          onClick={() => void toggleTimer()}
        >
          {running ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {running ? 'Stop timer' : 'Start timer'}
        </Button>
        {running && (
          <span className="chip chip-pos" data-testid="task-timer-elapsed" aria-live="off">
            {formatElapsed(now - startedMs)}
          </span>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-sm text-fg-muted">
          <input
            key={task.trackedMinutes}
            type="number"
            min={0}
            max={MAX_MINUTES}
            step={1}
            inputMode="numeric"
            aria-label="Minutes tracked"
            aria-invalid={error ? true : undefined}
            data-testid="task-detail-minutes"
            defaultValue={task.trackedMinutes}
            onChange={() => setError(null)}
            onBlur={(e) => void saveMinutes(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            className={cn(inputClassName, 'w-24 px-2 text-center', error && 'border-red-500')}
          />
          min
        </label>
      </div>
      {error && (
        <p className="text-xs text-red-600" role="alert" data-testid="task-detail-minutes-error">
          {error}
        </p>
      )}
    </div>
  )
}
