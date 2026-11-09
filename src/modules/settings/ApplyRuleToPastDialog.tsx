import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import { errorMessage, formatMYR } from '@/lib/utils'
import { planRuleBackfill, ruleSplitRequest } from '@/lib/rules'
import { mapTransaction, type TransactionRow } from '@/hooks/useWallet'
import { useToastStore } from '@/stores/toast.store'
import type { Category, TransactionRule } from '@/types/wallet.types'

interface ApplyRuleToPastDialogProps {
  rule: TransactionRule | null
  categories: Category[]
  onOpenChange: (open: boolean) => void
}

type Plan = ReturnType<typeof planRuleBackfill>

/** POST /transactions/bulk-update caps one request at 500 ids. */
const BULK_LIMIT = 500

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += BULK_LIMIT) out.push(items.slice(i, i + BULK_LIMIT))
  return out
}

/**
 * Settings → Rules "Apply to past": runs one rule over the caller's own
 * existing transactions, previews exactly what would change, and applies it
 * only on confirm. Category and tags go through the bulk-update route; each
 * split is its own POST (a split is per-transaction state). The parent keys
 * it by rule id, so each open starts from a fresh plan.
 */
export function ApplyRuleToPastDialog({ rule, categories, onOpenChange }: ApplyRuleToPastDialogProps) {
  const { addToast } = useToastStore()
  const [plan, setPlan] = useState<Plan | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    if (!rule) return
    api.get<TransactionRow[]>('/transactions?view=mine')
      .then((rows) => setPlan(planRuleBackfill(rule, rows.map(mapTransaction), categories)))
      .catch((err: unknown) => setLoadError(errorMessage(err, "Couldn't load your transactions.")))
  }, [rule, categories])

  async function handleApply() {
    if (!rule || !plan) return
    setApplying(true)
    let failed = 0
    let firstError = ''
    const fail = (err: unknown, count: number) => {
      failed += count
      firstError ||= errorMessage(err, 'unknown error')
    }
    try {
      const categoryIds = plan.filter((p) => p.changes.categoryId).map((p) => p.transaction.id)
      for (const ids of chunks(categoryIds)) {
        await api.post('/transactions/bulk-update', { ids, categoryId: rule.setCategoryId }).catch((err: unknown) => fail(err, ids.length))
      }
      const tagIds = plan.filter((p) => p.changes.tags).map((p) => p.transaction.id)
      for (const ids of chunks(tagIds)) {
        await api.post('/transactions/bulk-update', { ids, tags: { mode: 'add', values: rule.addTags } }).catch((err: unknown) => fail(err, ids.length))
      }
      for (const { transaction: t, changes } of plan) {
        if (!changes.split) continue
        await api
          .post(`/transactions/${t.id}/split`, ruleSplitRequest(t.amount, changes.split.userId, changes.split.percent, `Auto-split by rule: ${rule.name}`))
          .catch((err: unknown) => fail(err, 1))
      }
    } finally {
      setApplying(false)
    }
    addToast(
      failed > 0
        ? { message: `Applied "${rule.name}", but ${failed} change${failed !== 1 ? 's' : ''} failed — ${firstError}`, duration: 7000 }
        : { message: `Applied "${rule.name}" to ${plan.length} transaction${plan.length !== 1 ? 's' : ''}.` },
    )
    onOpenChange(false)
  }

  const splitCount = plan?.filter((p) => p.changes.split).length ?? 0
  const categoryCount = plan?.filter((p) => p.changes.categoryId).length ?? 0
  const tagCount = plan?.filter((p) => p.changes.tags).length ?? 0

  return (
    <Modal open={!!rule} onOpenChange={onOpenChange} title={`Apply "${rule?.name ?? ''}" to past transactions`} className="max-w-lg">
      <div className="space-y-4" data-testid="rule-backfill">
        {loadError ? (
          <p className="text-sm text-red-600">{loadError}</p>
        ) : !plan ? (
          <p className="text-sm text-fg-subtle">Checking your transactions…</p>
        ) : plan.length === 0 ? (
          <p className="text-sm text-fg-subtle" data-testid="rule-backfill-empty">
            No past transactions need changing — none match, or they already have what this rule sets.
          </p>
        ) : (
          <>
            <p className="text-sm text-fg-muted" data-testid="rule-backfill-summary">
              {plan.length} transaction{plan.length !== 1 ? 's' : ''} will change
              {[
                categoryCount && `${categoryCount} recategorised`,
                tagCount && `${tagCount} tagged`,
                splitCount && `${splitCount} split`,
              ].filter(Boolean).map((s) => ` · ${s}`).join('')}
              .
            </p>
            <ul className="max-h-64 divide-y divide-line-subtle overflow-y-auto border-y border-line-subtle text-sm">
              {plan.map(({ transaction: t }) => (
                <li key={t.id} className="flex items-center gap-3 py-1.5" data-testid="rule-backfill-row">
                  <span className="w-20 shrink-0 text-xs text-fg-faint">{t.date}</span>
                  <span className="min-w-0 flex-1 truncate text-fg">{t.merchant || t.description || 'Unnamed'}</span>
                  <span className="tabular-nums text-fg-muted">{formatMYR(t.amount)}</span>
                </li>
              ))}
            </ul>
            {splitCount > 0 && (
              <p className="text-xs text-fg-subtle">Each split is sent to the other person for review, like any split you create.</p>
            )}
          </>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            loading={applying}
            disabled={!plan || plan.length === 0}
            onClick={() => void handleApply()}
            data-testid="rule-backfill-confirm"
          >
            Apply to {plan?.length ?? 0}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
