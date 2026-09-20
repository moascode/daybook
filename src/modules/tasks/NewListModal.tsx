import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

// Same palette as TasksListDetailPage.tsx's rename/recolour rail — kept as
// its own small copy rather than a shared import; two unrelated components
// coincidentally wanting the same twelve colours isn't worth coupling them.
const COLOR_PRESETS = [
  '#1D9E75', '#10b981', '#059669',
  '#3b82f6', '#6366f1', '#8b5cf6',
  '#ef4444', '#f97316', '#eab308',
  '#ec4899', '#14b8a6', '#6b7280',
]

/**
 * FEAT-053 (docs/backlog/EP-07-tasks-depth/FEAT-053-create-task-list.md):
 * the "+ New list" affordance — `POST /task-lists` already existed and
 * worked, nothing in the client ever called it. Name + colour is enough;
 * icon stays at the server's default ('list') like every other field this
 * form doesn't expose.
 */
export function NewListModal({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (input: { name: string; color: string }) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLOR_PRESETS[0])
  const [saving, setSaving] = useState(false)

  const reset = () => {
    setName('')
    setColor(COLOR_PRESETS[0])
  }

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      await onCreate({ name: trimmed, color })
      onOpenChange(false)
      reset()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
      title="New list"
      className="max-w-sm"
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Work"
          autoFocus
          data-testid="new-list-name-input"
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCreate()
          }}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-fg-muted">Colour</span>
          <div className="flex flex-wrap gap-2">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full"
                onClick={() => setColor(c)}
                aria-label={`Select colour ${c}`}
                data-testid="new-list-color-swatch"
              >
                <span
                  className={cn(
                    'h-6 w-6 rounded-full border-2 transition-transform',
                    color === c ? 'scale-110 border-fg' : 'border-transparent',
                  )}
                  style={{ backgroundColor: c }}
                  aria-hidden="true"
                />
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" data-testid="new-list-create-btn" onClick={handleCreate} disabled={!name.trim() || saving}>
            Create
          </Button>
        </div>
      </div>
    </Modal>
  )
}
