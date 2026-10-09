import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/stores/app.store'
import { useToastStore } from '@/stores/toast.store'
import { useWallet } from '@/hooks/useWallet'
import { errorMessage } from '@/lib/utils'
import { Composer } from '@/modules/wallet/composer/Composer'
import type { ComposerPreviewDraft } from '@/modules/wallet/composer/ComposerPreview'
import { ImportModal, type ImportReadyMeta } from '@/modules/wallet/import/ImportModal'
import { TransactionForm, type TransactionFormData } from '@/modules/wallet/TransactionForm'
import type { Account, Category } from '@/types/wallet.types'
import type { ImportRow } from '@/lib/csv'

interface PageComposerProps {
  accounts: Account[]
  categories: Category[]
  /** Pre-selects which account the composer's rules-parser prefers (e.g. the
   *  page's featured/filtered account). Omit when the page has no such
   *  notion — the composer falls back to the first own account. */
  defaultAccountId?: string | null
  onCreated: () => void | Promise<void>
}

/**
 * Extracts the composer wiring duplicated across WalletPage.tsx and
 * Dashboard.tsx (composerDraft state, openComposerForm/handleComposerConfirm,
 * the Composer bar + TransactionForm modal + ImportModal, and the
 * `N`-anywhere focus shortcut) so a third/fourth page (Accounts, Shared) can
 * mount the exact same behaviour without re-duplicating it a third time.
 *
 * Transaction creation goes through `useWallet().addTransaction` — the same
 * store action WalletPage/Dashboard call — never a new path. A failed submit
 * always surfaces a toast (CLAUDE.md rule 10); `onCreated` lets the host page
 * refresh whatever it shows that a new transaction could affect.
 *
 * WalletPage and Dashboard are NOT migrated onto this component (out of
 * scope for FEAT-064/065/069) — they keep their own copies of this wiring.
 */
export function PageComposer({ accounts, categories, defaultAccountId, onCreated }: PageComposerProps) {
  // `tags` reads off useWalletStore (via useWallet's own `store.tags`) rather
  // than a local copy — loadTags() below already writes there, so a second
  // local useState would just be a second source of truth to keep in sync.
  const { addTransaction, loadTags, tags } = useWallet()
  const hasAnthropicKey = useAppStore((s) => s.hasAnthropicKey)
  const { addToast } = useToastStore()
  const navigate = useNavigate()

  const composerInputRef = useRef<HTMLInputElement>(null)
  const [composerDraft, setComposerDraft] = useState<Partial<TransactionFormData> | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [importModalOpen, setImportModalOpen] = useState(false)

  useEffect(() => {
    loadTags().catch((err: unknown) => {
      addToast({ message: errorMessage(err, "Couldn't load tag suggestions — try again.") })
    })
  }, [loadTags, addToast])

  // The composer's own rules-parser/AI matching is restricted to owned
  // accounts (mirrors WalletPage/Dashboard's `ownAccounts`) — a shared-in
  // account can't be resolved by the parser, but still shows in the full
  // TransactionForm's own account dropdown via the unfiltered `accounts` prop.
  const ownAccounts = useMemo(() => accounts.filter((a) => !a.isShared), [accounts])

  const handleAddTransaction = useCallback(async (data: TransactionFormData) => {
    try {
      await addTransaction(data)
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not save transaction — please try again.'), duration: 4000 })
      throw err // the write itself failed — keep the form open so the user can retry
    }
    // The write already succeeded. A failure here is only the host page's own
    // refresh, not the save — TransactionForm's handleSubmit has no catch of
    // its own, so rethrowing would skip onOpenChange(false) and leave the form
    // open looking like the save failed, inviting a duplicate resubmit of
    // money that already landed. Toast and let the form close normally.
    try {
      await onCreated()
      await loadTags()
    } catch (err) {
      addToast({ message: errorMessage(err, "Saved, but couldn't refresh — reload the page."), duration: 4000 })
    }
  }, [addTransaction, addToast, onCreated, loadTags])

  const openComposerForm = useCallback((initialDraft?: Partial<TransactionFormData>) => {
    setComposerDraft(initialDraft ?? null)
    setFormOpen(true)
  }, [])

  const handleComposerConfirm = useCallback(async (draft: ComposerPreviewDraft) => {
    await handleAddTransaction({ ...draft, description: '', tags: [] })
  }, [handleAddTransaction])

  const handleImportReady = useCallback((rows: ImportRow[], meta?: ImportReadyMeta) => {
    navigate('/wallet/import', { state: { rows, ...meta } })
  }, [navigate])

  // `N` anywhere on the page focuses the composer — WalletPage.tsx's guard,
  // plus two cases that page doesn't have to worry about: this component also
  // owns the Import modal, and (unlike WalletPage, whose only dialog IS
  // `formOpen`) a host page like Shared can have its own unrelated dialogs
  // open (SettleUpDialog, ConfirmReceiptDialog, …) that `formOpen` knows
  // nothing about — checking for any open `[role="dialog"]` covers those too.
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      if (formOpen || importModalOpen) return
      if (document.querySelector('[role="dialog"]')) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return
      e.preventDefault()
      composerInputRef.current?.focus()
    }
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [formOpen, importModalOpen])

  return (
    <>
      <div className="mb-4">
        <Composer
          ref={composerInputRef}
          accounts={ownAccounts}
          categories={categories}
          activeAccountId={defaultAccountId ?? null}
          hasAnthropicKey={hasAnthropicKey}
          onConfirm={handleComposerConfirm}
          onOpenBlankForm={openComposerForm}
          onOpenImport={() => setImportModalOpen(true)}
        />
      </div>

      <ImportModal
        open={importModalOpen}
        onOpenChange={setImportModalOpen}
        accounts={accounts.filter((a) => !a.isShared || a.canWrite === 1)}
        categories={categories}
        hasAnthropicKey={hasAnthropicKey}
        onReady={handleImportReady}
      />

      <TransactionForm
        open={formOpen}
        onOpenChange={(open) => { setFormOpen(open); if (!open) setComposerDraft(null) }}
        accounts={accounts}
        categories={categories}
        defaultAccountId={defaultAccountId}
        availableTags={tags}
        initialDraft={composerDraft ?? undefined}
        onSubmit={handleAddTransaction}
      />
    </>
  )
}
