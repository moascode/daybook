import { useEffect, useState } from 'react'
import { ListChecks, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useRules } from '@/hooks/useRules'
import { useAppStore } from '@/stores/app.store'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/utils'
import { matchRule, ruleChanges } from '@/lib/rules'
import { mapMember } from '@/lib/household.mappers'
import type { RuleSplitInput } from '@/hooks/useWallet'
import type { Category, TransactionRule, TransactionType } from '@/types/wallet.types'
import type { GroupMember } from '@/types/household.types'

interface RuleFormFields {
  accountId: string
  type: TransactionType
  merchant: string
  description: string
  categoryId: string | null
  tags: string[]
  ruleSplit?: RuleSplitInput | null
}

interface RuleMatchHintProps {
  form: RuleFormFields
  categories: Category[]
  /** An already-split transaction is never re-split from here — that replaces its shares. */
  allowSplit: boolean
  onApply: (updates: Partial<RuleFormFields>) => void
}

/**
 * TransactionForm's rule suggestion: names the first rule matching what is
 * typed so far and applies it on one click — never on its own (the import
 * chip's "no click, no change" rule). The split itself is created after the
 * save, by useWallet, from `form.ruleSplit`.
 */
export function RuleMatchHint({ form, categories, allowSplit, onApply }: RuleMatchHintProps) {
  const { rules, loadRules } = useRules()
  const currentUserId = useAppStore((s) => s.user?.id ?? '')
  const [members, setMembers] = useState<GroupMember[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    loadRules().catch((err: unknown) => setLoadError(errorMessage(err, "Couldn't load your rules.")))
    api.get<Record<string, unknown>[]>('/groups/members')
      .then((rows) => setMembers(rows.map(mapMember).filter((m) => m.userId !== currentUserId)))
      .catch(() => { /* names only — the hint falls back to "partner" */ })
  }, [loadRules, currentUserId])

  const partnerName = (userId: string) => members.find((m) => m.userId === userId)?.username ?? 'partner'

  if (loadError) return <p className="text-xs text-fg-faint" data-testid="rule-hint-error">{loadError} Rules won't be suggested.</p>

  if (form.ruleSplit && form.type === 'expense') {
    const { percent, userId, ruleName } = form.ruleSplit
    return (
      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-sunken px-3 py-2 text-xs text-fg-muted" data-testid="rule-hint-applied">
        <ListChecks className="h-3.5 w-3.5 shrink-0 text-fg-faint" />
        <span className="flex-1">
          On save: split {100 - percent}/{percent} with {partnerName(userId)} ({ruleName})
        </span>
        <button
          type="button"
          aria-label="Don't split"
          className="rounded p-0.5 text-fg-faint hover:text-fg"
          onClick={() => onApply({ ruleSplit: null })}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  if (form.type === 'transfer') return null
  const rule = matchRule(rules, { ...form, accountId: form.accountId || null })
  if (!rule) return null
  const updates = applyUpdates(rule, form, categories, allowSplit)
  if (Object.keys(updates).length === 0) return null

  const summary: string[] = []
  if (updates.categoryId) summary.push(categories.find((c) => c.id === updates.categoryId)?.name ?? 'category')
  for (const t of rule.addTags.filter((t) => !form.tags.includes(t))) summary.push(`#${t}`)
  if (updates.ruleSplit) summary.push(`split ${100 - updates.ruleSplit.percent}/${updates.ruleSplit.percent} with ${partnerName(updates.ruleSplit.userId)}`)

  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-sunken px-3 py-2 text-xs text-fg-muted" data-testid="rule-hint">
      <ListChecks className="h-3.5 w-3.5 shrink-0 text-fg-faint" />
      <span className="flex-1">
        Rule “{rule.name}” matches: {summary.join(', ')}
      </span>
      <Button type="button" size="sm" variant="secondary" onClick={() => onApply(updates)} data-testid="rule-hint-apply">
        Apply
      </Button>
    </div>
  )
}

function applyUpdates(rule: TransactionRule, form: RuleFormFields, categories: Category[], allowSplit: boolean): Partial<RuleFormFields> {
  const { categoryId, tags, split } = ruleChanges(rule, { ...form, alreadySplit: !allowSplit }, categories)
  const updates: Partial<RuleFormFields> = {}
  if (categoryId) updates.categoryId = categoryId
  if (tags) updates.tags = tags
  if (split) updates.ruleSplit = { ...split, ruleName: rule.name }
  return updates
}
