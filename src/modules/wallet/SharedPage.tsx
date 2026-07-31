import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Users, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { SettleUpDialog } from './SettleUpDialog'
import { SplitsSection } from './SplitsSection'
import { ConfirmReceiptDialog } from './ConfirmReceiptDialog'
import { useAppStore } from '@/stores/app.store'
import { api } from '@/lib/api'
import { formatMYR } from '@/lib/utils'
import { mapGroup, mapMember, mapSettlement, mapSplitClaim } from '@/lib/household.mappers'
import type { Group, GroupBalance, GroupMember, Settlement } from '@/types/household.types'

interface SettleAccount {
  id: string
  name: string
  isShared?: boolean
  sharedByUsername?: string
}

/** One rendered section: a person, within a group. */
interface Pairing {
  groupId: string
  groupName: string
  counterpartyId: string
  counterpartyUsername: string
  iAmCreditor: boolean
  balance: GroupBalance | null
}

/**
 * Wallet → Shared (/wallet/shared): everything standing between you and the
 * people you split with — what is owed, what is waiting on whom, and the
 * settlements that cleared it. Group administration lives in Settings → Sharing.
 *
 * Organised person first. A balance is one number standing in for a pile of
 * claims, and the failure this page was rebuilt around was someone being shown
 * that number with no way to reach what it was made of.
 */
