import { EmptyState } from '@/components/ui/EmptyState'
import { Upload } from 'lucide-react'

export function CsvImport() {
  return (
    <EmptyState
      icon={<Upload className="h-12 w-12" />}
      title="Import CSV"
      description="CSV import is loading..."
    />
  )
}
