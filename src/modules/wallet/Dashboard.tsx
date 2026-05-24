import { EmptyState } from '@/components/ui/EmptyState'
import { LayoutDashboard } from 'lucide-react'

export function Dashboard() {
  return (
    <EmptyState
      icon={<LayoutDashboard className="h-12 w-12" />}
      title="Dashboard"
      description="Your financial dashboard is loading..."
    />
  )
}
