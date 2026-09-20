import { useCallback, useMemo, useState } from 'react'
import { useWallet } from '@/hooks/useWallet'
import { formatMYR, todayISO } from '@/lib/utils'

// FEAT-032 (docs/backlog/EP-07-tasks-depth/FEAT-032-tasks-wallet-chips.md).
// Reuses the same Wallet data every Wallet page already fetches through
// useWallet()/useWalletStore — no separate cache invented, and multiple
// BulletNode instances calling `ensureLoaded` only pay for one fetch each,
// since useWallet's loaders overwrite the shared store rather than append.

function daysUntil(dateIso: string): number {
  const [y1, m1, d1] = todayISO().split('-').map(Number)
  const [y2, m2, d2] = dateIso.split('-').map(Number)
  const ms = Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)
  return Math.round(ms / 86_400_000)
}

function dueLabel(dateIso: string): string {
  const days = daysUntil(dateIso)
  if (days < 0) return 'overdue'
  if (days === 0) return 'due today'
  if (days === 1) return 'due tomorrow'
  return `due in ${days} days`
}

export interface WalletRefOption {
  ref: string
  label: string
}

export function useWalletRefChips() {
  const { recurringTransactions, goals, loadRecurringTransactions, loadGoals, getAccountBalances } = useWallet()
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [loaded, setLoaded] = useState(false)

  const ensureLoaded = useCallback(async () => {
    if (loaded) return
    const [, , bal] = await Promise.all([loadRecurringTransactions(), loadGoals(), getAccountBalances()])
    setBalances(bal)
    setLoaded(true)
  }, [loaded, loadRecurringTransactions, loadGoals, getAccountBalances])

  /** Resolve a task's `walletRef` into the chip's display text, or null if unresolvable (e.g. not loaded yet, or the linked object was deleted). */
  const resolveChip = useCallback(
    (walletRef: string | null): string | null => {
      if (!walletRef) return null
      const [kind, id] = walletRef.split(':')
      if (kind === 'recurring') {
        const rt = recurringTransactions.find((r) => r.id === id)
        if (!rt) return null
        return `Wallet · ${formatMYR(rt.amount)} ${dueLabel(rt.nextDueDate)}`
      }
      if (kind === 'goal') {
        const goal = goals.find((g) => g.id === id)
        if (!goal) return null
        const balance = balances[goal.accountId] ?? 0
        const saved = Math.max(0, Math.min(balance, goal.targetAmount))
        const percent = goal.targetAmount > 0 ? Math.round((saved / goal.targetAmount) * 100) : 0
        return `Wallet goal · ${percent}% funded`
      }
      return null
    },
    [recurringTransactions, goals, balances],
  )

  /** Options for the "Link to Wallet…" picker. */
  const options = useMemo<WalletRefOption[]>(
    () => [
      ...recurringTransactions.map((r) => ({
        ref: `recurring:${r.id}`,
        label: `Bill: ${r.merchant || 'Untitled'} · ${formatMYR(r.amount)}/${r.frequency}`,
      })),
      ...goals.map((g) => ({ ref: `goal:${g.id}`, label: `Goal: ${g.name}` })),
    ],
    [recurringTransactions, goals],
  )

  return { ensureLoaded, resolveChip, options, loaded }
}
