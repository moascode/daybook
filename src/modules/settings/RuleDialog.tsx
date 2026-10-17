import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { TagInput } from '@/components/ui/TagInput'
import type { RuleInput } from '@/hooks/useRules'
import type { Account, Category, TransactionRule } from '@/types/wallet.types'
import type { GroupMember } from '@/types/household.types'

interface RuleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  rule?: TransactionRule | null
  accounts: Account[]
  categories: Category[]
  groupMembers: GroupMember[]
  /** #9: set when /groups/members failed to load — disables the split UI with an explanation rather than silently treating it as "no members". */
  membersError?: string | null
  onSave: (data: RuleInput) => Promise<void>
}

interface FormState {
  name: string
  matchAccountId: string
  matchCategoryId: string
  matchMerchant: string
  setCategoryId: string
  addTags: string[]
  splitUserId: string
  splitPercent: string
}

function initialState(rule?: TransactionRule | null): FormState {
  return {
    name: rule?.name ?? '',
    matchAccountId: rule?.matchAccountId ?? '',
    matchCategoryId: rule?.matchCategoryId ?? '',
    matchMerchant: rule?.matchMerchant ?? '',
    setCategoryId: rule?.setCategoryId ?? '',
    addTags: rule?.addTags ?? [],
    splitUserId: rule?.splitUserId ?? '',
    splitPercent: rule?.splitPercent != null ? String(rule.splitPercent) : '50',
  }
}

/**
 * Create/edit a transaction rule (worker/routes/rules.ts). Client-side
 * validation mirrors the server's own condition/action/pairing checks so the
 * common mistakes never leave this dialog — the server's 400 message is
 * still shown verbatim for anything that slips through (rule 10: never fail silently).
 */
