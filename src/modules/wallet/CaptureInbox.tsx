import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Inbox } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { BulkActionBar } from '@/components/ui/BulkActionBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDeleteModal } from '@/components/ui/ConfirmDeleteModal'
import { useWallet } from '@/hooks/useWallet'
import { useToastStore } from '@/stores/toast.store'
import { useAppStore } from '@/stores/app.store'
import { errorMessage } from '@/lib/utils'
import { resolveMerchants } from '@/lib/csv'
import { suggestCategories, suggestCategoriesAI, suggestionFitsType } from '@/lib/merchantSuggestions'
import { acceptCaptures, dismissCaptures, listCaptures, captureToRow, parseCardMap, CARD_MAP_KEY } from '@/lib/captures'
import { api } from '@/lib/api'
import { CsvReviewTable } from './CsvReviewTable'
import type { ImportRow } from '@/lib/csv'

/** Broadcast so the sidebar badge re-counts without polling. */
export const CAPTURES_CHANGED = 'daybook:captures-changed'

const LOAD_FAILED = 'Could not load your capture inbox.'

/**
 * The capture inbox — every transaction a machine wrote, waiting to be
 * accepted (docs/v2/wallet/feature-capture-inbox.md §4, §5).
 *
 * Reuses `CsvReviewTable` rather than growing a second review UI, which is the
 * whole point of decision D-F: the AI buttons, the duplicate hints, the inline
 * edit and the account control are inherited, not re-implemented. The one thing
 * it adds is a per-row Account column, because a capture carries its own card
 * while a CSV or photo batch lands in one account chosen once.
 *
 * ENRICHMENT IS RULES-ONLY. Merchant cleanup runs the free ladder (corrections
 * cache + own history, `useAI: false`) and categories come from the history/
 * builtin rule pass — no Claude call happens on load, ever. AI is reachable
 * only through the table's explicit "Ask AI" buttons, exactly as it is for CSV
 * and photo rows (A4/A5, approved 2026-09-07). ai-usage.md guardrail 2: a call
 * fires on a button, never on a page load.
 */
