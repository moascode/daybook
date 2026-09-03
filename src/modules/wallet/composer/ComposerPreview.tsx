import { useEffect, useRef } from 'react'
import { TrendingDown, TrendingUp, ArrowRightLeft, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn, formatMYR } from '@/lib/utils'
import type { Account, Category } from '@/types/wallet.types'
import type { ComposerDraft } from './parseComposerInput'

/**
 * `ComposerDraft` (from `parseComposerInput.ts`) pins `categoryId` to the
 * literal `null` because the rules parser never guesses a category. The AI
 * fallback route CAN return one, so the preview (and `Composer.tsx`'s state)
 * widen that one field to `string | null`; every rules-produced draft still
 * satisfies this shape unchanged.
 */
export type ComposerPreviewDraft = Omit<ComposerDraft, 'categoryId'> & {
  categoryId: string | null
}

interface ComposerPreviewProps {
  draft: ComposerPreviewDraft
  accounts: Account[]
  categories: Category[]
  /** True while Confirm's POST is in flight — disables Confirm/Edit/Cancel so a second click or an Enter-repeat can't double-post the same draft. */
  confirming: boolean
  onConfirm: () => void | Promise<void>
  onEdit: () => void
  onCancel: () => void
}

const TYPE_ICON: Record<ComposerPreviewDraft['type'], typeof TrendingDown> = {
  expense: TrendingDown,
  income: TrendingUp,
  transfer: ArrowRightLeft,
}

const TYPE_COLOR: Record<ComposerPreviewDraft['type'], string> = {
  expense: 'text-red-600 bg-red-50',
  income: 'text-positive-600 bg-positive-50',
  transfer: 'text-blue-600 bg-blue-50',
}

/**
 * Inline confirm/edit/cancel strip shown under the composer after a draft has
 * been parsed (rules parser or AI fallback) — the "preview the user confirms,
 * never a silent write" surface from the R7 flow plan (criteria #9). Confirm
 * is the only path that posts anything.
 */
export function ComposerPreview({
  draft,
  accounts,
  categories,
  confirming,
  onConfirm,
  onEdit,
  onCancel,
}: ComposerPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    containerRef.current?.focus()
  }, [])

  const account = accounts.find((a) => a.id === draft.accountId)
  const destinationAccount =
    draft.type === 'transfer' && draft.destinationAccountId
      ? accounts.find((a) => a.id === draft.destinationAccountId)
      : null
  const category = draft.categoryId ? categories.find((c) => c.id === draft.categoryId) : null
  const Icon = TYPE_ICON[draft.type]

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      data-testid="composer-preview"
      className="mt-2 flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-sm outline-none"
    >
      <span
        className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', TYPE_COLOR[draft.type])}
        aria-hidden="true"
      >
        <Icon className="h-4 w-4" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col">
        <p className="truncate text-sm font-medium text-fg">
          {draft.merchant || '(no merchant)'}
        </p>
        <p className="truncate text-xs text-fg-subtle">
          {destinationAccount
            ? `${account?.name ?? 'Unknown account'} → ${destinationAccount.name}`
            : `${account?.name ?? 'Unknown account'} · ${category?.name ?? 'Uncategorised'}`}
        </p>
      </div>

      <p className="shrink-0 text-sm font-semibold text-fg">{formatMYR(draft.amount)}</p>

      <div className="flex shrink-0 items-center gap-1.5">
        <Button size="sm" variant="primary" loading={confirming} onClick={() => void onConfirm()}>
          Confirm
        </Button>
        <Button size="sm" variant="secondary" disabled={confirming} onClick={onEdit}>
          Edit
        </Button>
        <button
          type="button"
          onClick={onCancel}
          disabled={confirming}
          aria-label="Cancel"
          className="flex h-7 w-7 items-center justify-center rounded-full text-fg-faint hover:bg-surface-hover hover:text-fg-muted disabled:pointer-events-none disabled:opacity-50"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
