import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, CreditCard } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDeleteModal } from '@/components/ui/ConfirmDeleteModal'
import { NetWorthBanner } from '@/components/ui/NetWorthBanner'
import { AccountCard } from '@/modules/wallet/AccountCard'
import { AccountForm } from '@/modules/wallet/AccountForm'
import { useWallet } from '@/hooks/useWallet'
import { useWalletStore } from '@/stores/wallet.store'
import { useToastStore } from '@/stores/toast.store'
import { useCrudModal } from '@/hooks/useCrudModal'
import { errorMessage } from '@/lib/utils'
import type { AccountFormData } from '@/modules/wallet/AccountForm'
import type { Account } from '@/types/wallet.types'

export function AccountsPage() {
  const { accounts, loadAccounts, addAccount, updateAccount, deleteAccount, getAccountBalances } = useWallet()
  const { addToast } = useToastStore()

  const crud = useCrudModal<Account>()
  const [balances, setBalances] = useState<Record<string, number> | null>(null)
  const dataVersion = useWalletStore((s) => s.dataVersion)

  useEffect(() => { loadAccounts() }, [loadAccounts, dataVersion])

  // §1.4: one batched balances call feeds both the net-worth banner and every
  // card (passed down as props) — no per-card fan-out. Refetches whenever the
  // accounts list changes (edits, incl. openingBalance, replace the array).
  useEffect(() => {
    let cancelled = false
    getAccountBalances().then((b) => {
      if (!cancelled) setBalances(b)
    })
    return () => { cancelled = true }
  }, [accounts, getAccountBalances])

  // With no accounts the reduce over [] yields 0, so the empty case needs no
  // special handling.
  const netWorth = useMemo(
    () => (balances === null ? null : accounts.reduce((sum, a) => sum + (balances[a.id] ?? 0), 0)),
    [accounts, balances],
  )

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
    <div className="max-w-5xl mx-auto">
      {/* Page sub-header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Accounts</h2>
          <p className="text-xs text-gray-500 mt-0.5">Manage your accounts and balances</p>
        </div>
        <Button size="sm" onClick={crud.openCreate}>
          <Plus className="h-3.5 w-3.5" />
          Add Account
        </Button>
      </div>

      {/* Net worth banner */}
      {accounts.length > 0 && (
        <NetWorthBanner netWorth={netWorth} accountCount={accounts.length} className="mb-5" />
      )}

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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              balance={balances?.[account.id] ?? null}
              onEdit={crud.openEdit}
              onDelete={(a) => crud.openDelete(a.id)}
              onShare={crud.openEdit}
            />
          ))}
        </div>
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
