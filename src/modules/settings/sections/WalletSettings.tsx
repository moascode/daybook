import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Globe, Tag, Upload, CreditCard } from 'lucide-react'
import { useWallet } from '@/hooks/useWallet'
import { Button } from '@/components/ui/Button'
import { AccountForm } from '@/modules/wallet/AccountForm'
import { CategoryManager } from '@/modules/wallet/CategoryManager'
import { CaptureCardMap } from '../CaptureCardMap'
import { RulesSettings } from '../RulesSettings'
import type { AccountFormData } from '@/modules/wallet/AccountForm'
import type { Account } from '@/types/wallet.types'

/**
 * Own accounts + their last4, each with an "Add/Edit" link into the real
 * AccountForm (reusing it rather than a bespoke inline-PATCH form, per the
 * spec's "pick the simpler that reuses AccountForm").
 */
function AccountsLast4List() {
  const { accounts, loadAccounts, updateAccount } = useWallet()
  const [editing, setEditing] = useState<Account | null>(null)

  useEffect(() => { loadAccounts() }, [loadAccounts])

  const ownAccounts = accounts.filter((a) => !a.isShared)

  // #10: no toast here — AccountForm itself shows the server's message
  // inline (last4-field or form-level, depending on what it's about) and
  // keeps the dialog open. A toast on top of that said the same thing twice.
  async function handleEdit(data: AccountFormData) {
    if (!editing) return
    await updateAccount(editing.id, data)
  }

  if (ownAccounts.length === 0) return null

  return (
    <div className="mb-4">
      <ul className="divide-y divide-line-subtle border-b border-line-subtle">
        {ownAccounts.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-3 py-2.5" data-testid="account-last4-row">
            <span className="min-w-0 flex-1 truncate text-sm text-fg">
              {a.name}
              {a.last4 && <span className="ml-1.5 text-fg-subtle">••{a.last4}</span>}
            </span>
            <button
              type="button"
              className="flex-shrink-0 text-xs text-brand-600 hover:underline"
              onClick={() => setEditing(a)}
              data-testid="account-last4-edit"
            >
              {a.last4 ? 'Edit' : 'Add last 4 digits'}
            </button>
          </li>
        ))}
      </ul>

      <AccountForm
        open={!!editing}
        onOpenChange={(open) => { if (!open) setEditing(null) }}
        account={editing}
        onSubmit={handleEdit}
      />
    </div>
  )
}

/**
 * Settings → Wallet: cards/account-number mapping and rules, category
 * management, the import/merchant-cleanup entry points, and the static MYR
 * currency line. Moved out of the old monolithic SettingsPage (module-based
 * settings) with no behaviour change to the untouched sections — same testids.
 */
export function WalletSettings() {
  const navigate = useNavigate()
  const { categories, loadCategories, addCategory, deleteCategory, getCategoryUsage } = useWallet()
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false)

  useEffect(() => {
    loadCategories()
  }, [loadCategories])

  return (
    <div className="mx-auto max-w-lg md:mx-0 md:max-w-xl">
      <h1 className="page-title mb-6">Wallet</h1>

      <div className="space-y-5">
        {/* Cards & account numbers — own accounts' last4, then card-name overrides. */}
        <section className="rounded-xl border border-line bg-surface p-5">
          <div className="mb-4 flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-fg-faint" />
            <h3 className="text-sm font-semibold text-fg">Cards &amp; account numbers</h3>
          </div>
          <AccountsLast4List />
          <CaptureCardMap />
        </section>

        <RulesSettings />

        {/* Categories */}
        <section className="rounded-xl border border-line bg-surface p-5">
          <div className="mb-4 flex items-center gap-2">
            <Tag className="h-4 w-4 text-fg-faint" />
            <h3 className="text-sm font-semibold text-fg">Categories</h3>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 text-sm text-fg-muted">
              Categories used across transactions, budgets, and imports.
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCategoryManagerOpen(true)}
              data-testid="manage-categories"
              className="shrink-0 whitespace-nowrap"
            >
              <Tag className="h-3.5 w-3.5" />
              Manage categories
            </Button>
          </div>
        </section>

        {/* Import & data */}
        <section className="rounded-xl border border-line bg-surface p-5">
          <div className="mb-4 flex items-center gap-2">
            <Upload className="h-4 w-4 text-fg-faint" />
            <h3 className="text-sm font-semibold text-fg">Import &amp; data</h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate('/wallet', { state: { openImport: true } })}
              data-testid="wallet-settings-import-csv"
            >
              <Upload className="h-3.5 w-3.5" />
              Import CSV
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate('/wallet/canonicalize-merchants')}
            >
              <Tag className="h-3.5 w-3.5" />
              Merchant names
            </Button>
          </div>
        </section>

        {/* Finance */}
        <section className="rounded-xl border border-line bg-surface p-5">
          <div className="mb-4 flex items-center gap-2">
            <Globe className="h-4 w-4 text-fg-faint" />
            <h3 className="text-sm font-semibold text-fg">Finance</h3>
          </div>
          <p className="text-sm text-fg-muted">
            Currency <span className="font-medium text-fg">Malaysian Ringgit (MYR)</span>
          </p>
          <p className="mt-1 text-xs text-fg-faint">Daybook is single-currency for now.</p>
        </section>
      </div>

      <CategoryManager
        open={categoryManagerOpen}
        onOpenChange={setCategoryManagerOpen}
        categories={categories}
        onAdd={async (data) => { await addCategory(data) }}
        onDelete={async (id) => { await deleteCategory(id) }}
        onGetUsage={getCategoryUsage}
      />
    </div>
  )
}
