import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Globe, Tag, Upload } from 'lucide-react'
import { useWallet } from '@/hooks/useWallet'
import { Button } from '@/components/ui/Button'
import { CategoryManager } from '@/modules/wallet/CategoryManager'
import { CaptureCardMap } from '../CaptureCardMap'

/**
 * Settings → Wallet: card-to-account mapping, category management, the
 * import/merchant-cleanup entry points, and the static MYR currency line.
 * Moved out of the old monolithic SettingsPage (module-based settings) with
 * no behaviour change — same testids. The "Import CSV" button mirrors
 * exactly what AccountMenu's own Import CSV row does
 * (`navigate('/wallet', { state: { openImport: true } })`), since both
 * routes to the same CSV-import entry point.
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
        <CaptureCardMap />

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
