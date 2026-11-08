import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Select } from '@/components/ui/Select'
import { useWallet } from '@/hooks/useWallet'
import { useAppStore } from '@/stores/app.store'
import { api } from '@/lib/api'
import { cn, errorMessage, formatMYR } from '@/lib/utils'
import { ImportModal, type ImportReadyMeta } from '../import/ImportModal'
import { accountLabel, batchTitle, batchWhen, mapImportBatch } from './importBatch'
import type { ImportRow } from '@/lib/csv'
import type { ImportBatch } from '@/types/wallet.types'

/**
 * Wallet → Imports: start an import, and every past import as a batch — the
 * place to catch (and fix, from the batch page) a statement that went into
 * the wrong account.
 */
export function ImportsPage() {
  const navigate = useNavigate()
  const { accounts, categories, loadAccounts, loadCategories } = useWallet()
  const hasAnthropicKey = useAppStore((s) => s.hasAnthropicKey)
  const [batches, setBatches] = useState<ImportBatch[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [accountId, setAccountId] = useState('')

  const importableAccounts = accounts.filter((a) => !a.isShared || a.canWrite === 1)
  if (importableAccounts.length > 0 && !accountId) setAccountId(importableAccounts[0].id)

  const loadBatches = useCallback(() => {
    api
      .get<Record<string, unknown>[]>('/imports')
      .then((rows) => {
        setBatches(rows.map(mapImportBatch))
        setLoadError(null)
      })
      .catch((err: unknown) => setLoadError(errorMessage(err, "Couldn't load your import history.")))
  }, [])

  useEffect(() => {
    loadAccounts()
    loadCategories()
    loadBatches()
  }, [loadAccounts, loadCategories, loadBatches])

  const handleReady = useCallback(
    (rows: ImportRow[], meta?: ImportReadyMeta) => {
      navigate('/wallet/import', { state: { rows, ...meta, accountId } })
    },
    [navigate, accountId],
  )

  return (
    <div className="content pb-24">
      <div className="page-head">
        <h1 className="page-title">Imports</h1>
      </div>

      <section className="mb-6 flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 sm:flex-row">
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          data-testid="imports-start"
          className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-line-strong bg-canvas px-4 py-8 text-center transition-colors hover:bg-surface-hover"
        >
          <Upload className="h-6 w-6 text-fg-faint" aria-hidden="true" />
          <span className="text-sm text-fg-muted">
            <b className="font-semibold text-fg">Import a CSV or statement photos</b>
          </span>
          <span className="text-xs text-fg-faint">CSV, or photos of a statement or receipt</span>
        </button>
        <div className="sm:w-64">
          <Select
            id="imports-account"
            label="Import into"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            options={importableAccounts.map((a) => ({ value: a.id, label: accountLabel(a.name, a.last4) }))}
          />
        </div>
      </section>

      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="text-base font-semibold text-fg">History</h2>
        {batches && batches.length > 0 && (
          <span className="text-sm text-fg-subtle">
            {batches.length} import{batches.length !== 1 ? 's' : ''} ·{' '}
            {batches.reduce((n, b) => n + b.rowCount, 0)} transactions
          </span>
        )}
      </div>

      {loadError ? (
        <div className="notice notice-fail" data-testid="imports-load-error">
          <div><div className="notice-title">{loadError}</div></div>
          <Button variant="secondary" size="sm" className="ml-auto flex-shrink-0" onClick={loadBatches}>Retry</Button>
        </div>
      ) : batches === null ? (
        <p className="text-sm text-fg-subtle">Loading…</p>
      ) : batches.length === 0 ? (
        <EmptyState
          title="No imports yet"
          description="Imports you make from here on are listed with their account, so a wrong one can be moved in one go."
        />
      ) : (
        <ul className="rounded-xl border border-line bg-surface p-2" data-testid="imports-list">
          {batches.map((b) => (
            <li key={b.id} className="border-t border-line-subtle first:border-t-0">
              <button
                type="button"
                data-testid="import-batch-row"
                onClick={() => navigate(`/wallet/imports/${b.id}`)}
                className="grid w-full grid-cols-[40px_1fr_auto] items-center gap-3 rounded-lg px-2 py-3 text-left hover:bg-surface-hover sm:grid-cols-[40px_1fr_200px_72px_120px_16px]"
              >
                <span
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-lg text-[10px] font-bold tracking-wide',
                    b.kind === 'photo' ? 'bg-violet-50 text-violet-700' : 'bg-brand-50 text-brand-700',
                  )}
                  aria-hidden="true"
                >
                  {b.kind === 'photo' ? 'IMG' : 'CSV'}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-fg">{batchTitle(b)}</span>
                  <span className="flex items-center gap-1.5 text-xs text-fg-subtle">
                    {batchWhen(b)}
                    {b.movedAt && <span className="rounded bg-sky-50 px-1.5 py-0.5 font-medium text-sky-700">Moved</span>}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-muted sm:hidden">
                    <AccountDot color={b.accountColor} />
                    {accountLabel(b.accountName, b.accountLast4)}
                  </span>
                </span>
                <span className="hidden items-center gap-1.5 text-sm text-fg-muted sm:flex" data-testid="import-batch-account">
                  <AccountDot color={b.accountColor} />
                  {accountLabel(b.accountName, b.accountLast4)}
                </span>
                <span className="hidden text-right text-xs text-fg-subtle sm:block">{b.rowCount} rows</span>
                <span className={cn('text-right text-sm font-semibold', b.net > 0 ? 'text-green-700' : 'text-fg')}>
                  {b.net > 0 ? '+' : ''}{formatMYR(b.net)}
                </span>
                <ChevronRight className="hidden h-4 w-4 text-fg-faint sm:block" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ImportModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        accounts={importableAccounts}
        categories={categories}
        hasAnthropicKey={hasAnthropicKey}
        onReady={handleReady}
      />
    </div>
  )
}

export function AccountDot({ color }: { color: string }) {
  return <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
}
