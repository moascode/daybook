import { EmptyState } from '@/components/ui/EmptyState'
import { CreditCard } from 'lucide-react'

export function AccountsPage() {
  return (
    <EmptyState
      icon={<CreditCard className="h-12 w-12" />}
      title="Accounts"
      description="Your accounts are loading..."
    />
  )
}
