import { useState, useCallback } from 'react'

/**
 * Shared add/edit/delete modal state for wallet CRUD pages (Budgets, Goals,
 * Recurring) — each page owns its own form fields; this hook only owns which
 * modal is open and which item it targets.
 */
export function useCrudModal<T>() {
  const [formOpen, setFormOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<T | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const openCreate = useCallback(() => {
    setEditingItem(null)
    setFormOpen(true)
  }, [])

  const openEdit = useCallback((item: T) => {
    setEditingItem(item)
    setFormOpen(true)
  }, [])

  const closeForm = useCallback((open: boolean) => {
    setFormOpen(open)
    if (!open) setEditingItem(null)
  }, [])

  const openDelete = useCallback((id: string) => {
    setConfirmDeleteId(id)
  }, [])

  const closeDelete = useCallback(() => {
    setConfirmDeleteId(null)
  }, [])

  return {
    formOpen,
    editingItem,
    confirmDeleteId,
    openCreate,
    openEdit,
    closeForm,
    openDelete,
    closeDelete,
  }
}
