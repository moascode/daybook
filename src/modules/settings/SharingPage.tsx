import { useState, useEffect, useCallback } from 'react'
import { Users, Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDeleteModal } from '@/components/ui/ConfirmDeleteModal'
import { EmptyState } from '@/components/ui/EmptyState'
import { GroupCard } from './GroupCard'
import { PendingInvites } from './PendingInvites'
import { useAppStore } from '@/stores/app.store'
import { useHouseholdStore } from '@/stores/household.store'
import { useToastStore } from '@/stores/toast.store'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/utils'
import { mapGroup, mapInvite } from '@/lib/household.mappers'

/**
 * Settings → Sharing: household group administration — create/delete groups,
 * invite members, accept/decline invites. Balances and settlements live on
 * the Wallet Shared page (/wallet/shared).
 */
export function SharingPage() {
  const currentUserId = useAppStore((s) => s.user?.id ?? '')
  const { groups, pendingInvites, setGroups, setPendingInvites, addGroup, removeGroup } = useHouseholdStore()
  const addToast = useToastStore((s) => s.addToast)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const loadAll = useCallback(async () => {
    setLoadError(false)
    try {
      const [g, inv] = await Promise.all([
        api.get<Record<string, unknown>[]>('/groups'),
        api.get<Record<string, unknown>[]>('/invites'),
      ])
      setGroups(g.map(mapGroup))
      setPendingInvites(inv.map(mapInvite))
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [setGroups, setPendingInvites])

  useEffect(() => { loadAll() }, [loadAll]) // eslint-disable-line react-hooks/set-state-in-effect

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const raw = await api.post<Record<string, unknown>>('/groups', { name: newName.trim() })
      addGroup(mapGroup(raw))
      setNewName('')
      setCreateOpen(false)
    } catch (err: unknown) {
      addToast({ message: errorMessage(err, 'Could not create the group — please try again.') })
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
      addToast({ message: errorMessage(err, 'Could not delete the group — please try again.') })
    } finally {
      setDeleteTarget(null)
    }
  }

  // C-6: guard against empty userId (user not yet loaded)
  if (!currentUserId) return null

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Sharing</h2>
          <p className="mt-0.5 text-xs text-gray-500">Household groups — share accounts and split expenses with family or housemates</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          New Group
        </Button>
      </div>

      {loadError ? (
        <div className="rounded-xl border border-gray-200 bg-white px-5 py-6 text-center">
          <p className="text-sm text-gray-600">Couldn&rsquo;t load your groups.</p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={() => { setLoading(true); loadAll() }}>
            Retry
          </Button>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
        </div>
      ) : (
      <>
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
      </>
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
      <ConfirmDeleteModal
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
        title="Delete group?"
        description="This permanently deletes the group for everyone. This action cannot be undone."
        confirmLabel="Delete group"
        onConfirm={handleDelete}
      />
    </div>
  )
}
