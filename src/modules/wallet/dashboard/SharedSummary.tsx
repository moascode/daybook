import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { cn, formatMYR } from '@/lib/utils'
import { useAppStore } from '@/stores/app.store'
import { useHouseholdStore } from '@/stores/household.store'
import { mapGroup } from '@/lib/household.mappers'
import { DashboardCard } from './DashboardCard'
import type { GroupBalance } from '@/types/household.types'

interface Pairing {
  counterpartyName: string
  amount: number
  iOwe: boolean
  groupName: string
}

const AVATAR_BG = ['bg-alt-bg text-alt-fg', 'bg-info-bg text-info-fg', 'bg-calm-bg text-calm-fg', 'bg-warn-bg text-warn-fg']

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
  const [subtitle, setSubtitle] = useState<string | null>(null)

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
        // Subtitle mirrors the mockup's "Household · N members" — read off the
        // first group, the common case of exactly one household. Unlike
        // `/groups/members` (co-members across all groups, caller excluded),
        // this per-group route includes the caller, so no +1 here.
        api
          .get<unknown[]>(`/groups/${groups[0].id}/members`)
          .then((members) => {
            if (!cancelled) setSubtitle(`${groups[0].name} · ${members.length} members`)
          })
          .catch(() => {})
        const balancesByGroup = await Promise.all(
          groups.map((g) => api.get<GroupBalance[]>(`/groups/${g.id}/balances`).then((rows) => ({ g, rows }))),
        )
        const next: Pairing[] = []
        for (const { g, rows } of balancesByGroup) {
          for (const b of rows) {
            if (Math.abs(b.amount) < MIN_BALANCE) continue
            if (b.fromUserId === userId) {
              next.push({ counterpartyName: b.toUsername, amount: b.amount, iOwe: true, groupName: g.name })
            } else if (b.toUserId === userId) {
              next.push({ counterpartyName: b.fromUsername, amount: b.amount, iOwe: false, groupName: g.name })
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

  const netPosition = pairings.reduce((sum, p) => sum + (p.iOwe ? -p.amount : p.amount), 0)

  return (
    <DashboardCard
      title="Shared"
      subtitle={subtitle ?? undefined}
      action={{ label: 'Settle up', to: '/wallet/shared' }}
      className={cn('flex flex-col', className)}
    >
      <div data-testid="shared-summary" className="flex flex-1 flex-col">
        {pairings.map((p, i) => (
          <div key={p.counterpartyName + p.iOwe} className="prow">
            <div className={`avatar ${AVATAR_BG[i % AVATAR_BG.length]}`}>
              {p.counterpartyName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="pname">
                {p.iOwe ? `You owe ${p.counterpartyName}` : `${p.counterpartyName} owes you`}
              </div>
              <div className="psub">{p.groupName}</div>
            </div>
            <div className="pamt" style={p.iOwe ? undefined : { color: 'rgb(var(--pos-fg))' }}>
              {formatMYR(p.amount)}
            </div>
          </div>
        ))}

        {pendingClaimCount > 0 && (
          <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2.5 text-xs leading-relaxed text-fg">
            {pendingClaimCount} claim{pendingClaimCount === 1 ? '' : 's'} waiting for you to review.
          </p>
        )}

        {pairings.length > 0 && (
          <>
            <div className="divider" style={{ marginTop: 'auto' }} />
            <div className="flex justify-between text-sm">
              <span className="text-fg-subtle">Net position</span>
              <span
                className="tabular-nums font-semibold"
                style={{ color: netPosition >= 0 ? 'rgb(var(--pos-fg))' : undefined }}
              >
                {netPosition >= 0 ? '+' : '−'}
                {formatMYR(Math.abs(netPosition))}
              </span>
            </div>
          </>
        )}
      </div>
    </DashboardCard>
  )
}
