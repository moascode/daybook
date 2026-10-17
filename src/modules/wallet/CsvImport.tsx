import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { CheckCircle2, ChevronDown, Check } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { BulkActionBar } from '@/components/ui/BulkActionBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { useWallet } from '@/hooks/useWallet'
import { useRules } from '@/hooks/useRules'
import { useToastStore } from '@/stores/toast.store'
import { useAppStore } from '@/stores/app.store'
import { suggestCategoriesAI, suggestionFitsType } from '@/lib/merchantSuggestions'
import { resolveMerchants } from '@/lib/csv'
import { splitShares } from '@/lib/rules'
import { api } from '@/lib/api'
import { mapMember } from '@/lib/household.mappers'
import { errorMessage, formatMYR } from '@/lib/utils'
import { CsvReviewTable } from './CsvReviewTable'
import type { ImportRow } from '@/lib/csv'
import type { TransactionInput } from '@/hooks/useWallet'
import type { TruncatedPhoto } from '@/lib/photo-import'
import type { GroupMember } from '@/types/household.types'

interface ImportLocationState {
  rows: ImportRow[]
  /** Photo import (P2, approved 2026-09-06) — see ImportModal.tsx. */
  photoMode?: boolean
  failedPhotos?: { fileName: string; failureReason?: string }[]
  /** A photo whose reply was cut off before the model finished the statement
   *  (worker/lib/anthropic.ts's parsePhotoImportWithAI) — its rows are
   *  already included in `rows` above and are safe to import; this is only
   *  the "there may be more, crop and re-upload" notice. */
  truncatedPhotos?: TruncatedPhoto[]
}

/**
 * The review step of the import flow (CLAUDE.md §9.2). Upload, column
 * mapping and AI-assisted processing all now happen in-modal
 * (`ImportModal.tsx`, opened from the composer's "Import" shortcut) — this
 * page only ever receives already-built `ImportRow[]` via router state and
 * renders the wide editable grid a modal has no room for, per the mockup
 * (transactions-import-csv-review.html).
 */
