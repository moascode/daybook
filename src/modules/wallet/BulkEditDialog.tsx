import { useState, useMemo } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { TagInput } from '@/components/ui/TagInput'
import type { Category, Transaction } from '@/types/wallet.types'

type TagMode = 'add' | 'replace' | 'remove'

/**
 * Mounted only while open (see WalletPage), so every field starts clean without
 * a reset effect. Carrying a stale category over from the previous edit and
 * applying it silently to a different selection is exactly the kind of bulk
 * mistake that is tedious to undo.
 */
interface BulkEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedTransactionIds: string[]
  transactions: Transaction[]
  categories: Category[]
  availableTags: string[]
  onApply: (changes: {
    categoryId?: string | null
    tags?: { mode: TagMode; values: string[] }
  }) => Promise<void>
}

// '' means "leave the category alone" — distinct from CLEAR, which writes null.
// Without the distinction there is no way to express "only change the tags",
// because an untouched select would otherwise wipe every category.
const KEEP = ''
const CLEAR = '__clear__'

const TAG_MODES: { value: TagMode; label: string }[] = [
  { value: 'add', label: 'Add to existing tags' },
  { value: 'replace', label: 'Replace all tags' },
  { value: 'remove', label: 'Remove these tags' },
]

export function BulkEditDialog({
  open,
  onOpenChange,
  selectedTransactionIds,
  transactions,
  categories,
  availableTags,
  onApply,
}: BulkEditDialogProps) {
  const [categoryChoice, setCategoryChoice] = useState<string>(KEEP)
  const [tagMode, setTagMode] = useState<TagMode>('add')
  const [tags, setTags] = useState<string[]>([])
  const [touchedTags, setTouchedTags] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = useMemo(
    () => transactions.filter((t) => selectedTransactionIds.includes(t.id)),
    [transactions, selectedTransactionIds],
  )

  // Transfers take neither field (§9.2). Say so up front rather than letting the
  // count come back smaller than expected with no explanation.
  const transferCount = selected.filter((t) => t.type === 'transfer').length
  const affected = selected.length - transferCount

  // Only offer categories that suit what is actually selected: an income-only
  // selection should not be offered expense categories.
  const categoryOptions = useMemo(() => {
    const types = new Set(selected.filter((t) => t.type !== 'transfer').map((t) => t.type))
    const usable = categories.filter(
      (cat) => cat.type === 'both' || types.size === 0 || types.has(cat.type as 'income' | 'expense'),
    )
    return [
      { value: KEEP, label: 'Keep current category' },
      { value: CLEAR, label: 'Clear category' },
      ...usable.map((cat) => ({ value: cat.id, label: cat.name })),
    ]
  }, [categories, selected])

  const changesCategory = categoryChoice !== KEEP
  // "Replace all tags" with an empty list is a legitimate "clear every tag",
  // but only once the user has actually touched the tag controls — otherwise
  // simply opening the dialog to change a category would also wipe the tags.
  const clearsTags = tagMode === 'replace' && tags.length === 0 && touchedTags
  const willApply = changesCategory || tags.length > 0 || clearsTags

  async function handleApply() {
    if (!willApply) return
    setSaving(true)
    setError(null)
    try {
      await onApply({
        ...(changesCategory ? { categoryId: categoryChoice === CLEAR ? null : categoryChoice } : {}),
        ...(tags.length > 0 || clearsTags ? { tags: { mode: tagMode, values: tags } } : {}),
      })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not apply the changes — please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit ${selected.length} transaction${selected.length !== 1 ? 's' : ''}`}
      className="max-w-md"
    >
      <div className="space-y-4">
        {transferCount > 0 && (
          <p
            data-testid="bulk-edit-transfer-note"
            className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"
          >
            {transferCount} transfer{transferCount !== 1 ? 's' : ''} will be skipped — transfers are not
            categorised or tagged. {affected} transaction{affected !== 1 ? 's' : ''} will change.
          </p>
        )}

        {/* Explicit ids: Select derives one from the label, and the filter bar
            behind this modal already has a "Category" select — two elements
            with id="category" in the same document. */}
        <Select
          id="bulk-edit-category-select"
          label="Category"
          options={categoryOptions}
          value={categoryChoice}
          onChange={(e) => setCategoryChoice(e.target.value)}
          data-testid="bulk-edit-category"
        />

        <div className="space-y-2 rounded-lg border border-line p-3">
          <Select
            id="bulk-edit-tag-mode-select"
            label="Tags"
            options={TAG_MODES}
            value={tagMode}
            onChange={(e) => {
              setTagMode(e.target.value as TagMode)
              setTouchedTags(true)
            }}
            data-testid="bulk-edit-tag-mode"
          />
          <TagInput
            id="bulk-edit-tags"
            value={tags}
            onChange={(next) => {
              setTags(next)
              setTouchedTags(true)
            }}
            suggestions={availableTags}
            allowCreate={tagMode !== 'remove'}
            placeholder={tagMode === 'remove' ? 'Tags to remove…' : 'Tags to apply…'}
          />
          {tagMode === 'replace' && tags.length === 0 && touchedTags && (
            <p className="text-xs text-amber-700">
              This will remove every tag from the selected transactions.
            </p>
          )}
        </div>

        {error && (
          <p data-testid="bulk-edit-error" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleApply}
            disabled={!willApply || saving || affected === 0}
            data-testid="bulk-edit-apply"
          >
            {saving ? 'Applying…' : `Apply to ${affected}`}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
