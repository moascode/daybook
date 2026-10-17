import { useEffect, useState } from 'react'
import { ListChecks } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ConfirmDeleteModal } from '@/components/ui/ConfirmDeleteModal'
import { useRules } from '@/hooks/useRules'
import { useWallet } from '@/hooks/useWallet'
import { useToastStore } from '@/stores/toast.store'
import { useAppStore } from '@/stores/app.store'
import { errorMessage } from '@/lib/utils'
import { api } from '@/lib/api'
import { mapMember } from '@/lib/household.mappers'
import { RuleDialog } from './RuleDialog'
import type { TransactionRule } from '@/types/wallet.types'
import type { GroupMember } from '@/types/household.types'
import type { RuleInput } from '@/hooks/useRules'

/** One rule, as a readable sentence — "If <conditions> → <actions>". */
function ruleSentence(rule: TransactionRule, accounts: ReturnType<typeof useWallet>['accounts'], categories: ReturnType<typeof useWallet>['categories'], members: GroupMember[]): string {
  const conditions: string[] = []
  const acct = accounts.find((a) => a.id === rule.matchAccountId)
  if (acct) conditions.push(acct.last4 ? `••${acct.last4}` : acct.name)
  const matchCat = categories.find((c) => c.id === rule.matchCategoryId)
  if (matchCat) conditions.push(matchCat.name)
  if (rule.matchMerchant) conditions.push(`merchant contains "${rule.matchMerchant}"`)

  const actions: string[] = []
  const setCat = categories.find((c) => c.id === rule.setCategoryId)
  if (setCat) actions.push(setCat.name)
  for (const t of rule.addTags) actions.push(`#${t}`)
  if (rule.splitUserId && rule.splitPercent != null) {
    const partner = members.find((m) => m.userId === rule.splitUserId)
    actions.push(`split ${rule.splitPercent}% with ${partner?.username ?? 'partner'}`)
  }

  return `If ${conditions.join(' · ') || 'anything'} → ${actions.join(', ') || 'nothing'}`
}

/**
 * Settings → Wallet "Rules" card: a caller's own ordered auto-categorise/
 * auto-tag/auto-split rules (worker/routes/rules.ts). Evaluation happens
 * client-side against review-table rows (src/lib/rules.ts's matchRule) —
 * this component is purely the CRUD surface.
 */
export function RulesSettings() {
  const { rules, loadRules, createRule, updateRule, deleteRule } = useRules()
  const { accounts, categories, loadAccounts, loadCategories } = useWallet()
  const { addToast } = useToastStore()
  const currentUserId = useAppStore((s) => s.user?.id ?? '')
  const [members, setMembers] = useState<GroupMember[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<TransactionRule | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [membersError, setMembersError] = useState<string | null>(null)

  // #9: independent loads — a members failure disables the split UI with an
  // explanation but must never also blank an otherwise-successful rules list.
  useEffect(() => {
    loadAccounts()
    loadCategories()
    loadRules().catch((err: unknown) => setLoadError(errorMessage(err, "Couldn't load your rules.")))
    api.get<Record<string, unknown>[]>('/groups/members')
      .then((memberRows) => setMembers(memberRows.map(mapMember).filter((m) => m.userId !== currentUserId)))
      .catch((err: unknown) => setMembersError(errorMessage(err, "Couldn't load who you can split with.")))
  }, [loadAccounts, loadCategories, loadRules, currentUserId])

  const writableAccounts = accounts.filter((a) => !a.isShared || a.canWrite === 1)
  const otherMembers = members

  async function handleToggle(rule: TransactionRule) {
    try {
      await updateRule(rule.id, { enabled: !rule.enabled })
    } catch (err) {
      addToast({ message: errorMessage(err, "Couldn't update that rule."), duration: 4000 })
    }
  }

  async function handleSave(data: RuleInput) {
    if (editing) {
      await updateRule(editing.id, data)
      addToast({ message: 'Rule updated.' })
    } else {
      await createRule(data)
      addToast({ message: 'Rule created.' })
    }
  }

  async function handleDelete() {
    if (!confirmDeleteId) return
    const id = confirmDeleteId
    setConfirmDeleteId(null)
    try {
      await deleteRule(id)
      addToast({ message: 'Rule deleted.' })
    } catch (err) {
      addToast({ message: errorMessage(err, "Couldn't delete that rule."), duration: 4000 })
    }
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-5" data-testid="rules-section">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-fg-faint" />
          <h3 className="text-sm font-semibold text-fg">Rules</h3>
        </div>
        <Button
          variant="secondary"
          size="sm"
          data-testid="rule-new"
          onClick={() => { setEditing(null); setDialogOpen(true) }}
        >
          New rule
        </Button>
      </div>

      {loadError ? (
        <p className="text-xs text-red-600">{loadError}</p>
      ) : rules.length === 0 ? (
        <p className="text-sm text-fg-subtle">
          No rules yet. A rule can set a category, add tags, or split a payment automatically when a matching
          transaction is imported or captured.
        </p>
      ) : (
        <ul className="divide-y divide-line-subtle border-t border-line-subtle">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-center gap-3 py-2.5" data-testid="rule-row">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={rule.enabled}
                  onChange={() => void handleToggle(rule)}
                  aria-label={`Enable rule ${rule.name}`}
                  data-testid="rule-enabled"
                />
              </label>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-fg">{rule.name}</p>
                <p className="truncate text-xs text-fg-subtle">{ruleSentence(rule, accounts, categories, members)}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setEditing(rule); setDialogOpen(true) }}>
                Edit
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteId(rule.id)} data-testid="rule-delete">
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}

      <RuleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        rule={editing}
        accounts={writableAccounts}
        categories={categories}
        groupMembers={otherMembers}
        membersError={membersError}
        onSave={handleSave}
      />

      <ConfirmDeleteModal
        open={!!confirmDeleteId}
        onOpenChange={(open) => { if (!open) setConfirmDeleteId(null) }}
        title="Delete this rule?"
        description="It will stop being applied to future transactions. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => void handleDelete()}
        confirmTestId="rule-delete-confirm"
      />
    </section>
  )
}