export function SharedPage() {
  const currentUserId = useAppStore((s) => s.user?.id ?? '')
  const [groups, setGroups] = useState<Group[]>([])
  const [pairings, setPairings] = useState<Pairing[]>([])
  const [historyByGroup, setHistoryByGroup] = useState<Record<string, Settlement[]>>({})
  const [accounts, setAccounts] = useState<SettleAccount[]>([])
  const [totals, setTotals] = useState({ owedToMe: 0, iOwe: 0 })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [settleTarget, setSettleTarget] = useState<{ groupId: string; balance: GroupBalance } | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<Settlement | null>(null)
  const [undoTarget, setUndoTarget] = useState<string | null>(null)
  const [undoError, setUndoError] = useState<string | null>(null)
  // Bumped after any action that changes a claim, to re-run the sections' own
  // fetches. They own their data (each has its own date range); this is how the
  // page tells them the world moved underneath.
  const [revision, setRevision] = useState(0)

  const loadAll = useCallback(async () => {
    setLoadError(false)
    try {
      const [groupRows, accountRows, mine, theirs] = await Promise.all([
        api.get<Record<string, unknown>[]>('/groups'),
        api.get<SettleAccount[]>('/accounts'),
        // Which people you have any history with, in either direction. Sections
        // are driven by this rather than by balances alone: once a balance is
        // cleared it disappears, and with it the only route back to the settled
        // claims behind it. Two requests for the whole page, not per section.
        api.get<Record<string, unknown>[]>('/transactions/splits/mine?state=pending,approved,awaiting_confirmation,settled,rejected'),
        api.get<Record<string, unknown>[]>('/transactions/splits/mine?role=creditor&state=pending,approved,awaiting_confirmation,settled,rejected'),
      ])
      const mapped = groupRows.map(mapGroup)
      const claimants = new Set([
        ...mine.map(mapSplitClaim).map((c) => c.ownerId),
        ...theirs.map(mapSplitClaim).map((c) => c.debtorId),
      ])

      const perGroup = await Promise.all(
        mapped.map(async (g) => {
          const [bal, hist, members] = await Promise.all([
            api.get<GroupBalance[]>(`/groups/${g.id}/balances`),
            api.get<Record<string, unknown>[]>(`/settlements?groupId=${g.id}`),
            api.get<Record<string, unknown>[]>(`/groups/${g.id}/members`),
          ])
          return { group: g, balances: bal, history: hist.map(mapSettlement), members: members.map(mapMember) }
        }),
      )

      const nextPairings: Pairing[] = []
      for (const { group, balances, members } of perGroup) {
        for (const member of members as GroupMember[]) {
          if (member.userId === currentUserId) continue
          const owedToMe = balances.find(
            (b) => b.toUserId === currentUserId && b.fromUserId === member.userId,
          )
          const iOwe = balances.find(
            (b) => b.fromUserId === currentUserId && b.toUserId === member.userId,
          )
          const balance = owedToMe ?? iOwe ?? null
          // A co-member with no balance and no claims has nothing to show.
          if (!balance && !claimants.has(member.userId)) continue
          nextPairings.push({
            groupId: group.id,
            groupName: group.name,
            counterpartyId: member.userId,
            counterpartyUsername: member.username,
            iAmCreditor: !!owedToMe,
            balance,
          })
        }
      }
      // Largest outstanding first — the thing most worth acting on, at the top.
      nextPairings.sort((a, b) => (b.balance?.amount ?? 0) - (a.balance?.amount ?? 0))

      const allBalances = perGroup.flatMap((p) => p.balances)
      setGroups(mapped)
      setAccounts(accountRows)
      setPairings(nextPairings)
      setHistoryByGroup(Object.fromEntries(perGroup.map((p) => [p.group.id, p.history])))
      setTotals({
        owedToMe: allBalances
          .filter((b) => b.toUserId === currentUserId)
          .reduce((s, b) => s + b.amount, 0),
        iOwe: allBalances
          .filter((b) => b.fromUserId === currentUserId)
          .reduce((s, b) => s + b.amount, 0),
      })
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [currentUserId])

  useEffect(() => { loadAll() }, [loadAll]) // eslint-disable-line react-hooks/set-state-in-effect

  const refresh = useCallback(async () => {
    await loadAll()
    setRevision((r) => r + 1)
  }, [loadAll])

  const handleUndoSettlement = async (id: string) => {
    setUndoError(null)
    try {
      await api.delete(`/settlements/${id}`)
      await refresh()
      setUndoTarget(null)
    } catch (err: unknown) {
      setUndoError((err as Error)?.message ?? 'Failed to undo settlement')
    }
  }

  // Payments claimed by someone else and waiting on me. These are money in my
  // direction that has not landed in my books yet, so they belong at the top —
  // not buried in the settlement history below. Settlement-shaped on purpose:
  // one payment can clear several claims, so the action belongs to the payment.
  const awaitingMyConfirmation = Object.values(historyByGroup)
    .flat()
    .filter((h) => h.status === 'awaiting_confirmation' && h.toUserId === currentUserId)

  const anyHistory = Object.values(historyByGroup).some((h) => h.length > 0)

  if (!currentUserId) return null

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl py-10 text-center">
        <p className="text-sm text-gray-600">Couldn&rsquo;t load your shared balances.</p>
        <Button size="sm" variant="secondary" className="mt-3" onClick={() => { setLoading(true); loadAll() }}>
          Retry
        </Button>
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="mx-auto max-w-2xl py-6">
        <EmptyState
          icon={<Users className="h-10 w-10" />}
          title="No groups yet"
          description="Create a household group in Settings → Sharing to share accounts and split expenses."
          action={
            <Link to="/settings/sharing">
              <Button size="sm">Go to Sharing settings</Button>
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Shared</h2>
          <p className="mt-0.5 text-xs text-gray-500">Balances and settlements across your groups</p>
        </div>
        {/* range=all is not optional decoration: the balances above are
            all-time, but Transactions defaults to the current month. Without it
            a split from an earlier month lands on an empty list, which reads as
            "sharing is broken" rather than "a date filter is active". */}
        <Link
          to="/wallet?view=shared-with-me&range=all"
          className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
        >
          View split transactions
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      <div className="flex gap-4 rounded-xl border border-gray-200 bg-white px-5 py-4" data-testid="shared-headline">
        <div className="flex-1">
          <p className="text-xs text-gray-500">Owed to you</p>
          <p className="text-lg font-bold text-positive-700">{formatMYR(totals.owedToMe)}</p>
        </div>
        <div className="flex-1">
          <p className="text-xs text-gray-500">You owe</p>
          <p className="text-lg font-bold text-red-700">{formatMYR(totals.iOwe)}</p>
        </div>
      </div>

      {awaitingMyConfirmation.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white" data-testid="awaiting-confirmation">
          <div className="border-b border-gray-100 px-5 py-3">
            <h3 className="text-sm font-semibold text-gray-900">
              Payments to confirm
              <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                {awaitingMyConfirmation.length}
              </span>
            </h3>
            <p className="mt-0.5 text-xs text-gray-500">
              Someone says they have paid you. Confirming books it into your account and clears the balance.
            </p>
          </div>
          <ul className="divide-y divide-gray-100">
            {awaitingMyConfirmation.map((sx) => (
              <li key={sx.id} className="flex items-center gap-3 px-5 py-3" data-testid="awaiting-row">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">{sx.fromUsername} paid you</p>
                  {sx.note && <p className="mt-0.5 truncate text-xs text-gray-500">{sx.note}</p>}
                </div>
                <span className="text-sm font-semibold text-positive-700">{formatMYR(sx.amount)}</span>
                <Button size="sm" onClick={() => setConfirmTarget(sx)} data-testid="open-confirm">
                  Review
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pairings.length === 0 && (
        <p className="py-2 text-center text-sm text-gray-500">
          {anyHistory
            ? 'All settled up! 🎉'
            : 'No splits yet — split your first expense from Transactions'}
        </p>
      )}

      {pairings.map((p) => (
        <SplitsSection
          key={`${p.groupId}:${p.counterpartyId}:${revision}`}
          groupId={p.groupId}
          groupName={p.groupName}
          showGroupName={groups.length > 1}
          counterpartyId={p.counterpartyId}
          counterpartyUsername={p.counterpartyUsername}
          iAmCreditor={p.iAmCreditor}
          balance={p.balance}
          onSettle={() => p.balance && setSettleTarget({ groupId: p.groupId, balance: p.balance })}
          onChanged={refresh}
        />
      ))}

      {/* Settlement history, per group. Settlement-shaped, like the confirm
          block above: one row is one payment, whatever it cleared. */}
      {groups.map((group) => {
        const history = historyByGroup[group.id] ?? []
        if (history.length === 0) return null
        return (
          <div key={group.id} data-testid="settlement-history">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Recent settlements{groups.length > 1 ? ` · ${group.name}` : ''}
            </h4>
            <div className="space-y-2">
              {history.slice(0, 10).map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm">
                  <div>
                    <span className="font-medium">{s.fromUsername}</span>
                    <span className="mx-1 text-gray-500">→</span>
                    <span className="font-medium">{s.toUsername}</span>
                    <span className="ml-2 text-gray-700">{formatMYR(s.amount)}</span>
                    {s.note && <span className="ml-2 text-gray-400">({s.note})</span>}
                  </div>
                  {/* C-3: use fromUserId (not fromUser) */}
                  {s.fromUserId === currentUserId && (
                    <Button size="sm" variant="ghost" onClick={() => { setUndoError(null); setUndoTarget(s.id) }}>
                      Undo
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {/* U-10: Undo settlement confirmation modal */}
      <Modal open={!!undoTarget} onOpenChange={() => setUndoTarget(null)} title="Undo Settlement?">
        <div className="space-y-4">
          <p className="text-sm text-gray-700">Undo this settlement? Balances will be restored.</p>
          {undoError && <p className="text-sm text-red-600">{undoError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setUndoTarget(null)}>Cancel</Button>
            <Button onClick={() => undoTarget && handleUndoSettlement(undoTarget)}>
              Confirm Undo
            </Button>
          </div>
        </div>
      </Modal>

      <SettleUpDialog
        groupId={settleTarget?.groupId ?? ''}
        balance={settleTarget?.balance ?? null}
        currentUserId={currentUserId}
        accounts={accounts}
        onClose={() => setSettleTarget(null)}
        onSettled={() => { setSettleTarget(null); refresh() }}
      />

      <ConfirmReceiptDialog
        settlement={confirmTarget}
        accounts={accounts}
        onClose={() => setConfirmTarget(null)}
        onDone={() => { setConfirmTarget(null); refresh() }}
      />
    </div>
  )
}
