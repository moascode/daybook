import { useAppStore } from '@/stores/app.store'
import { HouseholdPage } from './HouseholdPage'

export function HouseholdPageWrapper() {
  const userId = useAppStore((s) => s.user?.id ?? '')
  // C-6: guard against empty userId (user not yet loaded)
  if (!userId) return null
  return <HouseholdPage currentUserId={userId} />
}
