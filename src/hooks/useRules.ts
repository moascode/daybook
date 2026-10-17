import { useCallback, useState } from 'react'
import { api } from '@/lib/api'
import { mapRule } from '@/lib/rules'
import type { TransactionRule } from '@/types/wallet.types'

export interface RuleInput {
  name?: string
  enabled?: boolean
  matchAccountId?: string | null
  matchCategoryId?: string | null
  matchMerchant?: string | null
  setCategoryId?: string | null
  addTags?: string[] | null
  splitUserId?: string | null
  splitPercent?: number | null
}

/**
 * Transaction rules CRUD (worker/routes/rules.ts). Server write first, then
 * local state (CLAUDE.md §6) — every method throws on failure rather than
 * swallowing it, so the caller (RulesSettings/RuleDialog) can toast.
 */
export function useRules() {
  const [rules, setRules] = useState<TransactionRule[]>([])
  const [loading, setLoading] = useState(false)

  const loadRules = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await api.get<Record<string, unknown>[]>('/rules')
      const mapped = rows.map(mapRule)
      setRules(mapped)
      return mapped
    } finally {
      setLoading(false)
    }
  }, [])

  const createRule = useCallback(async (data: RuleInput): Promise<TransactionRule> => {
    const row = await api.post<Record<string, unknown>>('/rules', data)
    const rule = mapRule(row)
    setRules((prev) => [...prev, rule].sort((a, b) => a.position - b.position))
    return rule
  }, [])

  const updateRule = useCallback(async (id: string, data: RuleInput): Promise<TransactionRule> => {
    const row = await api.patch<Record<string, unknown>>(`/rules/${id}`, data)
    const rule = mapRule(row)
    setRules((prev) => prev.map((r) => (r.id === id ? rule : r)))
    return rule
  }, [])

  const deleteRule = useCallback(async (id: string): Promise<void> => {
    await api.delete(`/rules/${id}`)
    setRules((prev) => prev.filter((r) => r.id !== id))
  }, [])

  return { rules, loading, loadRules, createRule, updateRule, deleteRule }
}
