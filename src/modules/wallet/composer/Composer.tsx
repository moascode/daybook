import { forwardRef, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Send,
  TrendingDown,
  TrendingUp,
  ArrowRightLeft,
  Split,
  Upload,
  Loader2,
} from 'lucide-react'
import { cn, todayISO } from '@/lib/utils'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app.store'
import type { Account, Category, TransactionType } from '@/types/wallet.types'
import type { TransactionFormData } from '@/modules/wallet/TransactionForm'
import { parseComposerInput } from './parseComposerInput'
import { ComposerPreview, type ComposerPreviewDraft } from './ComposerPreview'

export interface ComposerProps {
  accounts: Account[]
  categories: Category[]
  activeAccountId: string | null
  /** Mirrors `app.store`'s `hasAnthropicKey` — gates the AI fallback call. */
  hasAnthropicKey: boolean
  /**
   * The parent (WalletPage) does the actual `POST /transactions` and list
   * refresh. Called only from `ComposerPreview`'s Confirm button.
   */
  onConfirm: (draft: ComposerPreviewDraft) => void | Promise<void>
  /**
   * Parent opens the full `TransactionForm` modal. Used by the shortcut row
   * (Expense/Income/Transfer/Split → `{ type }`), by `ComposerPreview`'s Edit
   * button (→ the full parsed draft), and by the "couldn't parse" fallback
   * (→ `{ merchant: <raw text> }`, never a silent failure).
   */
  onOpenBlankForm: (initialDraft?: Partial<TransactionFormData>) => void
}

interface ComposerAiResponse {
  draft?: {
    merchant?: string
    amount?: number
    type?: TransactionType
    accountId?: string
    categoryId?: string | null
    date?: string
  }
}

const SHORTCUTS: {
  key: string
  label: string
  icon: typeof TrendingDown
  type: TransactionType
  dotClass: string
}[] = [
  { key: 'expense', label: 'Expense', icon: TrendingDown, type: 'expense', dotClass: 'bg-neg-bg text-neg-fg' },
  { key: 'income', label: 'Income', icon: TrendingUp, type: 'income', dotClass: 'bg-pos-bg text-pos-fg' },
  { key: 'transfer', label: 'Transfer', icon: ArrowRightLeft, type: 'transfer', dotClass: 'bg-info-bg text-info-fg' },
  { key: 'split', label: 'Split', icon: Split, type: 'expense', dotClass: 'bg-alt-bg text-alt-fg' },
]

/**
 * Best-effort mapping of the AI route's partial `{ draft }` response into a
 * full `ComposerDraft`. Per the R7 flow plan (criteria #8): a missing amount
 * means the whole AI attempt failed (caller falls back to the blank form);
 * every other missing field gets a sensible default so the preview is always
 * showable.
 */
function draftFromAiResponse(
  ai: ComposerAiResponse['draft'],
  accounts: Account[],
  activeAccountId: string | null,
): ComposerPreviewDraft | null {
  if (!ai || typeof ai.amount !== 'number' || !(ai.amount > 0)) return null
  const accountId =
    (ai.accountId && accounts.some((a) => a.id === ai.accountId) ? ai.accountId : null) ??
    (activeAccountId && accounts.some((a) => a.id === activeAccountId) ? activeAccountId : null) ??
    accounts[0]?.id ??
    null
  if (!accountId) return null
  // The AI prompt has no destination-account field, so a 'transfer' answer
  // can never carry one — showing it as a transfer would preview a draft
  // whose Confirm always fails server-side (no destination). Falls back to
  // expense rather than silently dropping the entry.
  const type = ai.type === 'transfer' ? 'expense' : (ai.type ?? 'expense')
  return {
    merchant: ai.merchant ?? '',
    amount: ai.amount,
    type,
    accountId,
    destinationAccountId: null,
    categoryId: ai.categoryId ?? null,
    date: ai.date ?? todayISO(),
  }
}

/**
 * The composer bar mounted at the top of `/wallet` (R7): free-text quick-add
 * input, shortcut row, `N`-hotkey focus target (via the forwarded ref), and
 * the rules-parser → AI-fallback → blank-form orchestration described in the
 * flow plan (criteria #1/#2/#3/#8).
 *
 * Hotkey wiring: this component does NOT own the `keydown` listener — the
 * parent (`WalletPage.tsx`) listens for `N` at the page level (it alone knows
 * page-level focus context) and calls `.focus()` on the ref forwarded here,
 * which points directly at the underlying `<input>` DOM node.
 */