export function RuleDialog({ open, onOpenChange, rule, accounts, categories, groupMembers, membersError, onSave }: RuleDialogProps) {
  const [form, setForm] = useState<FormState>(initialState(rule))
  const [splitOn, setSplitOn] = useState(!!rule?.splitUserId)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [prevOpen, setPrevOpen] = useState(open)

  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setForm(initialState(rule))
      setSplitOn(!!rule?.splitUserId)
      setError('')
    }
  }

  const hasCondition = !!form.matchAccountId || !!form.matchCategoryId || form.matchMerchant.trim().length > 0
  const hasAction = !!form.setCategoryId || form.addTags.length > 0 || splitOn

  function autoName(): string {
    const parts: string[] = []
    const acct = accounts.find((a) => a.id === form.matchAccountId)
    if (acct) parts.push(acct.last4 ? `${acct.name} ••${acct.last4}` : acct.name)
    const cat = categories.find((c) => c.id === form.matchCategoryId)
    if (cat) parts.push(cat.name)
    if (form.matchMerchant.trim()) parts.push(`"${form.matchMerchant.trim()}"`)
    return parts.length > 0 ? parts.join(' · ') : 'New rule'
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!hasCondition) {
      setError('Add at least one condition: account, category, or merchant.')
      return
    }
    if (!hasAction) {
      setError('Add at least one action: set a category, add a tag, or split.')
      return
    }
    const percent = splitOn ? Number(form.splitPercent) : null
    if (splitOn && (!form.splitUserId || !Number.isFinite(percent) || (percent as number) <= 0 || (percent as number) >= 100)) {
      setError('Pick who to split with and a share between 1% and 99%.')
      return
    }

    setSaving(true)
    setError('')
    try {
      await onSave({
        name: (form.name.trim() || autoName()).slice(0, 80),
        matchAccountId: form.matchAccountId || null,
        matchCategoryId: form.matchCategoryId || null,
        // '' clears the condition — not null. The server's NOT NULL
        // match_merchant column has no "absent" representation; null used to
        // reach updateRow() unmerged and 500 (worker/routes/rules.ts PATCH).
        matchMerchant: form.matchMerchant.trim(),
        setCategoryId: form.setCategoryId || null,
        addTags: form.addTags.length > 0 ? form.addTags : null,
        splitUserId: splitOn ? form.splitUserId : null,
        splitPercent: splitOn ? percent : null,
      })
      onOpenChange(false)
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Could not save this rule.')
    } finally {
      setSaving(false)
    }
  }

  const partner = groupMembers.find((m) => m.userId === form.splitUserId)
  const percentNum = Number(form.splitPercent) || 0

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={rule ? 'Edit rule' : 'New rule'} className="max-w-lg">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <Input
          label="Name (optional)"
          placeholder={autoName()}
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          maxLength={80}
        />

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-faint">Conditions</p>
          <div className="space-y-3">
            <Select
              label="Account"
              options={[
                { value: '', label: 'Any account' },
                ...accounts.map((a) => ({ value: a.id, label: a.last4 ? `${a.name} ••${a.last4}` : a.name })),
              ]}
              value={form.matchAccountId}
              onChange={(e) => setForm((f) => ({ ...f, matchAccountId: e.target.value }))}
            />
            <Select
              label="Match category"
              options={[
                { value: '', label: 'Any category' },
                ...categories.map((c) => ({ value: c.id, label: c.name })),
              ]}
              value={form.matchCategoryId}
              onChange={(e) => setForm((f) => ({ ...f, matchCategoryId: e.target.value }))}
            />
            <Input
              label="Merchant contains"
              placeholder="e.g. tesco"
              value={form.matchMerchant}
              maxLength={100}
              onChange={(e) => setForm((f) => ({ ...f, matchMerchant: e.target.value }))}
            />
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-faint">Actions</p>
          <div className="space-y-3">
            <Select
              label="Set category"
              options={[
                { value: '', label: "Don't change category" },
                ...categories.map((c) => ({ value: c.id, label: c.name })),
              ]}
              value={form.setCategoryId}
              onChange={(e) => setForm((f) => ({ ...f, setCategoryId: e.target.value }))}
            />
            <TagInput
              label="Add tags"
              value={form.addTags}
              onChange={(tags) => setForm((f) => ({ ...f, addTags: tags }))}
              placeholder="Type a tag and press enter"
              testId="rule-tags"
            />

            <div>
              <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-fg-muted">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={splitOn}
                  disabled={groupMembers.length === 0 || !!membersError}
                  onChange={(e) => setSplitOn(e.target.checked)}
                  data-testid="rule-split-toggle"
                />
                Split with
              </label>
              {membersError ? (
                <p className="text-xs text-red-600" data-testid="rule-split-members-error">
                  {membersError} — split is off for now.
                </p>
              ) : groupMembers.length === 0 ? (
                <p className="text-xs text-fg-subtle">Invite someone in Sharing to split with them.</p>
              ) : splitOn && (
                <div className="flex items-center gap-2">
                  <Select
                    options={[
                      { value: '', label: 'Select a person' },
                      ...groupMembers.map((m) => ({ value: m.userId, label: m.username })),
                    ]}
                    value={form.splitUserId}
                    onChange={(e) => setForm((f) => ({ ...f, splitUserId: e.target.value }))}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    min="1"
                    max="99"
                    step="1"
                    className="w-20"
                    value={form.splitPercent}
                    onChange={(e) => setForm((f) => ({ ...f, splitPercent: e.target.value }))}
                    aria-label="Their share %"
                  />
                  <span className="text-sm text-fg-subtle">%</span>
                </div>
              )}
              {splitOn && form.splitUserId && (
                <p className="mt-1 text-xs text-fg-subtle">
                  You pay {Math.max(0, 100 - percentNum)}% · {partner?.username ?? 'they'} pay{partner ? 's' : ''} {percentNum}%
                </p>
              )}
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving} data-testid="rule-save">
            {saving ? 'Saving…' : 'Save rule'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
