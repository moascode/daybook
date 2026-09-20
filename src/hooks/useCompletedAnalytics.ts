import { useCallback, useState } from 'react'
import { api } from '@/lib/api'

// FEAT-030 (docs/backlog/EP-07-tasks-depth/FEAT-030-tasks-completed-analytics.md).
export interface CompletedByList {
  listId: string | null
  count: number
  avgDays: number
}

export interface CompletedAnalytics {
  /** One entry per day that had at least one completion. */
  heatmap: { date: string; count: number }[]
  byList: CompletedByList[]
  overallAvgDays: number
  totalCompleted: number
}

const EMPTY: CompletedAnalytics = { heatmap: [], byList: [], overallAvgDays: 0, totalCompleted: 0 }

export function useCompletedAnalytics() {
  const [analytics, setAnalytics] = useState<CompletedAnalytics>(EMPTY)

  const loadAnalytics = useCallback(async (): Promise<CompletedAnalytics> => {
    const data = await api.get<CompletedAnalytics>('/tasks/completed/analytics')
    setAnalytics(data)
    return data
  }, [])

  return { analytics, loadAnalytics }
}