export function CsvImport() {
  const navigate = useNavigate()
  const location = useLocation()
  const { accounts, categories, importTransactions, setFilters, loadAccounts, loadCategories } = useWallet()
  const { rules, loadRules } = useRules()
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([])
  const [rulesLoadError, setRulesLoadError] = useState<string | null>(null)
  const currentUserId = useAppStore((s) => s.user?.id ?? '')
  const { addToast } = useToastStore()
  const hasAnthropicKey = useAppStore((s) => s.hasAnthropicKey)

  const state = location.state as ImportLocationState | null
  const [importRows, setImportRows] = useState<ImportRow[]>(state?.rows ?? [])
  // Chosen here, not in the modal — extraction/mapping never needed it, and
  // review is where the user is already checking everything else before
  // committing, so this is the one place the account should be both visible
  // and changeable (per the owner's ask, 2026-09-06).
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [failedPhotos, setFailedPhotos] = useState(state?.failedPhotos ?? [])
  const [truncatedPhotos, setTruncatedPhotos] = useState(state?.truncatedPhotos ?? [])
  const photoMode = !!state?.photoMode
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ imported: number; skipped: number; excluded: number; splitCount: number } | null>(null)
  const [askingAI, setAskingAI] = useState(false)
  const [aiMessage, setAiMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null)
  const [resolvingMerchants, setResolvingMerchants] = useState(false)
  const [merchantAiMessage, setMerchantAiMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null)

  // Every other wallet page loads its own accounts/categories on mount
  // (WalletPage, Dashboard, GoalsPage, ...) — this page never did, because it
  // was only ever reached by client-side navigation from one of those, which
  // left the store already populated. A hard reload or a direct deep link to
  // this route (e.g. the browser restoring the tab, or the chunk-reload in
  // main.tsx) mounts the app with an empty Zustand store and nothing else on
  // this route fetches it, so `accounts` stayed `[]` forever: the "Import
  // into account" badge rendered with no name and the dropdown opened with
  // zero options — reported as "the dropdown isn't showing". Loading here,
  // same as the other pages, is what makes the badge (and `selectedAccountId`
  // below) converge once the fetch resolves.
  const loadRuleContext = useCallback(() => {
    // Rule 10: a failure here must say so, not just leave rules/groupMembers
    // empty (indistinguishable from "no rules yet, no group members yet").
    // The error is cleared only on a NEW outcome (not pre-emptively here) —
    // calling setState synchronously at the top of this function would fire
    // on every render that calls it from an effect body (react-hooks lint).
    Promise.all([
      loadRules(),
      api.get<Record<string, unknown>[]>('/groups/members'),
    ])
      .then(([, rows]) => {
        setGroupMembers(rows.map(mapMember).filter((m) => m.userId !== currentUserId))
        setRulesLoadError(null)
      })
      .catch((err: unknown) => {
        setRulesLoadError(errorMessage(err, "Couldn't load your rules — rule suggestions are off for this import."))
      })
  }, [loadRules, currentUserId])

  useEffect(() => {
    loadAccounts()
    loadCategories()
    loadRuleContext()
  }, [loadAccounts, loadCategories, loadRuleContext])

  const importableAccounts = accounts.filter((a) => !a.isShared || a.canWrite === 1)
  const destinationAccounts = importableAccounts.filter((a) => a.id !== selectedAccountId)

  // Converging conditional adjusted during render (no effect needed) — same
  // pattern ImportModal.tsx used for this before the account field moved here.
  if (importableAccounts.length > 0 && !selectedAccountId) {
    setSelectedAccountId(importableAccounts[0].id)
  }

  const includedCount = importRows.filter((r) => r.included).length
  const selectedCount = importRows.filter((r) => r.included).length

  const updateRow = useCallback((index: number, updates: Partial<ImportRow>) => {
    setImportRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...updates } : row)))
  }, [])

  const clearSuggestions = useCallback(() => {
    setImportRows((prev) =>
      prev.map((row) =>
        row.suggestionApplied
          ? { ...row, categoryId: null, suggestedFrom: undefined, suggestionApplied: false }
          : row,
      ),
    )
  }, [])

  // A4 (docs/reference/ai-usage.md, approved 2026-09-06) — same call,
  // same chunking/rate-limit bucket, same messaging as BulkEditDialog's own
  // "Ask AI" button. Only asks about rows the rules pass left uncategorised.
  const handleAskAI = useCallback(async () => {
    const merchants = [
      ...new Set(
        importRows
          .filter((r) => r.included && r.type !== 'transfer' && !r.categoryId && r.merchant)
          .map((r) => r.merchant),
      ),
    ]
    if (merchants.length === 0) return
    setAskingAI(true)
    setAiMessage(null)
    try {
      const { suggestions, askedMerchants, failedMerchants, failureReason } = await suggestCategoriesAI(merchants)
      if (suggestions.length > 0) {
        const byMerchant = new Map(suggestions.map((s) => [s.raw, s]))
        setImportRows((prev) =>
          prev.map((row) => {
            if (row.categoryId || row.type === 'transfer' || !row.included) return row
            const hit = byMerchant.get(row.merchant)
            if (!hit || !suggestionFitsType(hit, row.type)) return row
            return {
              ...row,
              categoryId: hit.categoryId,
              suggestedFrom: { canonical: hit.canonical, matchCount: hit.matchCount },
              suggestionApplied: true,
            }
          }),
        )
      }

      // Every outcome says something — a click on a paid button that changes
      // nothing on screen and explains nothing is the one result this must
      // never produce (rule 13).
      if (failedMerchants > 0 && suggestions.length === 0) {
        setAiMessage({
          tone: 'error',
          text: failureReason
            ? `AI categorisation failed: ${failureReason}`
            : 'AI categorisation failed — nothing came back. Please try again.',
        })
      } else if (failedMerchants > 0) {
        setAiMessage({
          tone: 'error',
          text: `${failedMerchants} of ${askedMerchants} merchants could not be categorised${failureReason ? ` (${failureReason})` : ''} — ask AI again to retry those.`,
        })
      } else if (suggestions.length === 0) {
        setAiMessage({
          tone: 'info',
          text:
            askedMerchants === 1
              ? 'Claude had no confident suggestion for this merchant.'
              : `Claude had no confident suggestion for any of these ${askedMerchants} merchants.`,
        })
      }
    } catch (err) {
      setAiMessage({ tone: 'error', text: errorMessage(err, 'Could not ask AI — please try again.') })
    } finally {
      setAskingAI(false)
    }
  }, [importRows])

  // Merchant-resolution mirror of A4 above: the automatic on-import pass
  // (ImportModal.tsx) only runs the free rules ladder (corrections cache +
  // own history); this button is the sole place AI is reached for merchant
  // cleanup, for whatever the rules pass left unresolved.
  const handleResolveMerchantsAI = useCallback(async () => {
    const pending = new Map<string, string>() // guess (current merchant text) -> raw narrative
    for (const row of importRows) {
      if (row.included && row.merchantUnresolved && row.narrativeRaw) {
        pending.set(row.merchant, row.narrativeRaw)
      }
    }
    if (pending.size === 0) return
    const totalTargets = pending.size
    setResolvingMerchants(true)
    setMerchantAiMessage(null)
    try {
      const { resolutions, failureReason } = await resolveMerchants(
        [...pending.entries()].map(([guess, raw]) => ({ raw, guess })),
        true,
      )
      // Derived from the response, not from a counter mutated inside the
      // setState updater below — React does not guarantee that updater runs
      // synchronously before this line (it did not, in practice, after an
      // await), so a side-effect counter there always read back as 0.
      const resolvedCount = resolutions.length
      const byGuess = new Map(resolutions.map((r) => [r.guess, r.name]))
      setImportRows((prev) =>
        prev.map((row) => {
          if (!row.merchantUnresolved) return row
          const name = byGuess.get(row.merchant)
          return name ? { ...row, merchant: name, merchantUnresolved: false } : row
        }),
      )

      // Every outcome says something (rule 13) — a click that resolves
      // nothing and explains nothing is the one result this must avoid.
      if (resolvedCount === 0) {
        setMerchantAiMessage({
          tone: failureReason ? 'error' : 'info',
          text: failureReason
            ? `Couldn't clean up merchant names — ${failureReason}`
            : `Claude had no confident cleanup for the remaining merchant name${totalTargets !== 1 ? 's' : ''}.`,
        })
      } else if (resolvedCount < totalTargets) {
        setMerchantAiMessage({
          tone: 'info',
          text: `Cleaned up ${resolvedCount} of ${totalTargets} merchant name${totalTargets !== 1 ? 's' : ''}${
            failureReason ? ` (${failureReason})` : ''
          } — ask AI again to retry those.`,
        })
      } else {
        setMerchantAiMessage({ tone: 'info', text: `Cleaned up ${resolvedCount} merchant name${resolvedCount !== 1 ? 's' : ''}.` })
      }
    } catch (err) {
      setMerchantAiMessage({ tone: 'error', text: errorMessage(err, 'Could not resolve merchant names — please try again.') })
    } finally {
      setResolvingMerchants(false)
    }
  }, [importRows])

  const handleImport = useCallback(async () => {
    // Rule 10 (never fail silently): this used to return bare, so a click
    // while the account badge above hadn't resolved yet (the accounts fetch
    // still in flight right after mount) looked identical to the button
    // doing nothing at all.
    if (!selectedAccountId) {
      addToast({ message: "Still loading your accounts — try again in a moment.", duration: 4000 })
      return
    }
    const toImport = importRows.filter((r) => r.included)

    const badTransfer = importRows.findIndex(
      (r) => r.included && r.type === 'transfer' && (!r.destinationAccountId || r.destinationAccountId === selectedAccountId),
    )
    if (badTransfer !== -1) {
      addToast({
        message: `Row ${badTransfer + 1}: a transfer needs a destination account different from the import account.`,
        duration: 4000,
      })
      return
    }

    setImporting(true)
    const inputs: TransactionInput[] = toImport.map((r) => ({
      accountId: selectedAccountId,
      date: r.date,
      merchant: r.merchant,
      description: r.description,
      amount: r.amount,
      type: r.type,
      categoryId: r.categoryId,
      destinationAccountId: r.type === 'transfer' ? r.destinationAccountId : null,
      tags: r.tags ?? [],
      importHash: r.importHash,
    }))

    try {
      const created = await importTransactions(inputs)
      const skipped = importRows.filter((r) => r.isDuplicate).length
      const excluded = importRows.filter((r) => !r.included && !r.isDuplicate).length

      // The batch preserves order, so toImport[i] created created[i] — attach
      // a rule-driven split to each row that asked for one. #4 defensive
      // re-check: a split action never applies outside an expense row, even
      // if stale state somehow carried a ruleSplit onto one.
      const splitTargets = toImport
        .map((r, i) => ({ row: r, transactionId: created[i]?.id }))
        .filter((t): t is { row: ImportRow; transactionId: string } =>
          !!t.row.ruleSplit && t.row.type === 'expense' && !!t.transactionId)

      const failures: { merchant: string; amount: number; message: string }[] = []
      for (const { row, transactionId } of splitTargets) {
        try {
          const [payerShare, partnerShare] = splitShares(row.amount, row.ruleSplit!.percent)
          const ruleName = rules.find((r) => r.id === row.ruleId)?.name ?? 'rule'
          await api.post(`/transactions/${transactionId}/split`, {
            recipientId: row.ruleSplit!.userId,
            splitMode: 'custom',
            shareAmounts: [payerShare, partnerShare],
            note: `Auto-split by rule: ${ruleName}`,
          })
        } catch (err) {
          failures.push({ merchant: row.merchant || 'Unnamed', amount: row.amount, message: errorMessage(err, 'unknown error') })
        }
      }

      setResult({ imported: created.length, skipped, excluded, splitCount: splitTargets.length - failures.length })
      // Rule 10 — a split that silently failed must say so, by name, so the
      // user knows exactly which transactions to open and fix by hand. The
      // success case is said once, on the result screen below — not here too.
      if (failures.length > 0) {
        const named = failures.slice(0, 3).map((f) => `${f.merchant} (${formatMYR(f.amount)})`).join(', ')
        const more = failures.length > 3 ? ` +${failures.length - 3} more` : ''
        addToast({
          message: `${failures.length} split${failures.length !== 1 ? 's' : ''} couldn't be created for ${named}${more} — ${failures[0].message}`,
          duration: 7000,
        })
      }
    } catch {
      addToast({ message: 'Import failed — no transactions were saved.', duration: 4000 })
    } finally {
      setImporting(false)
    }
  }, [importRows, selectedAccountId, importTransactions, addToast, rules])

  // No rows in router state — reached directly (bookmark, refresh, back
  // button). Send the user back to start a fresh import from the composer
  // rather than showing an empty review grid with nothing to explain it.
  if (!state) {
    return (
      <EmptyState
        title="No import in progress"
        description="Start an import from the Import shortcut on the Transactions page."
        action={<Button size="sm" onClick={() => navigate('/wallet', { state: { openImport: true } })}>Go to Transactions</Button>}
      />
    )
  }

  if (result) {
    return (
      <div className="mx-auto max-w-sm pt-12 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <CheckCircle2 className="h-8 w-8 text-green-600" />
        </div>
        <h2 className="text-lg font-semibold text-fg">Import Complete</h2>
        <div className="mt-3 space-y-1 text-sm text-fg-subtle">
          <p><span className="font-semibold text-fg">{result.imported}</span> transaction{result.imported !== 1 ? 's' : ''} imported</p>
          {result.skipped > 0 && <p>{result.skipped} duplicate{result.skipped !== 1 ? 's' : ''} skipped</p>}
          {result.excluded > 0 && <p>{result.excluded} excluded by you</p>}
          {result.splitCount > 0 && <p>{result.splitCount} split by rule{result.splitCount !== 1 ? 's' : ''}</p>}
        </div>
        <div className="mt-7 flex justify-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => navigate('/wallet', { state: { openImport: true } })}>Import Another</Button>
          <Button size="sm" onClick={() => { setFilters({ dateFrom: '', dateTo: '' }); navigate('/wallet') }}>View Transactions</Button>
        </div>
      </div>
    )
  }

  const selectedAccount = importableAccounts.find((a) => a.id === selectedAccountId)

  return (
    <div className="mx-auto max-w-5xl pb-24">
      <div className="page-head justify-between">
        <h1 className="page-title">Review transactions</h1>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              data-testid="review-account-trigger"
              aria-label="Import into account"
              className="flex flex-shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-fg transition-colors hover:bg-surface-hover"
            >
              <span
                className="h-2 w-2 flex-shrink-0 rounded-full"
                style={{ background: selectedAccount?.color }}
                aria-hidden="true"
              />
              {selectedAccount?.name}
              <ChevronDown className="h-3.5 w-3.5 text-fg-subtle" aria-hidden="true" />
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="z-50 min-w-[200px] overflow-hidden rounded-xl border border-line bg-surface-raised p-1 shadow-xl shadow-line/60 animate-in fade-in-0 zoom-in-95"
              sideOffset={4}
              align="end"
            >
              {importableAccounts.map((a) => (
                <DropdownMenu.Item
                  key={a.id}
                  data-testid="review-account-option"
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-fg-muted outline-none hover:bg-surface-sunken focus:bg-surface-sunken"
                  onSelect={() => setSelectedAccountId(a.id)}
                >
                  <span
                    className="h-2 w-2 flex-shrink-0 rounded-full"
                    style={{ background: a.color }}
                    aria-hidden="true"
                  />
                  <span className="flex-1">{a.name}</span>
                  {a.id === selectedAccountId && <Check className="h-3.5 w-3.5 text-fg-faint" aria-hidden="true" />}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      {/* Photo import's partial-failure notice, per transactions-import-error.html.
          Never appears for a CSV import. */}
      {failedPhotos.length > 0 && (
        <div className="notice notice-fail mb-4">
          <div>
            <div className="notice-title">
              Couldn't read {failedPhotos.length} of {importRows.length + failedPhotos.length} photos
            </div>
            <div className="notice-sub">
              <b>{failedPhotos[0].fileName}</b>
              {failedPhotos.length === 1 ? ' was' : ` and ${failedPhotos.length - 1} other photo${failedPhotos.length > 2 ? 's were' : ' was'}`}{' '}
              {failedPhotos[0].failureReason ?? 'unreadable'} — no transaction was extracted from it. The rows below were
              read normally and are safe to import.
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto flex-shrink-0"
            onClick={() => setFailedPhotos([])}
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Photo import's partial-success notice — the reply was cut off before
          the model finished reading a statement. Its rows are already in
          importRows and are safe to import; this only flags that more may
          exist past the cutoff. Distinct from failedPhotos above (0 rows
          extracted) — this always has at least 1. */}
      {truncatedPhotos.length > 0 && (
        <div className="notice mb-4">
          <div>
            <div className="notice-title">
              {truncatedPhotos.length === 1 ? '1 photo was' : `${truncatedPhotos.length} photos were`} cut off partway
              through
            </div>
            <div className="notice-sub">
              {truncatedPhotos.length === 1 ? (
                <>
                  <b>{truncatedPhotos[0].fileName}</b> had more transactions than fit in one reply.{' '}
                  {truncatedPhotos[0].rowCount} rows were extracted below. Crop the photo to the remaining rows and
                  upload it again to add the rest.
                </>
              ) : (
                <>
                  <b>{truncatedPhotos[0].fileName}</b> and {truncatedPhotos.length - 1} other photo
                  {truncatedPhotos.length > 2 ? 's' : ''} were cut off partway through. Rows extracted below are safe
                  to import. Crop each photo to its remaining rows and upload again to add the rest.
                </>
              )}
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto flex-shrink-0"
            onClick={() => setTruncatedPhotos([])}
          >
            Dismiss
          </Button>
        </div>
      )}

      {rulesLoadError && (
        <div className="notice notice-fail mb-4" data-testid="rules-load-error">
          <div>
            <div className="notice-title">{rulesLoadError}</div>
          </div>
          <Button variant="secondary" size="sm" className="ml-auto flex-shrink-0" onClick={loadRuleContext}>
            Retry
          </Button>
        </div>
      )}

      {/* CsvReviewTable renders its own "Suggested a category…" banner
          (csv-suggestions-banner) — do not duplicate it here. */}
      <CsvReviewTable
        rows={importRows}
        categories={categories}
        destinationAccounts={destinationAccounts}
        onRowChange={updateRow}
        onToggleInclude={(index) => updateRow(index, { included: !importRows[index].included })}
        onClearSuggestions={clearSuggestions}
        photoMode={photoMode}
        hasAnthropicKey={hasAnthropicKey}
        askingAI={askingAI}
        aiMessage={aiMessage}
        onAskAI={() => void handleAskAI()}
        resolvingMerchants={resolvingMerchants}
        merchantAiMessage={merchantAiMessage}
        onResolveMerchantsAI={() => void handleResolveMerchantsAI()}
        rules={rules}
        ruleAccountId={selectedAccountId}
        groupMembers={groupMembers}
      />

      {selectedCount > 0 && (
        <BulkActionBar testId="import-bulk-action-bar" count={selectedCount}>
          <Button variant="secondary" size="sm" onClick={() => navigate('/wallet')}>Cancel</Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleImport()}
            disabled={importing || includedCount === 0}
            data-testid="import-confirm-btn"
          >
            {importing ? 'Importing…' : `Import ${includedCount} transaction${includedCount !== 1 ? 's' : ''}`}
          </Button>
        </BulkActionBar>
      )}
    </div>
  )
}
