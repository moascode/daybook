import { useState, useEffect, useCallback, useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import { Plus, CreditCard, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDeleteModal } from '@/components/ui/ConfirmDeleteModal'
import { AccountCard } from '@/modules/wallet/AccountCard'
import { AccountForm } from '@/modules/wallet/AccountForm'
import { BalanceSummary } from '@/modules/wallet/accounts/BalanceSummary'
import { NetWorthHistoryChart } from '@/modules/wallet/accounts/NetWorthHistoryChart'
import {
  computeComposition, computeMonthlyNetWorth, accountBalanceAsOf, accountMonthChange, accountLastActivityDate,
  sparklinePath,
} from '@/modules/wallet/accounts/insights'
import { monthBounds, monthKey, shiftMonth } from '@/modules/wallet/dashboard/insights'
import { useWallet } from '@/hooks/useWallet'
import { useWalletStore } from '@/stores/wallet.store'
import { useToastStore } from '@/stores/toast.store'
import { useCrudModal } from '@/hooks/useCrudModal'
import { errorMessage, todayISO } from '@/lib/utils'
import type { AccountFormData } from '@/modules/wallet/AccountForm'
import type { Account, Transaction } from '@/types/wallet.types'

export function AccountsPage() {
  const { accounts, loadAccounts, addAccount, updateAccount, deleteAccount, getAccountBalances, loadTransactions } = useWallet()
  const { addToast } = useToastStore()

  const crud = useCrudModal<Account>()
  // Share/edit/delete stay hidden on the cards themselves — matching the
  // mockup's plain `.acct` cards, which carry no action icons at all — until
  // "Manage" is toggled on. Local UI state only; not persisted or synced.
  const [manageMode, setManageMode] = useState(false)
  const [balances, setBalances] = useState<Record<string, number> | null>(null)
  const [allTxns, setAllTxns] = useState<Transaction[]>([])
  const dataVersion = useWalletStore((s) => s.dataVersion)

  useEffect(() => { loadAccounts() }, [loadAccounts, dataVersion])

  // §1.4: one batched balances call feeds both the summary card and every
  // card (passed down as props) — no per-card fan-out. Refetches whenever the
  // accounts list changes (edits, incl. openingBalance, replace the array).
  useEffect(() => {
    let cancelled = false
    getAccountBalances().then((b) => {
      if (!cancelled) setBalances(b)
    })
    return () => { cancelled = true }
  }, [accounts, getAccountBalances])

  // All-time transaction history, needed to reconstruct real past balances
  // for the net-worth chart — never a date-ranged slice.
  useEffect(() => {
    let cancelled = false
    loadTransactions({ dateFrom: '', dateTo: '' }).then((t) => {
      if (!cancelled) setAllTxns(t)
    })
    return () => { cancelled = true }
  }, [loadTransactions, dataVersion])

  // Net worth is what YOU own. `accounts` also carries shared-in accounts —
  // a co-member's account, visible through a group — and folding those into
  // the total reported their money as ours (a partner's RM9,999 current
  // account read straight into our net worth). Their cards still show, with
  // their real balance; only the total is ours alone.
  //
  // With no owned accounts the reduce over [] yields 0, so the empty case
  // needs no special handling.
  const ownAccounts = useMemo(() => accounts.filter((a) => !a.isShared), [accounts])

  const netWorth = useMemo(
    () => (balances === null ? null : ownAccounts.reduce((sum, a) => sum + (balances[a.id] ?? 0), 0)),
    [ownAccounts, balances],
  )

  const composition = useMemo(
    () => (balances === null ? [] : computeComposition(ownAccounts, balances)),
    [ownAccounts, balances],
  )

  // Real month-to-date movement — the chip + "since 1 <Month>" line on the
  // summary card, matching the mockup's own figure-meta layout. Reconstructed
  // from the ledger, not fabricated: net worth now vs. net worth at the end
  // of last month, using the same balance formula the server uses for "now".
  // Omitted (null) unless every own account already existed by then — an
  // account created mid-month has no honest "balance last month".
  const netWorthChange = useMemo(() => {
    if (netWorth === null || ownAccounts.length === 0) return null
    const currentMonth = monthKey(todayISO())
    const prevMonth = shiftMonth(currentMonth, -1)
    const allExistedLastMonth = ownAccounts.every((a) => monthKey(a.createdAt) <= prevMonth)
    if (!allExistedLastMonth) return null
    const endOfLastMonth = monthBounds(prevMonth).to
    const priorNetWorth = ownAccounts.reduce((sum, a) => sum + accountBalanceAsOf(a, allTxns, endOfLastMonth), 0)
    const amount = netWorth - priorNetWorth
    const percent = Math.abs(priorNetWorth) >= 0.005 ? (amount / Math.abs(priorNetWorth)) * 100 : null
    const sinceLabel = format(parseISO(`${currentMonth}-01`), "d MMMM")
    return { amount, percent, sinceLabel }
  }, [netWorth, ownAccounts, allTxns])

  const netWorthHistory = useMemo(
    () => computeMonthlyNetWorth(ownAccounts, allTxns, todayISO()),
    [ownAccounts, allTxns],
  )

  // Per-card foot-row stats — real, reconstructed from the ledger (never the
  // fabricated "+$412 this month" the mockup shows), so every account gets
  // one whether it's owned or shared-in.
  const monthChanges = useMemo(() => {
    const map = new Map<string, ReturnType<typeof accountMonthChange>>()
    if (balances === null) return map
    for (const a of accounts) map.set(a.id, accountMonthChange(a, allTxns, balances[a.id] ?? 0, todayISO()))
    return map
  }, [accounts, allTxns, balances])

  const lastActivityDates = useMemo(() => {
    const map = new Map<string, string | null>()
    for (const a of accounts) map.set(a.id, accountLastActivityDate(a, allTxns))
    return map
  }, [accounts, allTxns])

  // Per-account sparkline — real month-end balances (the same reconstruction
  // the net-worth chart uses, just scoped to one account instead of summed
  // across the household) rather than the mockup's decorative hand-drawn line.
  const sparklines = useMemo(() => {
    const map = new Map<string, string>()
    const today = todayISO()
    for (const a of accounts) {
      const history = computeMonthlyNetWorth([a], allTxns, today).map((p) => p.value)
      map.set(a.id, sparklinePath(history))
    }
    return map
  }, [accounts, allTxns])

  // The one card that gets the mockup's dark `.acct-feature` treatment —
  // same rule Overview uses for its featured account (highest balance among
  // OWN accounts; a shared-in account is never featured here).
  const featuredAccountId = useMemo(() => {
    if (balances === null || ownAccounts.length === 0) return null
    return [...ownAccounts].sort((a, b) => (balances[b.id] ?? 0) - (balances[a.id] ?? 0))[0].id
  }, [ownAccounts, balances])

  const handleAdd = useCallback(async (data: AccountFormData) => {
    try {
      await addAccount(data)
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not create account — please try again.'), duration: 4000 })
      throw err // keep the form open so the user can retry
    }
  }, [addAccount, addToast])

  const handleEdit = useCallback(async (data: AccountFormData) => {
    if (!crud.editingItem) return
    try {
      await updateAccount(crud.editingItem.id, data)
      crud.closeForm(false)
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not save account — please try again.'), duration: 4000 })
      throw err
    }
  }, [crud, updateAccount, addToast])

  const handleDelete = useCallback(async () => {
    if (!crud.confirmDeleteId) return
    try {
      await deleteAccount(crud.confirmDeleteId)
      crud.closeDelete()
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not delete account — please try again.'), duration: 4000 })
    }
  }, [crud, deleteAccount, addToast])

  const deleteTargetAccount = accounts.find((a) => a.id === crud.confirmDeleteId) ?? null

  return (
    <div className="mx-auto max-w-5xl">
      <div className="page-head">
        <h1 className="page-title">Accounts</h1>
        <span className="page-sub hide-mobile">
          {accounts.length} account{accounts.length !== 1 ? 's' : ''}
        </span>
        <div className="page-actions">
          <Button size="sm" onClick={crud.openCreate}>
            <Plus className="h-3.5 w-3.5" />
            Add Account
          </Button>
        </div>
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          icon={<CreditCard className="h-10 w-10" />}
          title="No accounts yet"
          description="Create your first account to start tracking your finances."
          action={
            <Button size="sm" onClick={crud.openCreate}>
              <Plus className="h-3.5 w-3.5" /> Add Account
            </Button>
          }
        />
      ) : (
        <>
          {ownAccounts.length > 0 && (
            <div className="mb-5">
              <BalanceSummary
                netWorth={netWorth}
                accountCount={ownAccounts.length}
                netWorthChange={netWorthChange}
                composition={composition}
              />
            </div>
          )}

          <section className="section" style={{ marginTop: 0 }}>
            <div className="section-head">
              <h2 className="section-title">Your accounts</h2>
              {/* .section-action, not .page-actions — the latter is hidden below 680px
                  (replaced by the FAB, which only handles Add), so a toggle placed there
                  would be completely unreachable on mobile. This spot has no such rule. */}
              <button
                type="button"
                className="section-action"
                aria-pressed={manageMode}
                style={manageMode ? { color: 'rgb(var(--accent))' } : undefined}
                onClick={() => setManageMode((m) => !m)}
              >
                <Settings2 className="h-3.5 w-3.5" />
                Manage
              </button>
            </div>
            <div className="grid g3 g-1-on-mobile">
              {accounts.map((account) => (
                <AccountCard
                  key={account.id}
                  account={account}
                  balance={balances?.[account.id] ?? null}
                  onEdit={crud.openEdit}
                  onDelete={(a) => crud.openDelete(a.id)}
                  onShare={crud.openEdit}
                  featured={account.id === featuredAccountId}
                  showActions={manageMode}
                  monthChange={monthChanges.get(account.id) ?? null}
                  lastActivityDate={lastActivityDates.get(account.id) ?? null}
                  sparklinePath={sparklines.get(account.id) ?? ''}
                />
              ))}
              <button type="button" className="acct add" onClick={crud.openCreate}>
                <Plus className="h-6 w-6" />
                Add another account
              </button>
            </div>
          </section>

          <NetWorthHistoryChart points={netWorthHistory} />
        </>
      )}

      <AccountForm
        open={crud.formOpen}
        onOpenChange={crud.closeForm}
        account={crud.editingItem}
        onSubmit={crud.editingItem ? handleEdit : handleAdd}
      />

      <ConfirmDeleteModal
        open={!!crud.confirmDeleteId}
        onOpenChange={(open) => { if (!open) crud.closeDelete() }}
        title="Delete account?"
        description={`Are you sure you want to delete "${deleteTargetAccount?.name}"? All transactions in this account will be permanently deleted.`}
        onConfirm={handleDelete}
        confirmLabel="Delete account"
      />
    </div>
  )
}
