import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { Users, ExternalLink, Check, Bell } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { Tooltip } from '@/components/ui/Tooltip'
import { SettleUpDialog } from './SettleUpDialog'
import { ConfirmReceiptDialog } from './ConfirmReceiptDialog'
import { SharedBalances, type Pairing } from './shared/SharedBalances'
import { SharedActivity } from './shared/SharedActivity'
import { MarkAllSettledDialog } from './shared/MarkAllSettledDialog'
import { useAppStore } from '@/stores/app.store'
import { useWallet } from '@/hooks/useWallet'
import { useToastStore } from '@/stores/toast.store'
import { api } from '@/lib/api'
import { cn, errorMessage, formatMYR } from '@/lib/utils'
import { mapGroup, mapMember, mapSettlement, mapSplitClaim } from '@/lib/household.mappers'
import type { Group, GroupBalance, GroupMember, Settlement, SplitClaim } from '@/types/household.types'
import type { TransactionFormData } from './TransactionForm'

/**
 * Wallet → Shared (/wallet/shared): everything standing between you and the
 * people you split with — what is owed, what is waiting on whom, and the
 * settlements that cleared it. Group administration lives in Settings → Sharing.
 *
 * Rebuilt against proposal-v2/shared.html: Balances and Settle-up merged into
 * one summary card with an inline, settlement-aware action per person (owner
 * direction — the mockup's two cards duplicated the same people). Shared
 * activity is the literal mockup list (filterable by member/status), sourced
 * from claim data rather than the transaction-level view the mockup shows,
 * since the schema has no split "method" (equal/by-income/etc.) to display —
 * see SharedActivity's doc comment.
 */
