import { useCallback, useState } from 'react'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/utils'
import { useToastStore } from '@/stores/toast.store'

/** One task a viewer may nudge: its id, and who it is assigned to. */
export interface NudgeTarget {
  taskId: string
  assigneeName: string
}

type NudgeOutcome = 'sent' | 'already' | { failed: string }

/**
 * Nudging the assignee of a task you handed out (POST /tasks/:id/nudge).
 *
 * The server is the source of truth for "already nudged today" (a
 * push_sent_log row), so `nudgedIds` is seeded from it and a 409 from the
 * server also marks a row nudged. Every outcome ends in a toast — a nudge that
 * changes nothing on screen and says nothing is the failure rule 10 forbids.
 */
export function useNudges() {
  const addToast = useToastStore((s) => s.addToast)
  const [nudgedIds, setNudgedIds] = useState<Set<string>>(new Set())
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [nudgingAll, setNudgingAll] = useState(false)

  const seedNudged = useCallback((ids: string[]) => setNudgedIds(new Set(ids)), [])

  const markNudged = (taskId: string) => setNudgedIds((prev) => new Set(prev).add(taskId))

  const send = async (taskId: string): Promise<{ outcome: NudgeOutcome; devices: number }> => {
    setPendingIds((prev) => new Set(prev).add(taskId))
    try {
      const res = await api.post<{ ok: boolean; devices: number }>(`/tasks/${taskId}/nudge`)
      markNudged(taskId)
      return { outcome: 'sent', devices: res.devices }
    } catch (err) {
      const message = errorMessage(err, 'Could not send the nudge — please try again.')
      if (message === 'Already nudged today') {
        markNudged(taskId)
        return { outcome: 'already', devices: 0 }
      }
      return { outcome: { failed: message }, devices: 0 }
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev)
        next.delete(taskId)
        return next
      })
    }
  }

  const nudgeOne = async ({ taskId, assigneeName }: NudgeTarget) => {
    const { outcome, devices } = await send(taskId)
    if (outcome === 'sent') {
      addToast({
        message:
          devices > 0
            ? `Nudged ${assigneeName} — sent to their phone`
            : `Nudged ${assigneeName} — they'll see it in their notifications next time they open Daybook`,
      })
    } else if (outcome === 'already') {
      addToast({ message: `Already nudged ${assigneeName} about this today` })
    } else {
      addToast({ message: outcome.failed })
    }
  }

  const nudgeAll = async (targets: NudgeTarget[]) => {
    if (targets.length === 0) {
      addToast({ message: 'You have no open assigned tasks to nudge about' })
      return
    }
    setNudgingAll(true)
    let sent = 0
    let already = 0
    const failures: string[] = []
    try {
      for (const t of targets) {
        if (nudgedIds.has(t.taskId)) {
          already += 1
          continue
        }
        const { outcome } = await send(t.taskId)
        if (outcome === 'sent') sent += 1
        else if (outcome === 'already') already += 1
        else failures.push(`${t.assigneeName} (${outcome.failed})`)
      }
    } finally {
      setNudgingAll(false)
    }
    const parts = [`Nudged ${sent}`]
    if (already > 0) parts.push(`${already} already nudged today`)
    if (failures.length > 0) parts.push(`${failures.length} failed: ${failures.join('; ')}`)
    addToast({ message: parts.join(' · ') })
  }

  return { nudgedIds, pendingIds, nudgingAll, seedNudged, nudgeOne, nudgeAll }
}
