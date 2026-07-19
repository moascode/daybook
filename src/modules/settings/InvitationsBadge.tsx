import { useHouseholdStore } from '@/stores/household.store'

export function InvitationsBadge() {
  const count = useHouseholdStore((s) => s.pendingInvites.length)
  if (count === 0) return null
  return (
    <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white leading-none">
      {count > 9 ? '9+' : count}
    </span>
  )
}
