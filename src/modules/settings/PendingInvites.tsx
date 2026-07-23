import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/utils'
import { useHouseholdStore } from '@/stores/household.store'
import { useToastStore } from '@/stores/toast.store'
import type { GroupInvite } from '@/types/household.types'

export function PendingInvites({ invites, onRefresh }: { invites: GroupInvite[]; onRefresh: () => void }) {
  const [acting, setActing] = useState<string | null>(null)
  const { removePendingInvite } = useHouseholdStore()
  const addToast = useToastStore((s) => s.addToast)

  const handle = async (id: string, action: 'accept' | 'decline') => {
    setActing(id)
    try {
      await api.post(`/invites/${id}/${action}`)
      removePendingInvite(id) // C-7: optimistic update
      onRefresh()
    } catch (err: unknown) {
      addToast({ message: errorMessage(err, `Could not ${action} the invitation — please try again.`) })
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
