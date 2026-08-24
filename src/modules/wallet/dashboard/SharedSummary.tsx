import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { formatMYR } from '@/lib/utils'
import { useAppStore } from '@/stores/app.store'
import { useHouseholdStore } from '@/stores/household.store'
import { mapGroup } from '@/lib/household.mappers'
import { DashboardCard } from './DashboardCard'
import type { GroupBalance } from '@/types/household.types'

interface Pairing {
  counterpartyName: string
  amount: number
  iOwe: boolean
}

/** Balances below a cent are rounding noise, not a real pairing to show. */
const MIN_BALANCE = 0.005

/**
 * Compact household-balance summary for the dashboard.
 *
 * Self-fetching and prop-free by design — it's an optional feature (most users
 * are not in a group), so this panel decides for itself whether it has
 * anything to show rather than making the orchestrator carry that logic.
 *
 * The review-queue count comes from the store, not a fresh fetch: it's already
 * kept current by the app-wide poll in lib/claim-badge.ts (the same field the
 * sidebar's PendingClaimsBadge reads), and fetching it a second time here would
 * risk it disagreeing with what's shown elsewhere.
 */
export function SharedSummary({ className }: { className?: string }) {
  const userId = useAppStore((s) => s.user?.id ?? '')
  const pendingClaimCount = useHouseholdStore((s) => s.pendingClaimCount)
  const [pairings, setPairings] = useState<Pairing[] | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const groupRows = await api.get<Record<string, unknown>[]>('/groups')
        const groups = groupRows.map(mapGroup)
        if (groups.length === 0) {
          if (!cancelled) setPairings([])
          return
        }
        const balancesByGroup = await Promise.all(
          groups.map((g) => api.get<GroupBalance[]>(`/groups/${g.id}/balances`)),
        )
        const next: Pairing[] = []
        for (const balances of balancesByGroup) {
          for (const b of balances) {
            if (Math.abs(b.amount) < MIN_BALANCE) continue
            if (b.fromUserId === userId) {
              next.push({ counterpartyName: b.toUsername, amount: b.amount, iOwe: true })
            } else if (b.toUserId === userId) {
              next.push({ counterpartyName: b.fromUsername, amount: b.amount, iOwe: false })
            }
          }
        }
        if (!cancelled) setPairings(next)
      } catch {
        // A summary widget, not a critical page — the full detail is one
        // click away on /wallet/shared, which has its own error handling.
        if (!cancelled) setPairings(null)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [userId])

  // Still loading, or nothing to show: no group membership, no outstanding
  // balances and nothing waiting for review.
  if (pairings === null) return null
  if (pairings.length === 0 && pendingClaimCount === 0) return null

  return (
    <DashboardCard title="Shared" action={{ label: 'Shared', to: '/wallet/shared' }} className={className}>
      <div data-testid="shared-summary">
        {pairings.length > 0 && (
          <ul role="list" className="flex flex-col gap-0.5">
            {pairings.map((p) => (
              <li
                key={p.counterpartyName + p.iOwe}
                role="listitem"
                className="flex items-center justify-between gap-3 py-1.5 text-[13px]"
              >
                <span className="text-fg">
                  {p.iOwe ? `You owe ${p.counterpartyName}` : `${p.counterpartyName} owes you`}
                </span>
                <span
                  className={`shrink-0 font-semibold tabular-nums ${p.iOwe ? 'text-fg-muted' : 'text-positive-600'}`}
                >
                  {formatMYR(p.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {pendingClaimCount > 0 && (
          <p
            className={`rounded-lg bg-brand-50 px-3 py-2.5 text-xs leading-relaxed text-fg ${
              pairings.length > 0 ? 'mt-3' : ''
            }`}
          >
            {pendingClaimCount} claim{pendingClaimCount === 1 ? '' : 's'} waiting for you to review.
          </p>
        )}
      </div>
    </DashboardCard>
  )
}
