import { useAppStore } from '@/stores/app.store'
import { HouseholdPage } from './HouseholdPage'

export function HouseholdPageWrapper() {
  const userId = useAppStore((s) => s.user?.id ?? '')
  return <HouseholdPage currentUserId={userId} />
}
