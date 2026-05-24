import { EmptyState } from '@/components/ui/EmptyState'
import { Wallet } from 'lucide-react'

export function WalletPage() {
  return (
    <EmptyState
      icon={<Wallet className="h-12 w-12" />}
      title="Transactions"
      description="Your transaction list is loading..."
    />
  )
}
