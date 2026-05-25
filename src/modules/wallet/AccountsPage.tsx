import { useState, useEffect, useCallback } from 'react'
import { Plus, CreditCard } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { AccountCard } from '@/modules/wallet/AccountCard'
import { AccountForm } from '@/modules/wallet/AccountForm'
import { useWallet } from '@/hooks/useWallet'
import type { AccountFormData } from '@/modules/wallet/AccountForm'
import type { Account } from '@/types/wallet.types'

export function AccountsPage() {
  const {
    accounts,
    loadAccounts,
    addAccount,
    updateAccount,
    deleteAccount,
  } = useWallet()

  const [formOpen, setFormOpen] = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null)

  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  const handleAdd = useCallback(async (data: AccountFormData) => {
    await addAccount(data)
  }, [addAccount])

  const handleEdit = useCallback(async (data: AccountFormData) => {
    if (!editingAccount) return
    await updateAccount(editingAccount.id, data)
    setEditingAccount(null)
  }, [editingAccount, updateAccount])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    await deleteAccount(deleteTarget.id)
    setDeleteTarget(null)
  }, [deleteTarget, deleteAccount])

  function openCreateForm() {
    setEditingAccount(null)
    setFormOpen(true)
  }

  function openEditForm(account: Account) {
    setEditingAccount(account)
    setFormOpen(true)
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Accounts</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your accounts and track balances.
          </p>
        </div>
        <Button onClick={openCreateForm}>
          <Plus className="h-4 w-4" />
          Add Account
        </Button>
      </div>

      {/* Account grid */}
      {accounts.length === 0 ? (
        <EmptyState
          icon={<CreditCard className="h-12 w-12" />}
          title="No accounts yet"
          description="Create your first account to start tracking your finances."
          action={
            <Button onClick={openCreateForm}>
              <Plus className="h-4 w-4" />
              Add Account
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              onEdit={openEditForm}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      )}

      {/* Create/Edit form modal */}
      <AccountForm
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open)
          if (!open) setEditingAccount(null)
        }}
        account={editingAccount}
        onSubmit={editingAccount ? handleEdit : handleAdd}
      />

      {/* Delete confirmation */}
      <Modal
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Delete Account"
        description={`Are you sure you want to delete "${deleteTarget?.name}"? All transactions in this account will be permanently deleted.`}
      >
        <div className="flex justify-end gap-3 pt-2">
          <Button
            variant="secondary"
            onClick={() => setDeleteTarget(null)}
          >
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete}>
            Delete Account
          </Button>
        </div>
      </Modal>
    </div>
  )
}
