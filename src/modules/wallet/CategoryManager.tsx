import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/utils'
import type { Category } from '@/types/wallet.types'
import type { CategoryInput } from '@/hooks/useWallet'

const COLOR_SWATCHES = [
  '#378ADD', '#ef4444', '#f97316', '#eab308',
  '#22c55e', '#14b8a6', '#8b5cf6', '#6b7280',
]

const TYPE_OPTIONS = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'both', label: 'Both' },
]

interface CategoryManagerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  categories: Category[]
  onAdd: (data: CategoryInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onGetUsage: (id: string) => Promise<number>
}

export function CategoryManager({
  open,
  onOpenChange,
  categories,
  onAdd,
  onDelete,
  onGetUsage,
}: CategoryManagerProps) {
  const [form, setForm] = useState<CategoryInput>({
    name: '',
    type: 'expense',
    color: COLOR_SWATCHES[0],
  })
  const [addError, setAddError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteUsageCount, setDeleteUsageCount] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) {
      setAddError('Name is required')
      return
    }
    setAddError('')
    setSubmitting(true)
    try {
      await onAdd({ ...form, name: form.name.trim() })
      setForm({ name: '', type: 'expense', color: COLOR_SWATCHES[0] })
    } catch {
      setAddError('Failed to add category')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeleteClick(id: string) {
    const count = await onGetUsage(id)
    setDeleteUsageCount(count)
    setDeletingId(id)
  }

  async function handleConfirmDelete() {
    if (!deletingId) return
    await onDelete(deletingId)
    setDeletingId(null)
    setDeleteUsageCount(null)
  }

  function cancelDelete() {
    setDeletingId(null)
    setDeleteUsageCount(null)
  }

  const typeLabel: Record<string, string> = { income: 'Income', expense: 'Expense', both: 'Both' }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Manage Categories" className="max-w-md">
      <div className="space-y-4">
        {/* Category list */}
        <div className="max-h-64 overflow-y-auto space-y-1 rounded-lg border border-gray-100 bg-gray-50 p-2">
          {categories.length === 0 && (
            <p className="py-4 text-center text-sm text-gray-400">No categories yet.</p>
          )}
          {categories.map((cat) => (
            <div key={cat.id}>
              {deletingId === cat.id ? (
                <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 text-sm">
                  <p className="text-red-700">
                    {deleteUsageCount !== null && deleteUsageCount > 0
                      ? `Used by ${deleteUsageCount} transaction${deleteUsageCount !== 1 ? 's' : ''} (those will lose their category). `
                      : ''}
                    Delete <strong>{cat.name}</strong>?
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button variant="danger" size="sm" onClick={handleConfirmDelete}>
                      Delete
                    </Button>
                    <Button variant="secondary" size="sm" onClick={cancelDelete}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-white transition-colors">
                  <span
                    className="h-3 w-3 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: cat.color }}
                  />
                  <span className="flex-1 text-sm text-gray-800">{cat.name}</span>
                  <Badge variant="default" className="text-[10px]">
                    {typeLabel[cat.type] ?? cat.type}
                  </Badge>
                  <button
                    type="button"
                    onClick={() => handleDeleteClick(cat.id)}
                    className="rounded p-0.5 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    aria-label={`Delete ${cat.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Add form */}
        <form onSubmit={handleAdd} className="space-y-3 rounded-lg border border-gray-200 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Add Category</p>
          <Input
            label="Name"
            placeholder="e.g. Subscriptions"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            error={addError}
          />
          <Select
            label="Type"
            options={TYPE_OPTIONS}
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as CategoryInput['type'] }))}
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">Color</label>
            <div className="flex gap-2">
              {COLOR_SWATCHES.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, color }))}
                  className={cn(
                    'h-6 w-6 rounded-full border-2 transition-transform hover:scale-110',
                    form.color === color ? 'border-gray-800 scale-110' : 'border-transparent',
                  )}
                  style={{ backgroundColor: color }}
                  aria-label={color}
                />
              ))}
            </div>
          </div>
          <Button type="submit" size="sm" disabled={submitting}>
            {submitting ? 'Adding…' : 'Add Category'}
          </Button>
        </form>
      </div>
    </Modal>
  )
}
