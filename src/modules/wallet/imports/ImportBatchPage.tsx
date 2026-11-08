import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeftRight, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ConfirmDeleteModal } from '@/components/ui/ConfirmDeleteModal'
import { EmptyState } from '@/components/ui/EmptyState'
import { mapTransaction, useWallet } from '@/hooks/useWallet'
import { useToastStore } from '@/stores/toast.store'
import { api } from '@/lib/api'
import { errorMessage, formatMYR } from '@/lib/utils'
import { TransactionList } from '../TransactionList'
import { MoveImportDialog } from './MoveImportDialog'
import { AccountDot } from './ImportsPage'
import { accountLabel, batchTitle, batchWhen, dateSpan, mapImportBatch } from './importBatch'
import type { TransactionRow } from '@/hooks/useWallet'
import type { ImportBatch, Transaction } from '@/types/wallet.types'

/** One import: its account up front, with move and undo, then its rows. */
export function ImportBatchPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { accounts, categories, loadAccounts, loadCategories, loadTransactions } = useWallet()
  const { addToast } = useToastStore()
  const [batch, setBatch] = useState<ImportBatch | null>(null)
  const [rows, setRows] = useState<Transaction[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const [moving, setMoving] = useState(false)
  const [undoOpen, setUndoOpen] = useState(false)

  const load = useCallback(() => {
    Promise.all([
      api.get<Record<string, unknown>>(`/imports/${id}`),
      api.get<TransactionRow[]>(`/transactions?importBatchId=${encodeURIComponent(id)}`),
    ])
      .then(([b, txs]) => {
        setBatch(mapImportBatch(b))
        setRows(txs.map(mapTransaction))
        setLoadError(null)
      })
      .catch((err: unknown) => setLoadError(errorMessage(err, "Couldn't load this import.")))
  }, [id])

  useEffect(() => {
    loadAccounts()
    loadCategories()
    load()
  }, [loadAccounts, loadCategories, load])

  const handleMove = useCallback(async (accountId: string) => {
    setMoving(true)
    try {
      const { moved } = await api.post<{ moved: number }>(`/imports/${id}/move`, { accountId })
      const to = accounts.find((a) => a.id === accountId)?.name ?? 'the new account'
      addToast({ message: `Moved ${moved} transaction${moved !== 1 ? 's' : ''} to ${to}.`, duration: 4000 })
      setMoveOpen(false)
      load()
      // Balances and the Transactions page read the store; refresh it too.
      loadAccounts()
      loadTransactions()
    } catch (err) {
      addToast({ message: errorMessage(err, "Couldn't move this import — nothing was changed."), duration: 6000 })
    } finally {
      setMoving(false)
    }
  }, [id, accounts, addToast, load, loadAccounts, loadTransactions])

  const handleUndo = useCallback(async () => {
    try {
      const { deleted } = await api.delete<{ deleted: number }>(`/imports/${id}`)
      addToast({ message: `Removed ${deleted} imported transaction${deleted !== 1 ? 's' : ''}.`, duration: 4000 })
      loadAccounts()
      loadTransactions()
      navigate('/wallet/imports')
    } catch (err) {
      addToast({ message: errorMessage(err, "Couldn't undo this import — nothing was deleted."), duration: 6000 })
    }
  }, [id, addToast, loadAccounts, loadTransactions, navigate])

  const back = (
    <Button variant="ghost" size="sm" className="mb-3 -ml-2" onClick={() => navigate('/wallet/imports')}>
      <ChevronLeft className="h-4 w-4" aria-hidden="true" /> All imports
    </Button>
  )

  if (loadError) {
    return (
      <div className="content">
        {back}
        <EmptyState title="Couldn't load this import" description={loadError} action={<Button size="sm" onClick={load}>Retry</Button>} />
      </div>
    )
  }
  if (!batch) return <p className="content text-sm text-fg-subtle">Loading…</p>

  const moneyOut = rows.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const moneyIn = rows.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const moveTargets = accounts.filter((a) => a.id !== batch.accountId && (!a.isShared || a.canWrite === 1))

  return (
    <div className="content pb-24">
      {back}
      <div className="page-head">
        <div className="min-w-0">
          <h1 className="page-title truncate">{batchTitle(batch)}</h1>
          <p className="mt-1 text-sm text-fg-subtle">
            Imported {batchWhen(batch)} · {batch.rowCount} rows
            {batch.dateFrom && batch.dateTo && ` · ${dateSpan(batch.dateFrom, batch.dateTo)}`}
          </p>
        </div>
      </div>

      <section
        className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-surface p-4"
        style={{ borderLeft: `4px solid ${batch.accountColor || 'rgb(var(--line))'}` }}
      >
        <div>
          <p className="text-xs font-medium text-fg-subtle">Imported into</p>
          <p className="flex items-center gap-2 text-lg font-semibold text-fg" data-testid="import-batch-account-name">
            <AccountDot color={batch.accountColor} />
            {accountLabel(batch.accountName, batch.accountLast4)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setMoveOpen(true)} data-testid="move-import-btn">
            <ArrowLeftRight className="h-4 w-4" aria-hidden="true" /> Move to another account
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setUndoOpen(true)} data-testid="undo-import-btn">
            Undo import
          </Button>
        </div>
      </section>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Stat label="Money out" value={formatMYR(moneyOut)} />
        <Stat label="Money in" value={formatMYR(moneyIn)} />
      </div>

      <div className="rounded-xl border border-line bg-surface p-4">
        <TransactionList transactions={rows} accounts={accounts} categories={categories} readOnly showDayTotals />
      </div>

      {moveOpen && (
        <MoveImportDialog
          open
          onOpenChange={setMoveOpen}
          batch={batch}
          accounts={moveTargets}
          moving={moving}
          onMove={(accountId) => void handleMove(accountId)}
        />
      )}
      <ConfirmDeleteModal
        open={undoOpen}
        onOpenChange={setUndoOpen}
        title="Undo this import?"
        description={`Deletes the ${batch.rowCount} transactions this import created, including any you edited since. This can't be undone.`}
        confirmLabel="Undo import"
        confirmTestId="undo-import-confirm"
        onConfirm={() => void handleUndo()}
      />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-xs font-medium text-fg-subtle">{label}</p>
      <p className="mt-1 text-lg font-semibold text-fg">{value}</p>
    </div>
  )
}
