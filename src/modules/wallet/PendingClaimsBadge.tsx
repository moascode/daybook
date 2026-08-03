import { useHouseholdStore } from '@/stores/household.store'

/**
 * Count of split claims standing against the current user, on the Shared nav
 * link. Mirrors InvitationsBadge deliberately — same shape, same polling cadence
 * — because it answers the same question: "is something waiting for me?"
 *
 * This exists because the original bug report was a recipient who could not see
 * 15 splits made against her. Visibility fixes let her find them; this is what
 * tells her to go looking.
 */
export function PendingClaimsBadge() {
  const count = useHouseholdStore((s) => s.pendingClaimCount)
  if (count === 0) return null
  return (
    <span
      data-testid="pending-claims-badge"
      aria-label={`${count} split${count === 1 ? '' : 's'} to review`}
      className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-fg-on-accent leading-none"
    >
      {count > 9 ? '9+' : count}
    </span>
  )
}
