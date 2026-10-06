import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Plus, Search as SearchIcon, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ConfirmDeleteModal } from '@/components/ui/ConfirmDeleteModal'
import { EmptyState } from '@/components/ui/EmptyState'
import { useWallet, mapTransaction, type TransactionRow } from '@/hooks/useWallet'
import { api } from '@/lib/api'
import { useCrudModal } from '@/hooks/useCrudModal'
import { useWalletStore } from '@/stores/wallet.store'
import { useToastStore } from '@/stores/toast.store'
import { formatMYR, errorMessage, todayISO } from '@/lib/utils'
import { format, parseISO } from 'date-fns'
import { shiftMonth } from '@/modules/wallet/dashboard/insights'
import { RecurringBand } from '@/modules/wallet/recurring/RecurringBand'
import { WorthALook } from '@/modules/wallet/recurring/WorthALook'
import { RecurringCalendar } from '@/modules/wallet/recurring/RecurringCalendar'
import { RecurringTable } from '@/modules/wallet/recurring/RecurringTable'
import { RecurringFormModal, type RecurringFormData } from '@/modules/wallet/recurring/RecurringFormModal'
import { DetectFromHistoryModal } from '@/modules/wallet/recurring/DetectFromHistoryModal'
import {
  incomeBaseline, activeIncomeMonthlyEquivalent, priceRises as computePriceRises,
  costliestNudge, sameDayCollision, worthALookRows, detectCandidates, lockedIn,
  type DetectCandidate,
} from '@/modules/wallet/recurring/insights'
import type { RecurringTransaction, Transaction, TransactionType } from '@/types/wallet.types'

