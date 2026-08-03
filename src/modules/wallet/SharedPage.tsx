import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { Users, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { SettleUpDialog } from './SettleUpDialog'
import { SplitsSection } from './SplitsSection'
import { ConfirmReceiptDialog } from './ConfirmReceiptDialog'
import { useAppStore } from '@/stores/app.store'
import { api } from '@/lib/api'
import { cn, formatMYR } from '@/lib/utils'
import { mapGroup, mapMember, mapSettlement, mapSplitClaim } from '@/lib/household.mappers'
import type { Group, GroupBalance, GroupMember, Settlement, SplitClaim } from '@/types/household.types'

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
  // Every claim in each direction, kept rather than discarded after the pairing
  // pass: the state bars break the two headline numbers down by where the money
  // has got to, and these are the rows that say. No extra request — the page was
  // already fetching both sides to work out who to render a section for.
  const [claimsIOwe, setClaimsIOwe] = useState<SplitClaim[]>([])
  const [claimsOwedToMe, setClaimsOwedToMe] = useState<SplitClaim[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  // The section's date range travels with the settle target, so the dialog
  // settles the period you were looking at rather than all time.
  const [settleTarget, setSettleTarget] = useState<
    { groupId: string; balance: GroupBalance; range: { dateFrom: string; dateTo: string } } | null
  >(null)
  const [confirmTarget, setConfirmTarget] = useState<Settlement | null>(null)
  const [undoTarget, setUndoTarget] = useState<string | null>(null)
  const [undoError, setUndoError] = useState<string | null>(null)
  // Bumped after any action that changes a claim, to re-run the sections' own
  // fetches. They own their data (each has its own tab and date range); this is
  // how the page tells them the world moved underneath — as a prop, never as
  // part of their key, because remounting would discard that state and bounce
  // the user out of whatever tab they were working in.
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
      // Who I hold claims against, and who holds claims against me. Kept apart
      // rather than merged into one "people" set: once a balance is fully
      // cleared there is nothing left to read a direction from, and defaulting
      // to one made a section fetch the wrong side of itself and render empty.
      // `splits/mine` matches on ts.user_id alone, so an equal or custom split
      // returns the payer's OWN share row alongside real claims — you, owing
      // yourself. Harmless while these arrays only fed a set of counterparty
      // ids (the pairing loop skips itself), but the bars sum them, and a
      // self-row showed up as money to review in the "You owe" direction.
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
          const owedToMe = balances.find(
            (b) => b.toUserId === currentUserId && b.fromUserId === member.userId,
          )
          const iOwe = balances.find(
            (b) => b.fromUserId === currentUserId && b.toUserId === member.userId,
          )
          const balance = owedToMe ?? iOwe ?? null
          const owesMe = peopleWhoOweMe.has(member.userId)
          const iOweThem = peopleIOwe.has(member.userId)
          // A co-member with no balance and no claims has nothing to show.
          if (!balance && !owesMe && !iOweThem) continue
          // No direction is chosen here any more. Picking one — from the netted
          // balance, which is what this used to do — is exactly how the other
          // direction's claims became unreachable. The card renders both and
          // decides which to open on from what is actually waiting.
          nextPairings.push({
            groupId: group.id,
            groupName: group.name,
            counterpartyId: member.userId,
            counterpartyUsername: member.username,
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
      setClaimsIOwe(claimsAgainstMe)
      setClaimsOwedToMe(claimsIHold)
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
  // "Settled up" is a statement about outstanding money, not about whether any
  // sections are on screen. Sections now persist after a balance clears — that
  // is how the settled claims behind it stay reachable — so keying the message
  // off their absence would have hidden it in exactly the case it exists for.
  // Gross, not netted — see the headline card below for why.
  const outstandingOf = (claims: SplitClaim[]) =>
    claims.reduce(
      (sum, c) => (c.state === 'settled' || c.state === 'rejected' ? sum : sum + c.outstanding),
      0,
    )
  const grossOwedToMe = outstandingOf(claimsOwedToMe)
  const grossIOwe = outstandingOf(claimsIOwe)

  // The claim check is not redundant with the balance one: group balances are
  // netted, so two people owing each other the same amount nets to zero on both
  // sides while every one of those claims is still open. Without this the page
  // would congratulate them on being settled up with a review queue full of work.
  const nothingOutstanding =
    totals.owedToMe < 0.005 && totals.iOwe < 0.005
    && grossOwedToMe < 0.005 && grossIOwe < 0.005
  const allSettled = nothingOutstanding && (anyHistory || pairings.length > 0)

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
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-fg">Shared</h2>
          <p className="mt-0.5 text-xs text-fg-subtle">Balances and settlements across your groups</p>
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

      {/* The quick overview: what is coming to you, what is going out, and which
          way you are up overall. Gross both ways rather than netted, so it agrees
          with the person cards below and so a direction can never go missing from
          it — a netted zero once hid a whole pile of claims from this page.

          The per-state breakdown lives inside each person card, where the date
          filter that scopes it also lives. */}
      <div className="flex flex-wrap gap-4 rounded-xl border border-line bg-surface px-5 py-4" data-testid="shared-headline">
        <div className="min-w-[7rem] flex-1">
          <p className="text-xs text-fg-subtle">Owed to you</p>
          <p className="text-lg font-bold text-positive-700" data-testid="headline-owed-to-me">
            {formatMYR(grossOwedToMe)}
          </p>
        </div>
        <div className="min-w-[7rem] flex-1">
          <p className="text-xs text-fg-subtle">You owe</p>
          <p className="text-lg font-bold text-red-700" data-testid="headline-i-owe">
            {formatMYR(grossIOwe)}
          </p>
        </div>
        {/* The rule separates Net from the two gross figures, but only while it
            is beside them — once it wraps to its own line it is a stray mark. */}
        <div className="min-w-[7rem] flex-1 sm:border-l sm:border-line-subtle sm:pl-4">
          <p className="text-xs text-fg-subtle">Net</p>
          <p
            className={cn(
              'text-lg font-bold',
              Math.abs(grossOwedToMe - grossIOwe) < 0.005
                ? 'text-fg-subtle'
                : grossOwedToMe > grossIOwe
                  ? 'text-positive-700'
                  : 'text-red-700',
            )}
            data-testid="headline-net"
          >
            {/* An explicit sign, so "up overall" and "down overall" are legible
                without reading the colour — the same rule the dashboard's Net
                figure follows (B9/C13). */}
            {Math.abs(grossOwedToMe - grossIOwe) < 0.005
              ? formatMYR(0)
              : `${grossOwedToMe > grossIOwe ? '+' : '−'}${formatMYR(Math.abs(grossOwedToMe - grossIOwe))}`}
          </p>
        </div>
      </div>

      {awaitingMyConfirmation.length > 0 && (
        <div className="rounded-xl border border-line bg-surface" data-testid="awaiting-confirmation">
          <div className="border-b border-line-subtle px-5 py-3">
            <h3 className="text-sm font-semibold text-fg">
              Payments to confirm
              <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                {awaitingMyConfirmation.length}
              </span>
            </h3>
            <p className="mt-0.5 text-xs text-fg-subtle">
              Someone says they have paid you. Confirming books it into your account and clears the balance.
            </p>
          </div>
          <ul className="divide-y divide-line-subtle">
            {awaitingMyConfirmation.map((sx) => (
              <li key={sx.id} className="flex items-center gap-3 px-5 py-3" data-testid="awaiting-row">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{sx.fromUsername} paid you</p>
                  {sx.note && <p className="mt-0.5 truncate text-xs text-fg-subtle">{sx.note}</p>}
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

      {allSettled && (
        <p className="py-2 text-center text-sm text-fg-subtle" data-testid="all-settled">
          All settled up! 🎉
        </p>
      )}
      {pairings.length === 0 && !allSettled && (
        <p className="py-2 text-center text-sm text-fg-subtle">
          No splits yet — split your first expense from Transactions
        </p>
      )}

      {pairings.map((p) => (
        <SplitsSection
          key={`${p.groupId}:${p.counterpartyId}`}
          groupId={p.groupId}
          groupName={p.groupName}
          showGroupName={groups.length > 1}
          counterpartyId={p.counterpartyId}
          counterpartyUsername={p.counterpartyUsername}
          currentUserId={currentUserId}
          balance={p.balance}
          revision={revision}
          onSettle={(range) => p.balance && setSettleTarget({ groupId: p.groupId, balance: p.balance, range })}
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
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
              Recent settlements{groups.length > 1 ? ` · ${group.name}` : ''}
            </h4>
            <div className="space-y-2">
              {history.slice(0, 10).map((s) => (
                <div
                  key={s.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm"
                  data-testid="settlement-row"
                >
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {/* break-words for the wrap (usernames have no spaces to
                          wrap at) and min-w-0 to let it happen — a flex item
                          defaults to min-width:auto, so it refuses to shrink
                          below its content and the clip takes the difference. */}
                      <span className="min-w-0 break-words">
                        <span className="font-medium">{s.fromUsername}</span>
                        <span className="mx-1 text-fg-subtle">→</span>
                        <span className="font-medium">{s.toUsername}</span>
                      </span>
                      <span className="font-semibold text-fg">{formatMYR(s.amount)}</span>
                      <SettlementStatus status={s.status} />
                    </div>
                    {/* When it happened. A settlement history with no dates is a
                        list of amounts you have to take on trust — and with the
                        undo window now a week rather than a day, the date is
                        also what says whether Undo is still on the table. */}
                    <p className="mt-0.5 text-xs text-fg-subtle" data-testid="settlement-row-date">
                      {settlementDate(s.settledAt)}
                    </p>
                    {/* The note the payer wrote, and — when the creditor said the
                        money never arrived — their reason. Both were being
                        stored and shown in a dim parenthetical or not at all. */}
                    {s.note && (
                      <p className="mt-1 break-words text-xs italic text-fg-muted" data-testid="settlement-row-note">
                        &ldquo;{s.note}&rdquo;
                      </p>
                    )}
                    {s.status === 'rejected' && s.rejectedReason && (
                      <p className="mt-1 break-words text-xs text-red-600" data-testid="settlement-row-reason">
                        {s.toUsername} rejected this &mdash; &ldquo;{s.rejectedReason}&rdquo;
                      </p>
                    )}
                  </div>
                  {/* C-3: use fromUserId (not fromUser).
                      Hidden once the window has clearly passed rather than
                      offered and refused — a button whose only outcome is a 409
                      is worse than no button. Near the boundary it stays visible
                      and the server has the final say, since only it knows the
                      business-timezone date. */}
                  {s.fromUserId === currentUserId && withinUndoWindow(s.settledAt) && (
                    <Button size="sm" variant="ghost" className="shrink-0" onClick={() => { setUndoError(null); setUndoTarget(s.id) }}>
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
          <p className="text-sm text-fg-muted">Undo this settlement? Balances will be restored.</p>
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
        range={settleTarget?.range}
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

/**
 * `settled_at` as a readable date.
 *
 * SQLite writes it with `datetime('now')` — a space separator, no zone, always
 * UTC. Handing that to parseISO as-is gets it parsed as local time, which slides
 * the date by 8 hours here; making the zone explicit is what keeps a settlement
 * recorded at 07:00 MYT from being shown as the previous day.
 */
function settlementDate(settledAt: string): string {
  if (!settledAt) return ''
  const parsed = new Date(`${settledAt.replace(' ', 'T')}${settledAt.includes('Z') ? '' : 'Z'}`)
  if (Number.isNaN(parsed.getTime())) return settledAt.slice(0, 10)
  return format(parsed, 'dd MMM yyyy, HH:mm')
}

/**
 * Whether Undo is still worth offering, matching the server's window
 * (worker/routes/settlements.ts UNDO_WINDOW_DAYS).
 *
 * Deliberately generous at the edge: this compares instants, the server compares
 * business-timezone calendar dates, and the two disagree by up to a day. Erring
 * towards showing the button means the worst case is a clear 409 rather than a
 * silently missing action on a settlement that was still undoable.
 */
const UNDO_WINDOW_DAYS = 7
function withinUndoWindow(settledAt: string): boolean {
  if (!settledAt) return true
  const parsed = new Date(`${settledAt.replace(' ', 'T')}${settledAt.includes('Z') ? '' : 'Z'}`)
  if (Number.isNaN(parsed.getTime())) return true
  return Date.now() - parsed.getTime() <= (UNDO_WINDOW_DAYS + 1) * 86_400_000
}

function SettlementStatus({ status }: { status: Settlement['status'] }) {
  const style = {
    awaiting_confirmation: { label: 'Awaiting confirmation', cls: 'bg-amber-50 text-amber-700' },
    confirmed: { label: 'Confirmed', cls: 'bg-positive-50 text-positive-700' },
    rejected: { label: 'Rejected', cls: 'bg-red-50 text-red-700' },
  }[status] ?? { label: status, cls: 'bg-surface-hover text-fg-muted' }
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${style.cls}`}
      data-testid="settlement-row-status"
    >
      {style.label}
    </span>
  )
}