export function SharedPage() {
  const currentUserId = useAppStore((s) => s.user?.id ?? '')
  const { addToast } = useToastStore()
  const { loadAccounts, loadCategories, accounts, categories, updateTransaction } = useWallet()
  const [groups, setGroups] = useState<Group[]>([])
  const [pairings, setPairings] = useState<Pairing[]>([])
  const [historyByGroup, setHistoryByGroup] = useState<Record<string, Settlement[]>>({})
  const [memberCountByGroup, setMemberCountByGroup] = useState<Record<string, number>>({})
  const [totals, setTotals] = useState({ owedToMe: 0, iOwe: 0 })
  const [claimsIOwe, setClaimsIOwe] = useState<SplitClaim[]>([])
  const [claimsOwedToMe, setClaimsOwedToMe] = useState<SplitClaim[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [settleTarget, setSettleTarget] = useState<
    { groupId: string; balance: GroupBalance; range: { dateFrom: string; dateTo: string } } | null
  >(null)
  const [confirmTarget, setConfirmTarget] = useState<Settlement | null>(null)
  const [undoTarget, setUndoTarget] = useState<string | null>(null)
  const [undoError, setUndoError] = useState<string | null>(null)
  const [markAllOpen, setMarkAllOpen] = useState(false)

  useEffect(() => { loadAccounts(); loadCategories() }, [loadAccounts, loadCategories])

  const loadAll = useCallback(async () => {
    setLoadError(false)
    try {
      const [groupRows, mine, theirs] = await Promise.all([
        api.get<Record<string, unknown>[]>('/groups'),
        api.get<Record<string, unknown>[]>('/transactions/splits/mine?state=pending,approved,awaiting_confirmation,settled,rejected'),
        api.get<Record<string, unknown>[]>('/transactions/splits/mine?role=creditor&state=pending,approved,awaiting_confirmation,settled,rejected'),
      ])
      const mapped = groupRows.map(mapGroup)
      const claimsAgainstMe = mine.map(mapSplitClaim).filter((c) => c.ownerId !== c.debtorId)
      const claimsIHold = theirs.map(mapSplitClaim)
      const peopleWhoOweMe = new Set(claimsIHold.map((c) => c.debtorId))
      const peopleIOwe = new Set(claimsAgainstMe.map((c) => c.ownerId))

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
          const owedToMe = balances.find((b) => b.toUserId === currentUserId && b.fromUserId === member.userId)
          const iOwe = balances.find((b) => b.fromUserId === currentUserId && b.toUserId === member.userId)
          const balance = owedToMe ?? iOwe ?? null
          const owesMe = peopleWhoOweMe.has(member.userId)
          const iOweThem = peopleIOwe.has(member.userId)
          if (!balance && !owesMe && !iOweThem) continue
          nextPairings.push({
            groupId: group.id,
            groupName: group.name,
            counterpartyId: member.userId,
            counterpartyUsername: member.username,
            balance,
          })
        }
      }
      nextPairings.sort((a, b) => (b.balance?.amount ?? 0) - (a.balance?.amount ?? 0))

      const allBalances = perGroup.flatMap((p) => p.balances)
      setGroups(mapped)
      setPairings(nextPairings)
      setClaimsIOwe(claimsAgainstMe)
      setClaimsOwedToMe(claimsIHold)
      setHistoryByGroup(Object.fromEntries(perGroup.map((p) => [p.group.id, p.history])))
      setMemberCountByGroup(Object.fromEntries(perGroup.map((p) => [p.group.id, p.members.length])))
      setTotals({
        owedToMe: allBalances.filter((b) => b.toUserId === currentUserId).reduce((s, b) => s + b.amount, 0),
        iOwe: allBalances.filter((b) => b.fromUserId === currentUserId).reduce((s, b) => s + b.amount, 0),
      })
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [currentUserId])

  useEffect(() => { loadAll() }, [loadAll]) // eslint-disable-line react-hooks/set-state-in-effect

  const handleUpdateTransaction = useCallback(async (id: string, data: TransactionFormData) => {
    try {
      const updated = await updateTransaction(id, data)
      await loadAll()
      return updated
    } catch (err: unknown) {
      addToast({ message: errorMessage(err, 'Could not save changes — please try again.'), duration: 4000 })
      throw err
    }
  }, [updateTransaction, loadAll, addToast])

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

  const allHistory = Object.values(historyByGroup).flat()
  const awaitingMyConfirmation = allHistory.filter((h) => h.status === 'awaiting_confirmation' && h.toUserId === currentUserId)

  const anyHistory = allHistory.length > 0
  const outstandingOf = (claims: SplitClaim[]) =>
    claims.reduce((sum, c) => (c.state === 'settled' || c.state === 'rejected' ? sum : sum + c.outstanding), 0)
  const grossOwedToMe = outstandingOf(claimsOwedToMe)
  const grossIOwe = outstandingOf(claimsIOwe)
  const nothingOutstanding =
    totals.owedToMe < 0.005 && totals.iOwe < 0.005 && grossOwedToMe < 0.005 && grossIOwe < 0.005
  const allSettled = nothingOutstanding && (anyHistory || pairings.length > 0)

  // How many distinct transactions each counterparty appears on, for the
  // Balances row subtitle — derived from claims already fetched above rather
  // than a per-person request.
  const txnsByCounterparty = new Map<string, Set<string>>()
  for (const c of [...claimsIOwe, ...claimsOwedToMe]) {
    const counterpartyId = c.ownerId === currentUserId ? c.debtorId : c.ownerId
    const set = txnsByCounterparty.get(counterpartyId) ?? new Set<string>()
    set.add(c.transactionId)
    txnsByCounterparty.set(counterpartyId, set)
  }
  const countByCounterparty: Record<string, number> = Object.fromEntries(
    [...txnsByCounterparty.entries()].map(([id, set]) => [id, set.size]),
  )

  // Most recent awaiting_confirmation settlement per counterparty, either
  // direction — drives which action a Balances row shows (see SharedBalances).
  const pendingSettlementByCounterparty: Record<string, Settlement> = {}
  for (const s of allHistory) {
    if (s.status !== 'awaiting_confirmation') continue
    if (s.fromUserId !== currentUserId && s.toUserId !== currentUserId) continue
    const otherId = s.fromUserId === currentUserId ? s.toUserId : s.fromUserId
    pendingSettlementByCounterparty[otherId] = s
  }

  const settleablePairings = pairings.filter((p): p is Pairing & { balance: GroupBalance } => !!p.balance && p.balance.amount > 0.005 && !pendingSettlementByCounterparty[p.counterpartyId])

  // SettleUpDialog/ConfirmReceiptDialog's SettleAccount type predates useWallet's
  // typed Account (sharedByUsername: string | null) — normalize null to undefined
  // rather than widen those shared dialogs' prop type for this one caller.
  const settleAccounts = accounts.map((a) => ({ ...a, sharedByUsername: a.sharedByUsername ?? undefined }))

  const groupSubtitle =
    groups.length === 0
      ? ''
      : groups.length === 1
        ? `${groups[0].name} · ${memberCountByGroup[groups[0].id] ?? 0} members`
        : `${groups.length} groups`

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
        <p className="text-sm text-fg-muted">Couldn&rsquo;t load your shared balances.</p>
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
    <div className="mx-auto max-w-5xl">
      <div className="page-head">
        <h1 className="page-title">Shared</h1>
        <span className="page-sub hide-mobile">{groupSubtitle}</span>
        <div className="page-actions">
          <Link
            to="/wallet?view=shared-with-me&range=all"
            className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
          >
            View split transactions
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </div>

      <div className="dash">
        <div className="card card-pad c12 flex flex-wrap gap-4" data-testid="shared-headline">
          <div className="min-w-[7rem] flex-1">
            <p className="text-xs text-fg-subtle">Owed to you</p>
            <p className="text-lg font-bold text-positive-700" data-testid="headline-owed-to-me">{formatMYR(grossOwedToMe)}</p>
          </div>
          <div className="min-w-[7rem] flex-1">
            <p className="text-xs text-fg-subtle">You owe</p>
            <p className="text-lg font-bold text-red-700" data-testid="headline-i-owe">{formatMYR(grossIOwe)}</p>
          </div>
          <div className="min-w-[7rem] flex-1 sm:border-l sm:border-line-subtle sm:pl-4">
            <p className="text-xs text-fg-subtle">Net</p>
            <p
              className={cn(
                'text-lg font-bold',
                Math.abs(grossOwedToMe - grossIOwe) < 0.005 ? 'text-fg-subtle' : grossOwedToMe > grossIOwe ? 'text-positive-700' : 'text-red-700',
              )}
              data-testid="headline-net"
            >
              {Math.abs(grossOwedToMe - grossIOwe) < 0.005
                ? formatMYR(0)
                : `${grossOwedToMe > grossIOwe ? '+' : '−'}${formatMYR(Math.abs(grossOwedToMe - grossIOwe))}`}
            </p>
          </div>
        </div>

        {/* A notice, not a second Balances — the row-level detail (who, how
            much, the Review action) already lives on that person's Balances
            row below. Showing both was the same payment twice on one page. */}
        {awaitingMyConfirmation.length > 0 && (
          <div
            className="c12 flex items-center gap-2 rounded-lg bg-warn-bg px-4 py-2.5 text-sm text-warn-fg"
            data-testid="awaiting-confirmation"
          >
            <Bell className="h-4 w-4 shrink-0" />
            <span>
              {awaitingMyConfirmation.length} payment{awaitingMyConfirmation.length === 1 ? '' : 's'} waiting for your confirmation
              {' — '}see Balances below.
            </span>
            <a
              href="#shared-balances"
              className="ml-auto shrink-0 font-medium underline underline-offset-2 hover:no-underline"
              onClick={(e) => { e.preventDefault(); document.getElementById('shared-balances')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
            >
              Review
            </a>
          </div>
        )}

        {allSettled && (
          <p className="c12 py-2 text-center text-sm text-fg-subtle" data-testid="all-settled">All settled up! 🎉</p>
        )}
        {pairings.length === 0 && !allSettled && (
          <p className="c12 py-2 text-center text-sm text-fg-subtle">No splits yet — split an expense from Transactions</p>
        )}

        <SharedBalances
          pairings={pairings}
          countByCounterparty={countByCounterparty}
          pendingSettlementByCounterparty={pendingSettlementByCounterparty}
          currentUserId={currentUserId}
          onSettleOne={(p) => p.balance && setSettleTarget({ groupId: p.groupId, balance: p.balance, range: { dateFrom: '', dateTo: '' } })}
          onReviewPayment={(s) => setConfirmTarget(s)}
          onMarkAll={() => setMarkAllOpen(true)}
        />

        {pairings.length > 0 && (
          <SharedActivity
            claimsIOwe={claimsIOwe}
            claimsOwedToMe={claimsOwedToMe}
            currentUserId={currentUserId}
            accounts={accounts}
            categories={categories}
            onUpdateTransaction={handleUpdateTransaction}
            onChanged={loadAll}
          />
        )}

        <section className="card card-pad c6" data-testid="split-rules">
          <div className="card-head">
            <div>
              <div className="card-title">Split rules</div>
              <div className="card-sub">Applied automatically when a transaction is marked shared</div>
            </div>
            <Tooltip label="Split rules aren't configurable yet">
              <span style={{ marginLeft: 'auto' }}>
                <Button variant="secondary" size="sm" disabled>Edit</Button>
              </span>
            </Tooltip>
          </div>
          <div className="kv"><span className="k">Rent &amp; utilities</span><span className="v">By income · 45 / 35 / 20</span></div>
          <div className="kv"><span className="k">Groceries</span><span className="v">Equal split</span></div>
          <div className="kv"><span className="k">Subscriptions</span><span className="v">Equal split</span></div>
          <div className="kv"><span className="k">Everything else</span><span className="v">Not shared</span></div>
          <div className="divider" style={{ marginTop: 'auto' }} />
          <div style={{ fontSize: 'var(--t-sm)', color: 'rgb(var(--fg-subtle))' }}>Not configurable yet — every split is set per transaction.</div>
        </section>

        {groups.map((group) => {
          const history = historyByGroup[group.id] ?? []
          if (history.length === 0) return null
          return (
            <section key={group.id} className="card card-pad c6" data-testid="settlement-history">
              <div className="card-head">
                <div className="card-title">Recent settlements{groups.length > 1 ? ` · ${group.name}` : ''}</div>
              </div>
              {history.slice(0, 10).map((s) => (
                <div className="prow" key={s.id} data-testid="settlement-row">
                  <div className="tavatar" style={{ background: 'rgb(var(--pos-bg))', color: 'rgb(var(--pos-fg))' }}>
                    <Check className="icon-sm" />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="pname" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.375rem' }}>
                      <span>{s.fromUsername} paid {s.toUsername}</span>
                      <SettlementStatus status={s.status} />
                    </div>
                    <div className="psub">
                      <span data-testid="settlement-row-date">{settlementDate(s.settledAt)}</span>
                      {s.note && <span data-testid="settlement-row-note"> · {s.note}</span>}
                    </div>
                    {s.status === 'rejected' && s.rejectedReason && (
                      <p className="mt-1 break-words text-xs text-red-600" data-testid="settlement-row-reason">
                        {s.toUsername} rejected this &mdash; &ldquo;{s.rejectedReason}&rdquo;
                      </p>
                    )}
                  </div>
                  <div className="pamt">{formatMYR(s.amount)}</div>
                  {s.fromUserId === currentUserId && withinUndoWindow(s.settledAt) && (
                    <Button size="sm" variant="ghost" onClick={() => { setUndoError(null); setUndoTarget(s.id) }}>Undo</Button>
                  )}
                </div>
              ))}
            </section>
          )
        })}
      </div>

      <Modal open={!!undoTarget} onOpenChange={() => setUndoTarget(null)} title="Undo Settlement?">
        <div className="space-y-4">
          <p className="text-sm text-fg-muted">Undo this settlement? Balances will be restored.</p>
          {undoError && <p className="text-sm text-red-600">{undoError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setUndoTarget(null)}>Cancel</Button>
            <Button onClick={() => undoTarget && handleUndoSettlement(undoTarget)}>Confirm Undo</Button>
          </div>
        </div>
      </Modal>

      <SettleUpDialog
        groupId={settleTarget?.groupId ?? ''}
        balance={settleTarget?.balance ?? null}
        range={settleTarget?.range}
        currentUserId={currentUserId}
        accounts={settleAccounts}
        onClose={() => setSettleTarget(null)}
        onSettled={() => { setSettleTarget(null); loadAll() }}
      />

      <ConfirmReceiptDialog
        settlement={confirmTarget}
        accounts={settleAccounts}
        onClose={() => setConfirmTarget(null)}
        onDone={() => { setConfirmTarget(null); loadAll() }}
      />

      <MarkAllSettledDialog
        open={markAllOpen}
        pairings={settleablePairings}
        currentUserId={currentUserId}
        accounts={accounts}
        onClose={() => setMarkAllOpen(false)}
        onDone={() => { setMarkAllOpen(false); loadAll(); addToast({ message: 'Payments recorded', duration: 4000 }) }}
      />
    </div>
  )
}

function settlementDate(settledAt: string): string {
  if (!settledAt) return ''
  const parsed = new Date(`${settledAt.replace(' ', 'T')}${settledAt.includes('Z') ? '' : 'Z'}`)
  if (Number.isNaN(parsed.getTime())) return settledAt.slice(0, 10)
  return format(parsed, 'dd MMM yyyy, HH:mm')
}

const UNDO_WINDOW_DAYS = 7
function withinUndoWindow(settledAt: string): boolean {
  if (!settledAt) return true
  const parsed = new Date(`${settledAt.replace(' ', 'T')}${settledAt.includes('Z') ? '' : 'Z'}`)
  if (Number.isNaN(parsed.getTime())) return true
  return Date.now() - parsed.getTime() <= (UNDO_WINDOW_DAYS + 1) * 86_400_000
}

function SettlementStatus({ status }: { status: Settlement['status'] }) {
  const style = {
    awaiting_confirmation: { label: 'Awaiting confirmation', cls: 'bg-warn-bg text-warn-fg' },
    confirmed: { label: 'Confirmed', cls: 'bg-positive-50 text-positive-700' },
    rejected: { label: 'Rejected', cls: 'bg-red-50 text-red-700' },
  }[status] ?? { label: status, cls: 'bg-surface-hover text-fg-muted' }
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${style.cls}`} data-testid="settlement-row-status">
      {style.label}
    </span>
  )
}