export function CaptureInbox() {
  const navigate = useNavigate()
  const { accounts, categories, loadAccounts, loadCategories } = useWallet()
  const { addToast } = useToastStore()
  const hasAnthropicKey = useAppStore((s) => s.hasAnthropicKey)

  const [rows, setRows] = useState<ImportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [confirmDismiss, setConfirmDismiss] = useState(false)

  const [askingAI, setAskingAI] = useState(false)
  const [aiMessage, setAiMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null)
  const [resolvingMerchants, setResolvingMerchants] = useState(false)
  const [merchantAiMessage, setMerchantAiMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null)

  const writableAccounts = accounts.filter((a) => !a.isShared || a.canWrite === 1)

  // Builds the enriched row set and RETURNS it — no component state is touched
  // here, which is what lets the initial load run from an effect (setState only
  // in the promise callbacks) while accept/dismiss can simply await it.
  const buildRows = useCallback(async (): Promise<ImportRow[]> => {
    const [captures, settings] = await Promise.all([
      listCaptures(),
      api.get<{ key: string; value: string }[]>('/settings'),
    ])
    const cardMap = parseCardMap(settings.find((s) => s.key === CARD_MAP_KEY)?.value)
    const fallback = settings.find((s) => s.key === 'default_account_id')?.value ?? ''
    const accountList = await loadAccounts()
    const writable = (accountList ?? []).filter((a) => !a.isShared || a.canWrite === 1)
    const fallbackId = writable.some((a) => a.id === fallback) ? fallback : (writable[0]?.id ?? '')

    const mapped = captures.map((cap) => captureToRow(cap, cardMap, writable, fallbackId))

    // ── Rules-only enrichment. Zero AI, zero cost. ──
    const merchants = [...new Set(mapped.filter((r) => r.merchant).map((r) => r.merchant))]
    if (merchants.length > 0) {
      const [{ resolutions }, suggestions] = await Promise.all([
        // Stages 1-2 only: corrections cache + own history. Stage 3 (AI) is
        // reached solely through the table's explicit button.
        resolveMerchants(merchants.map((m) => ({ raw: m, guess: m })), false),
        suggestCategories(merchants),
      ])
      const byGuess = new Map(resolutions.map((r) => [r.guess, r.name]))
      const byMerchant = new Map(suggestions.map((sug) => [sug.raw, sug]))
      for (const row of mapped) {
        const cleaned = byGuess.get(row.merchant)
        if (cleaned) row.merchant = cleaned
        const hit = byMerchant.get(row.merchant) ?? byMerchant.get(cleaned ?? '')
        if (hit && row.type !== 'transfer' && suggestionFitsType(hit, row.type)) {
          row.categoryId = hit.categoryId
          row.suggestedFrom = { canonical: hit.canonical, matchCount: hit.matchCount }
          row.suggestionApplied = true
        }
      }
    }
    return mapped
  }, [loadAccounts])

  // Re-read after an accept or a dismiss. Not reachable from an effect, so it
  // can await normally.
  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await buildRows())
      setLoadError(null)
    } catch (err) {
      setLoadError(errorMessage(err, LOAD_FAILED))
    } finally {
      setLoading(false)
    }
  }, [buildRows])

  useEffect(() => {
    loadCategories()
    let cancelled = false
    buildRows()
      .then((built) => {
        if (cancelled) return
        setRows(built)
        setLoadError(null)
      })
      // Rule 13: an empty inbox and a failed load must never look the same.
      .catch((err) => {
        if (!cancelled) setLoadError(errorMessage(err, LOAD_FAILED))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [buildRows, loadCategories])

  const updateRow = useCallback((index: number, updates: Partial<ImportRow>) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...updates } : row)))
  }, [])

  const clearSuggestions = useCallback(() => {
    setRows((prev) =>
      prev.map((row) =>
        row.suggestionApplied
          ? { ...row, categoryId: null, suggestedFrom: undefined, suggestionApplied: false }
          : row,
      ),
    )
  }, [])

  // A4 — same call, same bucket, same explicit click as the CSV review page.
  const handleAskAI = useCallback(async () => {
    const merchants = [
      ...new Set(rows.filter((r) => r.included && r.type !== 'transfer' && !r.categoryId && r.merchant).map((r) => r.merchant)),
    ]
    if (merchants.length === 0) return
    setAskingAI(true)
    setAiMessage(null)
    try {
      const { suggestions, askedMerchants, failedMerchants, failureReason } = await suggestCategoriesAI(merchants)
      if (suggestions.length > 0) {
        const byMerchant = new Map(suggestions.map((s) => [s.raw, s]))
        setRows((prev) =>
          prev.map((row) => {
            if (row.categoryId || row.type === 'transfer' || !row.included) return row
            const hit = byMerchant.get(row.merchant)
            if (!hit || !suggestionFitsType(hit, row.type)) return row
            return { ...row, categoryId: hit.categoryId, suggestedFrom: { canonical: hit.canonical, matchCount: hit.matchCount }, suggestionApplied: true }
          }),
        )
      }
      if (failedMerchants > 0 && suggestions.length === 0) {
        setAiMessage({ tone: 'error', text: failureReason ? `AI categorisation failed: ${failureReason}` : 'AI categorisation failed — nothing came back. Please try again.' })
      } else if (failedMerchants > 0) {
        setAiMessage({ tone: 'error', text: `${failedMerchants} of ${askedMerchants} merchants could not be categorised${failureReason ? ` (${failureReason})` : ''} — ask AI again to retry those.` })
      } else if (suggestions.length === 0) {
        setAiMessage({ tone: 'info', text: askedMerchants === 1 ? 'Claude had no confident suggestion for this merchant.' : `Claude had no confident suggestion for any of these ${askedMerchants} merchants.` })
      }
    } catch (err) {
      setAiMessage({ tone: 'error', text: errorMessage(err, 'Could not ask AI — please try again.') })
    } finally {
      setAskingAI(false)
    }
  }, [rows])

  // A5 — the merchant-cleanup mirror of A4.
  const handleResolveMerchantsAI = useCallback(async () => {
    const targets = [...new Set(rows.filter((r) => r.included && r.merchantUnresolved && r.merchant).map((r) => r.merchant))]
    if (targets.length === 0) return
    setResolvingMerchants(true)
    setMerchantAiMessage(null)
    try {
      const { resolutions, failureReason } = await resolveMerchants(targets.map((m) => ({ raw: m, guess: m })), true)
      const byGuess = new Map(resolutions.map((r) => [r.guess, r.name]))
      setRows((prev) =>
        prev.map((row) => {
          if (!row.merchantUnresolved) return row
          const name = byGuess.get(row.merchant)
          return name ? { ...row, merchant: name, merchantUnresolved: false } : row
        }),
      )
      if (resolutions.length === 0) {
        setMerchantAiMessage({ tone: failureReason ? 'error' : 'info', text: failureReason ? `Couldn't clean up merchant names — ${failureReason}` : `Claude had no confident cleanup for the remaining merchant name${targets.length !== 1 ? 's' : ''}.` })
      } else if (resolutions.length < targets.length) {
        setMerchantAiMessage({ tone: 'info', text: `Cleaned up ${resolutions.length} of ${targets.length} merchant names${failureReason ? ` (${failureReason})` : ''} — ask AI again to retry those.` })
      } else {
        setMerchantAiMessage({ tone: 'info', text: `Cleaned up ${resolutions.length} merchant name${resolutions.length !== 1 ? 's' : ''}.` })
      }
    } catch (err) {
      setMerchantAiMessage({ tone: 'error', text: errorMessage(err, 'Could not resolve merchant names — please try again.') })
    } finally {
      setResolvingMerchants(false)
    }
  }, [rows])

  const selected = rows.filter((r) => r.included)

  async function handleAccept() {
    if (selected.length === 0) return

    // Caught here rather than at the server so the message names the row.
    const badTransfer = selected.findIndex(
      (r) => r.type === 'transfer' && (!r.destinationAccountId || r.destinationAccountId === r.accountId),
    )
    if (badTransfer !== -1) {
      addToast({
        message: `"${selected[badTransfer].merchant || 'Unnamed'}" is a transfer and needs a destination account — set one, or exclude the row.`,
        duration: 5000,
      })
      return
    }
    const noAccount = selected.findIndex((r) => !r.accountId)
    if (noAccount !== -1) {
      addToast({ message: `"${selected[noAccount].merchant || 'Unnamed'}" has no account — pick one first.`, duration: 4000 })
      return
    }

    setWorking(true)
    try {
      await acceptCaptures(
        selected.map((r) => ({
          id: r.captureId!,
          accountId: r.accountId!,
          destinationAccountId: r.type === 'transfer' ? r.destinationAccountId : null,
          date: r.date,
          merchant: r.merchant,
          description: r.description,
          amount: r.amount,
          type: r.type,
          categoryId: r.categoryId,
        })),
      )
      addToast({ message: `${selected.length} transaction${selected.length !== 1 ? 's' : ''} added.` })
      window.dispatchEvent(new Event(CAPTURES_CHANGED))
      await refresh()
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not accept these captures — nothing was saved.'), duration: 5000 })
    } finally {
      setWorking(false)
    }
  }

  async function handleDismiss() {
    setConfirmDismiss(false)
    const ids = selected.map((r) => r.captureId!).filter(Boolean)
    if (ids.length === 0) return
    setWorking(true)
    try {
      const { dismissed } = await dismissCaptures(ids)
      addToast({ message: `${dismissed} capture${dismissed !== 1 ? 's' : ''} dismissed.` })
      window.dispatchEvent(new Event(CAPTURES_CHANGED))
      await refresh()
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not dismiss these captures.'), duration: 4000 })
    } finally {
      setWorking(false)
    }
  }

  if (loading) {
    return <p className="py-12 text-center text-sm text-fg-subtle">Loading your inbox…</p>
  }

  if (loadError) {
    return (
      <EmptyState
        title="Couldn't load the inbox"
        description={loadError}
        action={<Button size="sm" onClick={() => void refresh()}>Retry</Button>}
      />
    )
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="h-10 w-10" />}
        title="Nothing waiting"
        description="Transactions sent by a connected device land here for you to check before they reach your accounts. Set one up in Settings → Connected devices."
        action={<Button size="sm" variant="secondary" onClick={() => navigate('/settings')}>Open Settings</Button>}
      />
    )
  }

  return (
    <div className="mx-auto max-w-5xl pb-24">
      <div className="page-head justify-between">
        <h1 className="page-title">Capture inbox</h1>
        <span className="text-sm text-fg-subtle" data-testid="capture-inbox-count">
          {rows.length} waiting
        </span>
      </div>

      <CsvReviewTable
        rows={rows}
        categories={categories}
        destinationAccounts={writableAccounts}
        accountOptions={writableAccounts}
        onRowChange={updateRow}
        onToggleInclude={(index) => updateRow(index, { included: !rows[index].included })}
        onClearSuggestions={clearSuggestions}
        hasAnthropicKey={hasAnthropicKey}
        askingAI={askingAI}
        aiMessage={aiMessage}
        onAskAI={() => void handleAskAI()}
        resolvingMerchants={resolvingMerchants}
        merchantAiMessage={merchantAiMessage}
        onResolveMerchantsAI={() => void handleResolveMerchantsAI()}
      />

      {selected.length > 0 && (
        <BulkActionBar testId="capture-action-bar" count={selected.length}>
          <Button variant="secondary" size="sm" disabled={working} onClick={() => setConfirmDismiss(true)} data-testid="capture-dismiss-btn">
            Dismiss
          </Button>
          <Button variant="primary" size="sm" disabled={working} onClick={() => void handleAccept()} data-testid="capture-accept-btn">
            {working ? 'Working…' : `Accept ${selected.length}`}
          </Button>
        </BulkActionBar>
      )}

      <ConfirmDeleteModal
        open={confirmDismiss}
        onOpenChange={setConfirmDismiss}
        title={`Dismiss ${selected.length} capture${selected.length !== 1 ? 's' : ''}?`}
        description="They will not become transactions. This cannot be undone from here — the same payment would have to be captured again."
        confirmLabel="Dismiss"
        onConfirm={() => void handleDismiss()}
        confirmTestId="capture-dismiss-confirm"
      />
    </div>
  )
}
