import { useState, useCallback } from 'react'
import { Users, Trash2, UserMinus, Crown, UserPlus, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { InviteDialog } from './InviteDialog'
import { api } from '@/lib/api'
import type { Group, GroupDetail } from '@/types/household.types'
import { mapGroupDetail } from '@/lib/household.mappers'

/**
 * One household group in Settings → Sharing: expandable card with the
 * member list, invite, remove/leave, and (for owners) delete.
 * Money outcomes (balances, settlements) live on the Wallet Shared page.
 */

function MemberList({
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

export function GroupCard({
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
  const [loading, setLoading] = useState(false)

  const loadDetail = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api.get<Record<string, unknown>>(`/groups/${group.id}`)
      setDetail(mapGroupDetail(d))
    } finally {
      setLoading(false)
    }
  }, [group.id])

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
            </p>
          </div>
        </button>
        <div className="flex items-center gap-1">
          {group.role === 'owner' && (
            <Button size="sm" variant="ghost" onClick={() => onDelete(group.id)} aria-label="Delete group">
              <Trash2 className="h-3.5 w-3.5 text-red-500" />
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={toggle} aria-label={expanded ? 'Collapse group' : 'Expand group'}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4">
          {loading || !detail ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : (
            <MemberList group={detail} currentUserId={currentUserId} onRefresh={handleRefresh} />
          )}
        </div>
      )}
    </div>
  )
}