export const Composer = forwardRef<HTMLInputElement, ComposerProps>(function Composer(
  { accounts, categories, activeAccountId, hasAnthropicKey, onConfirm, onOpenBlankForm },
  ref,
) {
  const username = useAppStore((s) => s.user?.username ?? '')
  const [text, setText] = useState('')
  const [previewDraft, setPreviewDraft] = useState<ComposerPreviewDraft | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // A ref, not just the `submitting` state: two Enter keydowns landing before
  // React flushes the first `setSubmitting(true)` would both read `false`
  // from the render closure and fire two AI calls (a held-down Enter repeats
  // every ~30ms). The ref is read/written synchronously, so the guard is
  // structural rather than a race against React's batching.
  const submittingRef = useRef(false)
  // Separate guard from `submittingRef` — Confirm posts the transaction
  // itself and is a different action from parsing/submitting the text; two
  // fast clicks (or an Enter-repeat while the Confirm button is focused)
  // must not fire two `POST /transactions` for the same draft.
  const confirmingRef = useRef(false)
  const [confirming, setConfirming] = useState(false)

  async function handleSubmit() {
    const trimmed = text.trim()
    if (!trimmed || submittingRef.current) return

    const draft = parseComposerInput(trimmed, accounts, activeAccountId)
    if (draft) {
      setText('')
      setPreviewDraft(draft)
      return
    }

    if (!hasAnthropicKey) {
      setText('')
      onOpenBlankForm({ merchant: trimmed })
      return
    }

    submittingRef.current = true
    setSubmitting(true)
    try {
      const { draft: aiDraft } = await api.post<ComposerAiResponse>('/transactions/parse-composer-ai', {
        text: trimmed,
      })
      const resolved = draftFromAiResponse(aiDraft, accounts, activeAccountId)
      setText('')
      if (resolved) {
        setPreviewDraft(resolved)
      } else {
        onOpenBlankForm({ merchant: trimmed })
      }
    } catch {
      // Never a silent failure (CLAUDE.md rule 13) — the user's text always
      // lands somewhere they can act on, even when the AI call itself fails.
      setText('')
      onOpenBlankForm({ merchant: trimmed })
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleSubmit()
    }
  }

  async function handleConfirm() {
    if (!previewDraft || confirmingRef.current) return
    confirmingRef.current = true
    setConfirming(true)
    try {
      await onConfirm(previewDraft)
      setPreviewDraft(null)
    } catch {
      // onConfirm (WalletPage's handleAddTransaction) already toasts the
      // failure and rethrows so the caller knows the write didn't happen —
      // caught here only so it doesn't surface as an unhandled rejection.
      // The preview stays open, matching the same "keep it open to retry"
      // behaviour the full TransactionForm uses on a failed save.
    } finally {
      confirmingRef.current = false
      setConfirming(false)
    }
  }

  function handleEdit() {
    if (!previewDraft) return
    onOpenBlankForm({
      accountId: previewDraft.accountId,
      destinationAccountId: previewDraft.destinationAccountId,
      date: previewDraft.date,
      merchant: previewDraft.merchant,
      amount: previewDraft.amount,
      type: previewDraft.type,
      categoryId: previewDraft.categoryId,
    })
    setPreviewDraft(null)
  }

  function handleCancel() {
    setPreviewDraft(null)
  }

  const initial = (username || '?').charAt(0).toUpperCase()

  return (
    <div className="composer">
      <div className="composer-top">
        <span className="avatar" style={{ background: 'rgb(var(--accent-bg))', color: 'rgb(var(--accent-fg))' }}>
          {initial}
        </span>
        <label className="composer-field">
          <input
            ref={ref}
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Add a transaction — try "coffee 4.20 cash"'
            aria-label="Add a transaction"
            disabled={submitting}
          />
          <span className="kbd">N</span>
        </label>
        <button
          type="button"
          className="composer-send"
          onClick={() => void handleSubmit()}
          disabled={submitting || !text.trim()}
          aria-label="Send"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>

      <div className="composer-acts">
        {SHORTCUTS.map(({ key, label, icon: Icon, type, dotClass }) => (
          <button key={key} type="button" className="composer-act" onClick={() => onOpenBlankForm({ type })}>
            <span className={cn('cdot', dotClass)}>
              <Icon className="icon-sm" aria-hidden="true" />
            </span>
            {label}
          </button>
        ))}
        <Link to="/wallet/import" className="composer-act">
          <span className="cdot" style={{ background: 'rgb(var(--surface-sunk))', color: 'rgb(var(--fg-muted))' }}>
            <Upload className="icon-sm" aria-hidden="true" />
          </span>
          Import CSV
        </Link>
      </div>

      {previewDraft && (
        <ComposerPreview
          draft={previewDraft}
          accounts={accounts}
          categories={categories}
          confirming={confirming}
          onConfirm={handleConfirm}
          onEdit={handleEdit}
          onCancel={handleCancel}
        />
      )}
    </div>
  )
})