export function RecurringPage() {
  const {
    recurringTransactions,
    accounts,
    categories,
    loadRecurringTransactions,
    loadAccounts,
    loadCategories,
    addRecurringTransaction,
    updateRecurringTransaction,
    deleteRecurringTransaction,
    postRecurringNow,
  } = useWallet()
  const { addToast } = useToastStore()
  const invalidate = useWalletStore((s) => s.invalidate)

  const crud = useCrudModal<RecurringTransaction>()
  const [updatingRuleId, setUpdatingRuleId] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [detectOpen, setDetectOpen] = useState(false)
  const [form, setForm] = useState<RecurringFormData>({
    accountId: '',
    amount: '',
    merchant: '',
    type: 'expense',
    categoryId: '',
    frequency: 'monthly',
    nextDueDate: '',
  })

  const today = todayISO()
  const monthName = format(parseISO(today), 'MMMM')
  const monthAbbr = format(parseISO(today), 'MMM')

  useEffect(() => {
    loadRecurringTransactions()
    loadAccounts()
    loadCategories()
  }, [loadRecurringTransactions, loadAccounts, loadCategories])

  // Recurring rules auto-post, so they stay own-accounts-only — never offer a
  // shared-in account the server would reject at posting time.
  const ownAccounts = useMemo(() => accounts.filter((a) => !a.isShared), [accounts])
  const ownAccountIds = useMemo(() => new Set(ownAccounts.map((a) => a.id)), [ownAccounts])

  // Page-local history fetch (FEAT-068 "Data loading") — NOT through
  // useWallet().loadTransactions, same reasoning as GoalsPage's
  // reloadMonthTxns: this is a page-local figure, not the shared transaction
  // list every other wallet page reads from. Feeds the income baseline,
  // price rise (a) and Detect from history. `null` means "unavailable"
  // (not yet loaded, or the fetch failed) — never treated as zero rows.
  //
  // Fetched ONCE, keyed only on `today` — storing the raw (unfiltered)
  // mapped rows and deriving own-account rows in a separate useMemo below.
  // Keying the fetch itself on `ownAccountIds` caused a race + a double
  // fetch: that Set's identity changes on every `accounts` reference change
  // even when its contents don't, re-triggering the effect. A request
  // counter still guards against an in-flight older request overwriting a
  // newer one if `today` ever changes mid-flight (e.g. crossing midnight).
  const [allTxns, setAllTxns] = useState<Transaction[] | null>(null)
  const [historyFailed, setHistoryFailed] = useState(false)
  const historyRequestRef = useRef(0)

  const reloadHistory = useCallback(() => {
    const dateFrom = `${shiftMonth(today.slice(0, 7), -6)}-01`
    const qs = new URLSearchParams({ dateFrom, dateTo: today })
    const requestId = ++historyRequestRef.current
    api.get<TransactionRow[]>(`/transactions?${qs.toString()}`)
      .then((rows) => {
        if (historyRequestRef.current !== requestId) return // superseded by a later request
        setAllTxns(rows.map(mapTransaction))
        setHistoryFailed(false)
      })
      .catch((err) => {
        if (historyRequestRef.current !== requestId) return
        setAllTxns(null)
        setHistoryFailed(true)
        addToast({ message: errorMessage(err, 'Could not load transaction history — some Recurring figures may be unavailable.'), duration: 4000 })
      })
  }, [today, addToast])

  useEffect(() => {
    reloadHistory()
  }, [reloadHistory])

  const ownTxns = useMemo(() => {
    if (allTxns === null) return null
    return allTxns.filter((t) => ownAccountIds.has(t.accountId))
  }, [allTxns, ownAccountIds])

  // Categories valid for the rule's direction (income/expense + 'both').
  const categoryOptions = useMemo(
    () =>
      categories
        .filter((c) => c.type === form.type || c.type === 'both')
        .map((c) => ({ value: c.id, label: c.name })),
    [categories, form.type],
  )

  const openCreate = useCallback((prefill?: Partial<RecurringFormData>) => {
    setForm({
      accountId: ownAccounts[0]?.id ?? '',
      amount: '',
      merchant: '',
      type: 'expense',
      categoryId: '',
      frequency: 'monthly',
      nextDueDate: todayISO(),
      ...prefill,
    })
    setFormError(null)
    crud.openCreate()
  }, [crud, ownAccounts])

  const openEdit = useCallback((rule: RecurringTransaction) => {
    setForm({
      accountId: rule.accountId,
      amount: String(rule.amount),
      merchant: rule.merchant,
      type: rule.type === 'income' ? 'income' : 'expense',
      categoryId: rule.categoryId ?? '',
      frequency: rule.frequency,
      nextDueDate: rule.nextDueDate,
    })
    setFormError(null)
    crud.openEdit(rule)
  }, [crud])

  const handleSubmit = useCallback(async () => {
    const amount = parseFloat(form.amount)
    if (!form.accountId) { setFormError('Choose an account.'); return }
    if (isNaN(amount) || amount <= 0) { setFormError('Enter an amount greater than 0.'); return }
    if (!form.nextDueDate) { setFormError('Pick the next due date.'); return }
    setFormError(null)
    setSaving(true)
    const categoryId = form.categoryId || null
    try {
      if (crud.editingItem) {
        await updateRecurringTransaction(crud.editingItem.id, {
          amount,
          merchant: form.merchant,
          type: form.type,
          categoryId,
          frequency: form.frequency,
          nextDueDate: form.nextDueDate,
        })
      } else {
        await addRecurringTransaction({
          accountId: form.accountId,
          amount,
          merchant: form.merchant,
          type: form.type,
          categoryId,
          frequency: form.frequency,
          nextDueDate: form.nextDueDate,
        })
        // A new rule (whether from "Add recurring" or a Detect candidate)
        // can change which merchants still look like unregistered repeats —
        // refresh history so Detect's candidate list reflects it.
        reloadHistory()
      }
      crud.closeForm(false)
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not save recurring rule — please try again.'), duration: 4000 })
    } finally {
      setSaving(false)
    }
  }, [form, crud, addRecurringTransaction, updateRecurringTransaction, addToast, reloadHistory])

  const handlePostNow = useCallback(async (rule: RecurringTransaction) => {
    try {
      await postRecurringNow(rule.id)
      const account = accounts.find((a) => a.id === rule.accountId)
      addToast({
        message: `Posted ${formatMYR(rule.amount)}${rule.merchant ? ` · ${rule.merchant}` : ''}${account ? ` → ${account.name}` : ''}`,
        duration: 3500,
      })
      invalidate()
      // A fresh posting changes the own-account transaction history that
      // feeds price rise (a) and Detect — refresh it too.
      reloadHistory()
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not post this recurring rule — it may be paused.'), duration: 4000 })
    }
  }, [postRecurringNow, addToast, accounts, invalidate, reloadHistory])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteRecurringTransaction(id)
      crud.closeDelete()
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not delete recurring rule — please try again.'), duration: 4000 })
    }
  }, [deleteRecurringTransaction, crud, addToast])

  const handleTogglePause = useCallback(async (rule: RecurringTransaction) => {
    const next = !rule.paused
    try {
      await updateRecurringTransaction(rule.id, { paused: next })
      addToast({
        message: next
          ? `Paused ${rule.merchant || 'recurring rule'}.`
          : `Resumed ${rule.merchant || 'recurring rule'}${rule.nextDueDate < today ? ' — the next run will catch up any missed charges.' : '.'}`,
        duration: 3500,
      })
      // Pausing/resuming changes which rules count toward the band/Worth-a-
      // look figures — refresh history so they stay consistent.
      reloadHistory()
    } catch (err) {
      addToast({ message: errorMessage(err, `Could not ${next ? 'pause' : 'resume'} this recurring rule — please try again.`), duration: 4000 })
    }
  }, [updateRecurringTransaction, addToast, today, reloadHistory])

  const handleUpdateRuleAmount = useCallback(async (rule: RecurringTransaction, newAmount: number) => {
    setUpdatingRuleId(rule.id)
    try {
      await updateRecurringTransaction(rule.id, { amount: newAmount })
      addToast({ message: `Updated ${rule.merchant || 'recurring rule'} to ${formatMYR(newAmount)}.`, duration: 3500 })
      reloadHistory()
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not update this rule — please try again.'), duration: 4000 })
    } finally {
      setUpdatingRuleId(null)
    }
  }, [updateRecurringTransaction, addToast, reloadHistory])

  // ── Derived figures (FEAT-068 "Stated rules") ──────────────────

  const ownIncomeTxns = useMemo(() => ownTxns ?? [], [ownTxns])
  const income = useMemo(() => {
    const baseline = incomeBaseline(ownIncomeTxns, today)
    if (baseline > 0) return baseline
    return activeIncomeMonthlyEquivalent(recurringTransactions)
  }, [ownIncomeTxns, today, recurringTransactions])

  const rises = useMemo(
    () => computePriceRises(recurringTransactions, ownIncomeTxns, today),
    [recurringTransactions, ownIncomeTxns, today],
  )
  const nudge = useMemo(() => costliestNudge(recurringTransactions, today), [recurringTransactions, today])
  const collision = useMemo(() => sameDayCollision(recurringTransactions, today), [recurringTransactions, today])
  const lookRows = useMemo(() => worthALookRows(rises, collision, nudge), [rises, collision, nudge])

  const candidates: DetectCandidate[] | null = useMemo(() => {
    if (ownTxns === null) return null
    return detectCandidates(ownTxns, recurringTransactions, today)
  }, [ownTxns, recurringTransactions, today])

  const handleAddCandidate = useCallback((candidate: DetectCandidate) => {
    setDetectOpen(false)
    openCreate({
      accountId: candidate.accountId,
      amount: String(candidate.amount),
      merchant: candidate.merchant,
      type: 'expense' as TransactionType,
      categoryId: candidate.categoryId ?? '',
      frequency: 'monthly',
      nextDueDate: candidate.nextDueDate,
    })
  }, [openCreate])

  const activeCount = recurringTransactions.filter((r) => !r.paused).length
  const lockedInMonthly = useMemo(() => lockedIn(recurringTransactions), [recurringTransactions])

  return (
    <div className="mx-auto max-w-6xl">
      <div className="page-head">
        <h2 className="page-title">Recurring</h2>
        <span className="page-sub hide-mobile" data-testid="recurring-subtitle">
          {activeCount} active · {formatMYR(lockedInMonthly)} a month
        </span>
        <div className="page-actions">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              // Retry a previously failed history load whenever Detect is
              // reopened — the user is asking us to try the scan again.
              if (historyFailed) reloadHistory()
              setDetectOpen(true)
            }}
          >
            <SearchIcon className="h-3.5 w-3.5" />
            Detect from history
          </Button>
          <Button size="sm" onClick={() => openCreate()}>
            <Plus className="h-3.5 w-3.5" />
            Add recurring
          </Button>
        </div>
      </div>

      {recurringTransactions.length === 0 ? (
        <EmptyState
          icon={<RefreshCw className="h-10 w-10" />}
          title="No scheduled rules yet"
          description="No recurring transactions. Set up repeating rules for regular bills, subscriptions, or income — they post automatically on their due date."
        />
      ) : (
        <div className="dash">
          <RecurringBand
            rules={recurringTransactions}
            categories={categories}
            income={income}
            today={today}
            monthLabel={monthAbbr}
            priceRises={rises}
            historyUnavailable={ownTxns === null}
            historyFailed={historyFailed}
          />
          <WorthALook
            rows={lookRows}
            onUpdateRule={handleUpdateRuleAmount}
            updatingRuleId={updatingRuleId}
            onReview={openEdit}
          />
          <RecurringCalendar rules={recurringTransactions} categories={categories} today={today} monthName={monthName} />
          <RecurringTable
            rules={recurringTransactions}
            accounts={accounts}
            categories={categories}
            priceRises={rises}
            today={today}
            onPostNow={handlePostNow}
            onEdit={openEdit}
            onTogglePause={handleTogglePause}
            onDelete={(rule) => crud.openDelete(rule.id)}
          />
        </div>
      )}

      <RecurringFormModal
        open={crud.formOpen}
        onOpenChange={crud.closeForm}
        isEdit={!!crud.editingItem}
        form={form}
        setForm={setForm}
        accounts={ownAccounts}
        categoryOptions={categoryOptions}
        formError={formError}
        saving={saving}
        onSubmit={handleSubmit}
      />

      <DetectFromHistoryModal
        open={detectOpen}
        onOpenChange={setDetectOpen}
        candidates={candidates}
        historyFailed={historyFailed}
        onAdd={handleAddCandidate}
      />

      <ConfirmDeleteModal
        open={!!crud.confirmDeleteId}
        onOpenChange={(open) => { if (!open) crud.closeDelete() }}
        title="Delete recurring rule?"
        description="This will remove the recurring rule. Existing transactions are not affected."
        onConfirm={() => crud.confirmDeleteId && handleDelete(crud.confirmDeleteId)}
      />
    </div>
  )
}
