import { EmptyState } from '@/components/ui/EmptyState'
import { CheckSquare } from 'lucide-react'

export function TasksPage() {
  return (
    <EmptyState
      icon={<CheckSquare className="h-12 w-12" />}
      title="Tasks"
      description="Your bullet-list workspace is loading..."
    />
  )
}
