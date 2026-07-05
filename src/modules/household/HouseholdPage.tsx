import { useState, useEffect, useCallback } from 'react'
import {
  Users, Plus, Trash2, UserMinus, Crown, UserPlus, Check, X, ChevronDown, ChevronUp, ArrowRightLeft
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { InviteDialog } from './InviteDialog'
import { useHouseholdStore } from '@/stores/household.store'
import { api } from '@/lib/api'
import { formatMYR } from '@/lib/utils'
import type { Group, GroupDetail, GroupInvite, GroupBalance, Settlement } from '@/types/household.types'
import { mapGroup, mapGroupDetail, mapInvite, mapSettlement } from '@/lib/household.mappers'

// ── Balances tab ──────────────────────────────────────

function BalancesTab({ group, currentUserId }: { group: GroupDetail; currentUserId: string }) {
  const [balances, setBalances] = useState<GroupBalance[]>([])
  const [history, setHistory] = useState<Settlement[]>([])
  const [settleTarget, setSettleTarget] = useState<GroupBalance | null>(null)
  const [accounts, setAccounts] = useState<{ id: string; name: string; isShared?: boolean; sharedByUsername?: string }[]>([])
  const [settleForm, setSettleForm] = useState({ fromAccountId: '', toAccountId: '', amount: '', note: '', originalTransactionId: '' })
  const [settling, setSettling] = useState(false)
  const [settleError, setSettleError] = useState<string | null>(null)
  const [undoTarget, setUndoTarget] = useState<string | null>(null)
  const [undoError, setUndoError] = useState<string | null>(null)

  const load = useCallback(async () => {
    let cancelled = false
    const doLoad = async () => {
      const [bal, hist, accts] = await Promise.all([
        api.get<GroupBalance[]>(`/groups/${group.id}/balances`),
        api.get<Record<string, unknown>[]>(`/settlements?groupId=${group.id}`),
        api.get<{ id: string; name: string; isShared?: boolean; sharedByUsername?: string }[]>('/accounts'),
      ])
      if (!cancelled) {
        setBalances(bal)
        setHistory(hist.map(mapSettlement))
        setAccounts(accts)
      }
    }
    doLoad()
    return () => { cancelled = true }
  }, [group.id])

  useEffect(() => {
    const cancel = load()
    return () => { cancel.then((fn) => fn?.()) }
  }, [load])

  // B-13: only own accounts (not shared-in)
  const myAccounts = accounts.filter((a) => !a.isShared)

  const openSettle = (b: GroupBalance) => {
    setSettleTarget(b)
    setSettleError(null)
    setSettleForm({ fromAccountId: '', toAccountId: '', amount: String(Math.round(b.amount * 100) / 100), note: '', originalTransactionId: '' })
  }

  const handleSettle = async () => {
    if (!settleTarget) return
    setSettling(true)
    setSettleError(null)
    try {
      await api.post('/settlements', {
        groupId: group.id,
        toUserId: settleTarget.toUserId,
        amount: Number(settleForm.amount),
        note: settleForm.note,
        fromAccountId: settleForm.fromAccountId,
        toAccountId: settleForm.toAccountId || undefined,
      })
      setSettleTarget(null)
      await load()
    } catch (err: unknown) {
      setSettleError((err as Error)?.message ?? 'Failed to record settlement')
    } finally {
      setSettling(false)
    }
  }

  const handleUndoSettlement = async (id: string) => {
    setUndoError(null)
    try {
      await api.delete(`/settlements/${id}`)
      await load()
    } catch (err: unknown) {
      setUndoError((err as Error)?.message ?? 'Failed to undo settlement')
    } finally {
      setUndoTarget(null)
    }
  }

  const myDebts = balances.filter((b) => b.fromUserId === currentUserId)
  const owedToMe = balances.filter((b) => b.toUserId === currentUserId)

  // U-11: differentiate empty states
  const emptyMessage = history.length > 0
    ? 'All settled up! 🎉'
    : 'No splits yet — split your first expense from the Wallet tab'

  return (
    <div className="space-y-6">
      {balances.length === 0 ? (
        <p className="text-sm text-gray-500 py-4 text-center">{emptyMessage}</p>
      ) : (
        <div className="space-y-4">
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
                  <Button size="sm" variant="secondary" onClick={() => openSettle(b)}>
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
                  <Button size="sm" onClick={() => openSettle(b)}>
                    <ArrowRightLeft className="h-3.5 w-3.5 mr-1" />
                    Settle Up
                  </Button>
                </div>
              ))}
            </div>
          )}
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
                  <Button size="sm" variant="ghost" onClick={() => setUndoTarget(s.id)}>
                    Undo
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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
      {settleTarget && (
        <Modal open={!!settleTarget} onOpenChange={() => setSettleTarget(null)} title="Settle Up">
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              {settleTarget.toUserId === currentUserId
                ? <>Recording receipt from <strong>{settleTarget.fromUsername}</strong></>
                : <>Recording payment to <strong>{settleTarget.toUsername}</strong></>
              }
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Amount</label>
              <Input
                type="number"
                step="0.01"
                value={settleForm.amount}
                onChange={(e) => setSettleForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">From account (your side)</label>
              <select
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                value={settleForm.fromAccountId}
                onChange={(e) => setSettleForm((f) => ({ ...f, fromAccountId: e.target.value }))}
              >
                <option value="">— select account —</option>
                {myAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            {/* U-4: their account — show shared accounts from counterparty if any */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">To account (their side — optional)</label>
              {(() => {
                const targetUsername = settleTarget.toUserId === currentUserId
                  ? settleTarget.fromUsername
                  : settleTarget.toUsername
                const theirAccounts = accounts.filter(
                  (a) => a.isShared && a.sharedByUsername === targetUsername
                )
                if (theirAccounts.length === 0) {
                  return <p className="text-xs text-gray-400">No shared accounts available from {targetUsername}.</p>
                }
                return (
                  <select
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    value={settleForm.toAccountId}
                    onChange={(e) => setSettleForm((f) => ({ ...f, toAccountId: e.target.value }))}
                  >
                    <option value="">— leave blank (records payer side only) —</option>
                    {theirAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                )
              })()}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Note (optional)</label>
              <Input
                placeholder="e.g. cash settlement"
                value={settleForm.note}
                onChange={(e) => setSettleForm((f) => ({ ...f, note: e.target.value }))}
              />
            </div>
            {settleError && <p className="text-sm text-red-600">{settleError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setSettleTarget(null)}>Cancel</Button>
              <Button
                onClick={handleSettle}
                disabled={settling || !settleForm.fromAccountId || !settleForm.amount}
              >
                {settling ? 'Recording…' : 'Record Settlement'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Members tab ───────────────────────────────────────

function MembersTab({
  group,
  currentUserId,
  onRefresh,
}: {
  group: GroupDetail
  currentUserId: string
  onRefresh: () => void
}) {
  const [inviteOpen, setInviteOpen] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  const handleRemove = async (memberId: string) => {
    setRemoving(memberId)
    try {
      await api.delete(`/groups/${group.id}/members/${memberId}`)
      onRefresh()
    } finally {
      setRemoving(null)
    }
  }

  const isOwner = group.role === 'owner'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">{group.members.length} member{group.members.length !== 1 ? 's' : ''}</span>
        <Button size="sm" onClick={() => setInviteOpen(true)}>
          <UserPlus className="h-3.5 w-3.5 mr-1" />
          Invite
        </Button>
      </div>

      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
        {group.members.map((m) => (
          <li key={m.userId} className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
                {m.username[0].toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{m.username}</p>
                <p className="text-xs text-gray-500 flex items-center gap-1">
                  {m.role === 'owner' && <Crown className="h-3 w-3 text-yellow-500" />}
                  {m.role}
                </p>
              </div>
            </div>
            {(isOwner && m.userId !== currentUserId) || m.userId === currentUserId ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleRemove(m.userId)}
                disabled={removing === m.userId}
                aria-label={m.userId === currentUserId ? 'Leave group' : 'Remove member'}
              >
                <UserMinus className="h-3.5 w-3.5 text-red-500" />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        groupId={group.id}
        groupName={group.name}
        onInvited={onRefresh}
      />
    </div>
  )
}

// ── Group card ────────────────────────────────────────

function GroupCard({
  group,
  currentUserId,
  onDelete,
  onRefresh,
}: {
  group: Group
  currentUserId: string
  onDelete: (id: string) => void
  onRefresh: () => void
}) {
  const [detail, setDetail] = useState<GroupDetail | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState<'members' | 'balances'>('members')
  const [loading, setLoading] = useState(false)
  // U-8: show balance summary on card surface
  const [balanceSummary, setBalanceSummary] = useState<string | null>(null)

  const loadDetail = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api.get<Record<string, unknown>>(`/groups/${group.id}`)
      setDetail(mapGroupDetail(d))
    } finally {
      setLoading(false)
    }
  }, [group.id])

  // U-8: load balance summary when card mounts
  useEffect(() => {
    let cancelled = false
    api.get<{ fromUserId: string; toUserId: string; amount: number }[]>(`/groups/${group.id}/balances`)
      .then((bal) => {
        if (cancelled) return
        if (bal.length === 0) {
          setBalanceSummary(null)
        } else {
          const myDebt = bal.filter((b) => b.fromUserId === currentUserId)
          const myCredit = bal.filter((b) => b.toUserId === currentUserId)
          if (myDebt.length > 0) {
            const total = myDebt.reduce((s, b) => s + b.amount, 0)
            setBalanceSummary(`You owe ${formatMYR(total)}`)
          } else if (myCredit.length > 0) {
            const total = myCredit.reduce((s, b) => s + b.amount, 0)
            setBalanceSummary(`Owed ${formatMYR(total)}`)
          } else {
            setBalanceSummary(null)
          }
        }
      })
      .catch(() => {/* ignore */})
    return () => { cancelled = true }
  }, [group.id, currentUserId])

  const toggle = () => {
    if (!expanded) loadDetail()
    setExpanded((v) => !v)
  }

  const handleRefresh = async () => {
    // Refresh silently (no loading spinner) so InviteDialog stays mounted
    try {
      const d = await api.get<Record<string, unknown>>(`/groups/${group.id}`)
      setDetail(mapGroupDetail(d))
    } catch { /* ignore */ }
    onRefresh()
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4">
        <button className="flex items-center gap-3 flex-1 text-left" onClick={toggle}>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-100">
            <Users className="h-4 w-4 text-purple-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">{group.name}</h3>
            <p className="text-xs text-gray-500 flex items-center gap-1">
              {group.role === 'owner' && <Crown className="h-3 w-3 text-yellow-500" />}
              {group.role}
              {/* U-8: balance pill */}
              {balanceSummary && (
                <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                  balanceSummary.startsWith('You owe')
                    ? 'bg-orange-50 text-orange-600'
                    : 'bg-green-50 text-green-600'
                }`}>
                  {balanceSummary}
                </span>
              )}
            </p>
          </div>
        </button>
        <div className="flex items-center gap-1">
          {group.role === 'owner' && (
            <Button size="sm" variant="ghost" onClick={() => onDelete(group.id)} aria-label="Delete group">
              <Trash2 className="h-3.5 w-3.5 text-red-500" />
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={toggle}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4">
          {loading || !detail ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : (
            <>
              {/* Tab strip */}
              <div className="flex gap-1 mb-4 border-b border-gray-100">
                {(['members', 'balances'] as const).map((tab) => (
                  <button
                    key={tab}
                    className={`px-3 py-1.5 text-sm font-medium rounded-t capitalize transition-colors ${
                      activeTab === tab
                        ? 'text-brand-700 border-b-2 border-brand-500 bg-brand-50'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {activeTab === 'members' && (
                <MembersTab group={detail} currentUserId={currentUserId} onRefresh={handleRefresh} />
              )}
              {activeTab === 'balances' && (
                <BalancesTab group={detail} currentUserId={currentUserId} />
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Pending invites ───────────────────────────────────

function PendingInvites({ invites, onRefresh }: { invites: GroupInvite[]; onRefresh: () => void }) {
  const [acting, setActing] = useState<string | null>(null)
  const { removePendingInvite } = useHouseholdStore()

  const handle = async (id: string, action: 'accept' | 'decline') => {
    setActing(id)
    try {
      await api.post(`/invites/${id}/${action}`)
      removePendingInvite(id) // C-7: optimistic update
      onRefresh()
    } finally {
      setActing(null)
    }
  }

  if (invites.length === 0) return null

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
      <h3 className="text-sm font-semibold text-blue-800">Pending invitations</h3>
      {invites.map((inv) => (
        <div key={inv.id} className="flex items-center justify-between rounded-lg bg-white border border-blue-100 px-4 py-2.5">
          <div>
            <span className="text-sm font-medium text-gray-900">{inv.groupName}</span>
            <span className="text-xs text-gray-500 ml-2">from {inv.invitedByUsername}</span>
          </div>
          <div className="flex gap-1">
            <Button size="sm" onClick={() => handle(inv.id, 'accept')} disabled={acting === inv.id}>
              <Check className="h-3.5 w-3.5 mr-1" />
              Accept
            </Button>
            {/* U-5: aria-label on Decline button */}
            <Button
              size="sm"
              variant="secondary"
              aria-label="Decline invitation"
              onClick={() => handle(inv.id, 'decline')}
              disabled={acting === inv.id}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────

interface HouseholdPageProps {
  currentUserId: string
}

export function HouseholdPage({ currentUserId }: HouseholdPageProps) {
  const { groups, pendingInvites, setGroups, setPendingInvites, addGroup, removeGroup } = useHouseholdStore()
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    const [g, inv] = await Promise.all([
      api.get<Record<string, unknown>[]>('/groups'),
      api.get<Record<string, unknown>[]>('/invites'),
    ])
    setGroups(g.map(mapGroup))
    setPendingInvites(inv.map(mapInvite))
  }, [setGroups, setPendingInvites])

  useEffect(() => { loadAll() }, [loadAll])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const raw = await api.post<Record<string, unknown>>('/groups', { name: newName.trim() })
      addGroup(mapGroup(raw))
      setNewName('')
      setCreateOpen(false)
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await api.delete(`/groups/${deleteTarget}`)
      removeGroup(deleteTarget)
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? 'Could not delete group'
      alert(msg)
    } finally {
      setDeleteTarget(null)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 py-6 px-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Household</h1>
          <p className="text-sm text-gray-500 mt-0.5">Shared accounts and split expenses with family or housemates</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          New Group
        </Button>
      </div>

      <PendingInvites invites={pendingInvites} onRefresh={loadAll} />

      {groups.length === 0 && pendingInvites.length === 0 ? (
        <EmptyState
          icon={<Users className="h-10 w-10" />}
          title="No groups yet"
          description="Create a household group to share accounts and split expenses with family members."
          action={<Button size="sm" onClick={() => setCreateOpen(true)}>Create a group</Button>}
        />
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              currentUserId={currentUserId}
              onDelete={(id) => setDeleteTarget(id)}
              onRefresh={loadAll}
            />
          ))}
        </div>
      )}

      {/* Create group modal */}
      <Modal open={createOpen} onOpenChange={setCreateOpen} title="New Group">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Group name</label>
            <Input
              placeholder="e.g. Rodriguez Family"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating ? 'Creating…' : 'Create Group'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete group confirmation */}
      <Modal open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)} title="Delete Group?">
        <div className="space-y-4">
          <p className="text-sm text-gray-700">Are you sure you want to delete this group? This action cannot be undone.</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button onClick={handleDelete} className="bg-red-600 hover:bg-red-700 text-white border-red-600">
              Delete Group
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
