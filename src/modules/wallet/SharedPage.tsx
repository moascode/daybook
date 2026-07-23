import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Users, Check, ArrowRightLeft, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { SettleUpDialog } from './SettleUpDialog'
import { useAppStore } from '@/stores/app.store'
import { api } from '@/lib/api'
import { formatMYR } from '@/lib/utils'
import { mapGroup, mapSettlement } from '@/lib/household.mappers'
import type { Group, GroupBalance, Settlement } from '@/types/household.types'

interface SettleAccount {
  id: string
  name: string
  isShared?: boolean
  sharedByUsername?: string
}

/**
 * Wallet → Shared (/wallet/shared): the money outcomes of sharing — who owes
 * whom, Settle Up, and settlement history, sectioned per group (balances and
 * settlements are per-group in the data model). Group administration lives in
 * Settings → Sharing.
 */
export function SharedPage() {
  const currentUserId = useAppStore((s) => s.user?.id ?? '')
  const [groups, setGroups] = useState<Group[]>([])
  const [balancesByGroup, setBalancesByGroup] = useState<Record<string, GroupBalance[]>>({})
  const [historyByGroup, setHistoryByGroup] = useState<Record<string, Settlement[]>>({})
  const [accounts, setAccounts] = useState<SettleAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [settleTarget, setSettleTarget] = useState<{ groupId: string; balance: GroupBalance } | null>(null)
  const [undoTarget, setUndoTarget] = useState<string | null>(null)
  const [undoError, setUndoError] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    setLoadError(false)
    try {
      const [groupRows, accountRows] = await Promise.all([
        api.get<Record<string, unknown>[]>('/groups'),
        api.get<SettleAccount[]>('/accounts'),
      ])
      const mapped = groupRows.map(mapGroup)
      const results = await Promise.all(
        mapped.map(async (g) => {
          const [bal, hist] = await Promise.all([
            api.get<GroupBalance[]>(`/groups/${g.id}/balances`),
            api.get<Record<string, unknown>[]>(`/settlements?groupId=${g.id}`),
          ])
          return { id: g.id, balances: bal, history: hist.map(mapSettlement) }
        }),
      )
      setGroups(mapped)
      setAccounts(accountRows)
      setBalancesByGroup(Object.fromEntries(results.map((r) => [r.id, r.balances])))
      setHistoryByGroup(Object.fromEntries(results.map((r) => [r.id, r.history])))
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll]) // eslint-disable-line react-hooks/set-state-in-effect

  const handleUndoSettlement = async (id: string) => {
    setUndoError(null)
    try {
      await api.delete(`/settlements/${id}`)
      await loadAll()
      setUndoTarget(null)
    } catch (err: unknown) {
      setUndoError((err as Error)?.message ?? 'Failed to undo settlement')
    }
  }

  // All-groups headline — purely visual sums of the per-group balances
  const allBalances = Object.values(balancesByGroup).flat()
  const totalOwedToMe = allBalances
    .filter((b) => b.toUserId === currentUserId)
    .reduce((s, b) => s + b.amount, 0)
  const totalIOwe = allBalances
    .filter((b) => b.fromUserId === currentUserId)
    .reduce((s, b) => s + b.amount, 0)
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
      {/* Header + all-groups headline total */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Shared</h2>
          <p className="mt-0.5 text-xs text-gray-500">Balances and settlements across your groups</p>
        </div>
        <Link
          to="/wallet?view=shared-with-me"
          className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
        >
          View split transactions
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      <div className="flex gap-4 rounded-xl border border-gray-200 bg-white px-5 py-4" data-testid="shared-headline">
        <div className="flex-1">
          <p className="text-xs text-gray-500">Owed to you</p>
          <p className="text-lg font-bold text-green-700">{formatMYR(totalOwedToMe)}</p>
        </div>
        <div className="flex-1">
          <p className="text-xs text-gray-500">You owe</p>
          <p className="text-lg font-bold text-orange-700">{formatMYR(totalIOwe)}</p>
        </div>
      </div>

      {allBalances.length === 0 && (
        <p className="text-sm text-gray-500 py-2 text-center">
          {anyHistory
            ? 'All settled up! 🎉'
            : 'No splits yet — split your first expense from Transactions'}
        </p>
      )}

      {/* Per-group sections */}
      {groups.map((group) => {
        const balances = balancesByGroup[group.id] ?? []
        const history = historyByGroup[group.id] ?? []
        const owedToMe = balances.filter((b) => b.toUserId === currentUserId)
        const myDebts = balances.filter((b) => b.fromUserId === currentUserId)
        if (balances.length === 0 && history.length === 0) return null

        return (
          <section key={group.id} className="space-y-4" data-testid="shared-group-section">
            <h3 className="flex items-center gap-2 font-semibold text-gray-900">
              <Users className="h-4 w-4 text-purple-600" />
              {group.name}
            </h3>

            {/* U-1: "Owed to you" section with Mark Received button */}
            {owedToMe.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Owed to you</h4>
                {owedToMe.map((b) => (
                  <div key={`${b.fromUserId}-${b.toUserId}`} className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-4 py-3 mb-2">
                    <div>
                      <span className="font-medium text-gray-900">{b.fromUsername}</span>
                      <span className="text-sm text-gray-500 ml-2">owes you</span>
                      <span className="ml-2 font-semibold text-green-700">{formatMYR(b.amount)}</span>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => setSettleTarget({ groupId: group.id, balance: b })}>
                      <Check className="h-3.5 w-3.5 mr-1" />
                      Mark Received
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {myDebts.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">You owe</h4>
                {myDebts.map((b) => (
                  <div key={`${b.fromUserId}-${b.toUserId}`} className="flex items-center justify-between rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 mb-2">
                    <div>
                      <span className="text-sm text-gray-500">You owe</span>
                      <span className="font-medium text-gray-900 ml-2">{b.toUsername}</span>
                      <span className="ml-2 font-semibold text-orange-700">{formatMYR(b.amount)}</span>
                    </div>
                    <Button size="sm" onClick={() => setSettleTarget({ groupId: group.id, balance: b })}>
                      <ArrowRightLeft className="h-3.5 w-3.5 mr-1" />
                      Settle Up
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Settlement history */}
            {history.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Recent settlements</h4>
                <div className="space-y-2">
                  {history.slice(0, 10).map((s) => (
                    <div key={s.id} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm">
                      <div>
                        <span className="font-medium">{s.fromUsername}</span>
                        <span className="text-gray-500 mx-1">→</span>
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
            )}
          </section>
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

      {/* Settle up dialog */}
      <SettleUpDialog
        groupId={settleTarget?.groupId ?? ''}
        balance={settleTarget?.balance ?? null}
        currentUserId={currentUserId}
        accounts={accounts}
        onClose={() => setSettleTarget(null)}
        onSettled={() => { setSettleTarget(null); loadAll() }}
      />
    </div>
  )
}
