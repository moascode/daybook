import type { ReactNode } from 'react'
import { AlertTriangle, Inbox, X } from 'lucide-react'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { DatePicker } from '@/components/ui/DatePicker'
import { Badge } from '@/components/ui/Badge'
import { cn, formatMYR } from '@/lib/utils'
import type { ImportRow } from '@/lib/csv'
import type { Account, Category } from '@/types/wallet.types'

interface CsvReviewTableProps {
  rows: ImportRow[]
  categories: Category[]
  /** Accounts eligible as a transfer destination (writable), excluding the import target. */
  destinationAccounts: Account[]
  /**
   * Capture inbox (R18): when supplied, each row gets its own Account cell.
   * CSV and photo import leave this undefined — those rows all land in the one
   * account chosen in the review header, so a per-row column would be noise.
   */
  accountOptions?: Account[]
  onRowChange: (index: number, updates: Partial<ImportRow>) => void
  onToggleInclude: (index: number) => void
  /** Nulls every pre-filled category — a category the user chose by hand is untouched. */
  onClearSuggestions: () => void
  /**
   * Photo import (P2, approved 2026-09-06): adds a Source photo column
   * (filename, not a thumbnail — see the cell's own comment) ahead of
   * Description, which now carries the raw statement line for a statement
   * row (docs/archive/design-adoption/feature-photo-import.md §7, amended). CSV rows never
   * set this — a review session is always all-CSV or all-photo, never mixed.
   */
  photoMode?: boolean
  /** A4 (approved 2026-09-06) — gates the "Ask AI to suggest" action. No key, no button. */
  hasAnthropicKey: boolean
  askingAI: boolean
  aiMessage: { tone: 'error' | 'info'; text: string } | null
  /** Asks Claude for the rows still uncategorised after the rules pass. */
  onAskAI: () => void
  /**
   * Same split as category suggestion: the automatic on-import pass only
   * runs the free rules ladder (corrections cache + own history) — AI is
   * reached only via this explicit "Ask AI to resolve merchant names"
   * action, for whatever the rules pass left unresolved (`row.merchantUnresolved`).
   */
  resolvingMerchants: boolean
  merchantAiMessage: { tone: 'error' | 'info'; text: string } | null
  onResolveMerchantsAI: () => void
}

export function CsvReviewTable({
  rows,
  categories,
  destinationAccounts,
  accountOptions,
  onRowChange,
  onToggleInclude,
  onClearSuggestions,
  photoMode,
  hasAnthropicKey,
  askingAI,
  aiMessage,
  onAskAI,
  resolvingMerchants,
  merchantAiMessage,
  onResolveMerchantsAI,
}: CsvReviewTableProps) {
  // Category options valid for a row's direction — an income category must not
  // be selectable on an expense row (matches TransactionForm/RecurringPage).
  const categoryOptionsFor = (type: 'income' | 'expense') => [
    { value: '', label: 'No category' },
    ...categories
      .filter((c) => c.type === type || c.type === 'both')
      .map((c) => ({ value: c.id, label: c.name })),
  ]

  const typeOptions = [
    { value: 'expense', label: 'Expense' },
    { value: 'income', label: 'Income' },
    { value: 'transfer', label: 'Transfer' },
  ]

  const destinationOptions = [
    { value: '', label: 'To account…' },
    ...destinationAccounts.map((a) => ({ value: a.id, label: a.name })),
  ]

  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-fg-faint">
        No rows to import.
      </div>
    )
  }

  const suggestedCount = rows.filter((r) => r.suggestionApplied).length
  // Same "affected" shape BulkEditDialog's noSuggestionCount uses: transfers
  // are never categorised, and an excluded row isn't going anywhere either.
  const uncategorizedCount = rows.filter(
    (r) => r.included && r.type !== 'transfer' && !r.categoryId,
  ).length
  const merchantUnresolvedCount = rows.filter((r) => r.included && r.merchantUnresolved).length
  // Narrative-split rows the rules pass (or a prior "Ask AI" click) already
  // resolved — same "affected" shape as suggestedCount above, so the banner
  // reads identically: "N still need X · M filled in automatically".
  const merchantResolvedCount = rows.filter(
    (r) => r.included && r.narrativeRaw && !r.merchantUnresolved,
  ).length

  return (
    <div>
      {(merchantResolvedCount > 0 || merchantUnresolvedCount > 0) && (
        <div
          data-testid="csv-merchant-banner"
          className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-surface-sunken border border-line px-3 py-2 text-xs text-fg-subtle"
        >
          <span>
            {merchantUnresolvedCount > 0 ? (
              <>
                <span className="text-fg-muted">
                  {merchantUnresolvedCount} row{merchantUnresolvedCount !== 1 ? 's' : ''} still {merchantUnresolvedCount !== 1 ? 'need' : 'needs'} merchant cleanup
                  {!hasAnthropicKey && (
                    <>
                      {' — set an '}
                      <a href="/settings/ai" className="underline">Anthropic API key in Settings</a>
                      {' to ask AI'}
                    </>
                  )}
                </span>
                {merchantResolvedCount > 0 && (
                  <span className="text-fg-faint"> · {merchantResolvedCount} cleaned up automatically</span>
                )}
              </>
            ) : (
              <span className="text-fg-muted">
                {merchantResolvedCount} row{merchantResolvedCount !== 1 ? 's' : ''} cleaned up automatically
              </span>
            )}
          </span>
          {merchantUnresolvedCount > 0 && hasAnthropicKey && (
            <button
              type="button"
              onClick={onResolveMerchantsAI}
              disabled={resolvingMerchants}
              data-testid="csv-ask-ai-merchants"
              className="flex-shrink-0 font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50"
            >
              {resolvingMerchants ? 'Asking AI…' : 'Ask AI to clean up'}
            </button>
          )}
        </div>
      )}
      {merchantAiMessage && (
        <p
          data-testid="csv-merchant-ai-message"
          className={cn(
            'mb-3 rounded-lg px-3 py-2 text-xs',
            merchantAiMessage.tone === 'error' ? 'bg-red-50 text-red-700' : 'bg-surface-sunken text-fg-subtle',
          )}
        >
          {merchantAiMessage.text}
        </p>
      )}
      {(suggestedCount > 0 || uncategorizedCount > 0) && (
        <div
          data-testid="csv-suggestions-banner"
          className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-surface-sunken border border-line px-3 py-2 text-xs text-fg-subtle"
        >
          <span>
            {uncategorizedCount > 0 ? (
              <>
                <span className="text-fg-muted">
                  {uncategorizedCount} row{uncategorizedCount !== 1 ? 's' : ''} still {uncategorizedCount !== 1 ? 'need' : 'needs'} a category
                  {!hasAnthropicKey && (
                    <>
                      {' — set an '}
                      <a href="/settings/ai" className="underline">Anthropic API key in Settings</a>
                      {' to ask AI'}
                    </>
                  )}
                </span>
                {suggestedCount > 0 && (
                  <span className="text-fg-faint"> · {suggestedCount} filled in automatically</span>
                )}
              </>
            ) : (
              <span className="text-fg-muted">
                {suggestedCount} row{suggestedCount !== 1 ? 's' : ''} filled in automatically
              </span>
            )}
          </span>
          <div className="flex flex-shrink-0 items-center gap-2">
            {uncategorizedCount > 0 && hasAnthropicKey && (
              <button
                type="button"
                onClick={onAskAI}
                disabled={askingAI}
                data-testid="csv-ask-ai"
                className="font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50"
              >
                {askingAI ? 'Asking AI…' : 'Ask AI to suggest'}
              </button>
            )}
            {uncategorizedCount > 0 && hasAnthropicKey && suggestedCount > 0 && (
              <div className="h-4 w-px bg-line" />
            )}
            {suggestedCount > 0 && (
              <button
                type="button"
                onClick={onClearSuggestions}
                aria-label="Clear suggestions"
                title="Clear suggestions"
                className="flex-shrink-0 rounded-full p-1 text-fg-faint hover:bg-surface-hover hover:text-fg-muted"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      )}
      {aiMessage && (
        <p
          data-testid="csv-ai-message"
          className={cn(
            'mb-3 rounded-lg px-3 py-2 text-xs',
            aiMessage.tone === 'error' ? 'bg-red-50 text-red-700' : 'bg-surface-sunken text-fg-subtle',
          )}
        >
          {aiMessage.text}
        </p>
      )}
    {/* `md:overflow-x-auto` is a safety net only — the fixed-width colgroup
        below is sized to fit a 1280px viewport without horizontal scroll
        (the whole point of this layout: the old fixed w-36/w-40/w-48 inputs
        pushed the table past 1280px of content). Below `md` the table
        reflows into stacked cards (see each cell's `md:table-cell` below) so
        there's nothing to scroll there either. */}
    <div className="md:overflow-x-auto">
      <table className="block w-full text-sm md:table md:table-fixed">
        <colgroup className="hidden md:table-column-group">
          {/* Fixed widths for the short controls (a native date input, an
              amount, a three-option select) so they never truncate; Merchant
              has no width and absorbs whatever is left. */}
          <col style={{ width: '2.5rem' }} />
          <col style={{ width: '8.5rem' }} />
          <col />
          <col style={{ width: '6.5rem' }} />
          <col style={{ width: '7.5rem' }} />
          <col style={{ width: accountOptions ? '10rem' : '12rem' }} />
          {accountOptions && <col style={{ width: '9.5rem' }} />}
        </colgroup>
        <thead className="hidden md:table-header-group">
          <tr className="border-b border-line text-left">
            <th className="px-1.5 py-2 font-medium text-fg-subtle">
              <span className="sr-only">Include</span>
            </th>
            <th className="px-1.5 py-2 font-medium text-fg-subtle">Date</th>
            <th className="px-1.5 py-2 font-medium text-fg-subtle">Merchant</th>
            <th className="px-1.5 py-2 font-medium text-fg-subtle">Amount</th>
            <th className="px-1.5 py-2 font-medium text-fg-subtle">Type</th>
            <th className="px-1.5 py-2 font-medium text-fg-subtle">Category</th>
            {accountOptions && <th className="px-1.5 py-2 font-medium text-fg-subtle">Account</th>}
          </tr>
        </thead>
        <tbody className="block divide-y divide-line-subtle md:table-row-group">
          {rows.map((row, index) => (
            <tr
              key={index}
              data-testid="csv-review-row"
              className={cn(
                'grid grid-cols-2 gap-2 p-3 transition-colors md:table-row md:gap-0 md:p-0',
                !row.included && 'bg-surface-sunken opacity-60',
                row.included && row.suggestionApplied && 'bg-surface-sunken',
                row.isDuplicate && 'bg-amber-50/50'
              )}
            >
              {/* Checkbox */}
              <td className="block px-3 py-2 max-md:border-0 md:table-cell md:px-1.5">
                <input
                  type="checkbox"
                  checked={row.included}
                  onChange={() => onToggleInclude(index)}
                  className="h-4 w-4 rounded border-line-strong text-brand-500 focus:ring-brand-500"
                  data-testid="csv-row-include"
                  aria-label={`Include row ${index + 1}`}
                />
              </td>

              {/* Date */}
              <td className="block px-3 py-2 max-md:border-0 md:table-cell md:px-1.5">
                <Caption>Date</Caption>
                <DatePicker
                  value={row.date}
                  onChange={(e) =>
                    onRowChange(index, { date: e.target.value })
                  }
                  className="w-full min-w-0 text-xs"
                  disabled={!row.included}
                  data-testid="csv-row-date"
                />
              </td>

              {/* Merchant — editable so a garbled bank column can be fixed here (U-14).
                  Secondary info (description, source photo, duplicate/pending-capture
                  flags) folds into this cell as a subline rather than its own column —
                  the whole point of this layout, which used to run 10 fixed-width
                  columns well past a 1280px viewport. */}
              <td className="col-span-2 block px-3 py-2 max-md:border-0 align-top md:table-cell md:px-1.5">
                <Caption>Merchant</Caption>
                <div className="flex items-center gap-1.5 [&>div:first-child]:min-w-0 [&>div:first-child]:flex-1">
                  <Input
                    value={row.merchant}
                    onChange={(e) =>
                      // A merchant edit invalidates the suggestion's provenance
                      // (G11: it is never re-run under the cursor), so the
                      // caption/tint drop even though the pre-filled category
                      // itself is left alone. It also resolves the "couldn't
                      // clean up" marker — the user has fixed it by hand.
                      onRowChange(index, {
                        merchant: e.target.value,
                        suggestedFrom: undefined,
                        suggestionApplied: false,
                        merchantUnresolved: false,
                      })
                    }
                    className="w-full min-w-0 text-xs"
                    placeholder="—"
                    disabled={!row.included}
                    aria-label={`Merchant for row ${index + 1}`}
                  />
                  {row.merchantUnresolved && (
                    <span
                      className="flex shrink-0 items-center text-amber-600"
                      title="Couldn't clean up this merchant name automatically — showing the automatic guess"
                    >
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="sr-only">Merchant name not resolved automatically</span>
                    </span>
                  )}
                </div>

                {/* Description — always a visible, compact control (rather than a
                    click-to-reveal) so `Description for row N` keeps resolving to a
                    real textbox with a real value for every row, no extra click
                    needed — for a photo-imported statement row this is the raw line
                    as printed (worker/lib/anthropic.ts's PhotoImportRow), empty for a
                    receipt row (there is no raw line separate from the merchant name
                    to preserve). */}
                <Input
                  value={row.description}
                  onChange={(e) =>
                    onRowChange(index, { description: e.target.value })
                  }
                  className="mt-1 h-7 w-full min-w-0 px-2 text-[11px]"
                  placeholder="Add description"
                  disabled={!row.included}
                  aria-label={`Description for row ${index + 1}`}
                />

                {/* Source photo — the filename, not a thumbnail: at this scale a
                    thumbnail is too small to tell photos apart in a multi-photo
                    batch, while the filename (already meaningful — it's the name
                    the user's phone or bank app gave the photo) reliably answers
                    "which photo produced this row". */}
                {photoMode && row.photoFileName && (
                  row.photoUrl ? (
                    <a
                      href={row.photoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 block max-w-full truncate text-[11px] text-accent-fg underline decoration-dotted"
                      title={`Open ${row.photoFileName} at full size`}
                    >
                      {row.photoFileName}
                    </a>
                  ) : (
                    <span
                      className="mt-1 block max-w-full truncate text-[11px] text-fg-faint"
                      title={row.photoFileName}
                    >
                      {row.photoFileName}
                    </span>
                  )
                )}

                {(row.isDuplicate ||
                  (row.pendingCaptureOf && row.pendingCaptureOf.length > 0) ||
                  (row.possibleDuplicateOf && row.possibleDuplicateOf.length > 0)) && (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {row.isDuplicate && <Badge variant="warning">Duplicate</Badge>}
                    {/* R18 gap 1 — a capture is WAITING for this payment. Worded
                        apart from the possible-duplicate hint below because it
                        says something different and more actionable: the ledger
                        does not have this row, your inbox does. */}
                    {!row.isDuplicate && row.pendingCaptureOf && row.pendingCaptureOf.length > 0 && (
                      <span
                        className="flex shrink-0 items-center text-amber-600"
                        data-testid="csv-pending-capture-match"
                        title={`A capture for ${row.pendingCaptureOf[0].merchant || 'this payment'} on ${row.pendingCaptureOf[0].date} is already waiting in your inbox — importing this as well would count it twice`}
                      >
                        <Inbox className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className="sr-only">A matching capture is waiting in your inbox</span>
                      </span>
                    )}
                    {!row.isDuplicate && row.possibleDuplicateOf && row.possibleDuplicateOf.length > 0 && (
                      <span
                        className="flex shrink-0 items-center text-amber-600"
                        data-testid="csv-possible-duplicate"
                        title={`${
                          row.possibleDuplicateOf[0].fromCapture
                            ? `Might be the same payment as the captured "${row.possibleDuplicateOf[0].merchant}"`
                            : `Might match ${row.possibleDuplicateOf[0].merchant}`
                        } on ${row.possibleDuplicateOf[0].date}${
                          row.possibleDuplicateOf.length > 1 ? ` (+${row.possibleDuplicateOf.length - 1} more)` : ''
                        } — check before importing`}
                      >
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className="sr-only">Possible duplicate — not auto-excluded</span>
                      </span>
                    )}
                  </div>
                )}
              </td>

              {/* Amount */}
              <td className="block px-3 py-2 max-md:border-0 md:table-cell md:px-1.5">
                <Caption>Amount</Caption>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={row.amount}
                  onChange={(e) =>
                    onRowChange(index, {
                      amount: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full min-w-0 text-xs"
                  disabled={!row.included}
                  data-testid="csv-row-amount"
                />
              </td>

              {/* Type */}
              <td className="block px-3 py-2 max-md:border-0 md:table-cell md:px-1.5">
                <Caption>Type</Caption>
                <Select
                  options={typeOptions}
                  data-testid="csv-row-type"
                  value={row.type}
                  onChange={(e) => {
                    const type = e.target.value as ImportRow['type']
                    if (type === 'transfer') {
                      // Transfers are uncategorised; the destination is chosen next.
                      onRowChange(index, {
                        type,
                        categoryId: null,
                        suggestedFrom: undefined,
                        suggestionApplied: false,
                      })
                      return
                    }
                    // Drop a now-invalid category when the direction flips, so an
                    // income category can't linger on an expense row.
                    const stillValid = categoryOptionsFor(type).some(
                      (o) => o.value === (row.categoryId ?? ''),
                    )
                    onRowChange(index, {
                      type,
                      categoryId: stillValid ? row.categoryId : null,
                      destinationAccountId: null,
                      ...(stillValid ? {} : { suggestedFrom: undefined, suggestionApplied: false }),
                    })
                  }}
                  className="w-full min-w-0 text-xs"
                  disabled={!row.included}
                  aria-label={`Type for row ${index + 1}`}
                />
              </td>

              {/* Category — or destination account for transfer rows */}
              <td className="block px-3 py-2 max-md:border-0 align-top md:table-cell md:px-1.5">
                <Caption>{row.type === 'transfer' ? 'To account' : 'Category'}</Caption>
                {row.type === 'transfer' ? (
                  <Select
                    options={destinationOptions}
                    data-testid="csv-row-destination"
                    value={row.destinationAccountId ?? ''}
                    onChange={(e) =>
                      onRowChange(index, {
                        destinationAccountId: e.target.value || null,
                      })
                    }
                    className="w-full min-w-0 text-xs"
                    disabled={!row.included}
                    aria-label={`Destination account for row ${index + 1}`}
                  />
                ) : (
                  <>
                    <Select
                      options={categoryOptionsFor(row.type)}
                      data-testid="csv-row-category"
                      value={row.categoryId ?? ''}
                      onChange={(e) =>
                        // A hand-picked category overrides the suggestion —
                        // clear its provenance so the caption/tint drop too.
                        onRowChange(index, {
                          categoryId: e.target.value || null,
                          suggestedFrom: undefined,
                          suggestionApplied: false,
                        })
                      }
                      className="w-full min-w-0 text-xs"
                      disabled={!row.included}
                    />
                    {row.suggestionApplied && row.suggestedFrom && (
                      <p className="mt-1 text-[11px] text-fg-subtle">
                        {row.suggestedFrom.canonical} ·{' '}
                        {row.suggestedFrom.matchCount > 0
                          ? `you categorised this ${row.suggestedFrom.matchCount}×`
                          : 'common merchant'}
                      </p>
                    )}
                  </>
                )}
              </td>

              {/* Account — capture inbox only. A capture carries its own card,
                  so unlike CSV/photo it cannot inherit one account for the
                  whole batch. An unmapped card is FLAGGED rather than quietly
                  filed to the default account (rule 13). Moved to the end of
                  the row (it used to sit right after Merchant) so the primary
                  columns — Date, Merchant, Amount, Type, Category — stay in a
                  consistent order whether or not this column is present. */}
              {accountOptions && (
                <td className="block px-3 py-2 max-md:border-0 align-top md:table-cell md:px-1.5">
                  <Caption>Account</Caption>
                  <div className="flex items-center gap-1.5 [&>div:first-child]:min-w-0 [&>div:first-child]:flex-1">
                    <Select
                      value={row.accountId ?? ''}
                      onChange={(e) => onRowChange(index, { accountId: e.target.value, accountUnmapped: false })}
                      options={accountOptions.map((a) => ({ value: a.id, label: a.name }))}
                      className="w-full min-w-0 text-xs"
                      disabled={!row.included}
                      aria-label={`Account for row ${index + 1}`}
                      data-testid="capture-row-account"
                    />
                    {row.accountUnmapped && (
                      <span
                        className="flex shrink-0 items-center text-amber-600"
                        title={`"${row.rawCard || 'Unknown card'}" isn't mapped to an account yet — check this one`}
                        data-testid="capture-row-unmapped"
                      >
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className="sr-only">Card not mapped to an account</span>
                      </span>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Summary */}
      <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-line px-3 py-3 text-xs text-fg-subtle">
        <span>
          Total rows: {rows.length}
        </span>
        <span>
          To import: {rows.filter((r) => r.included).length}
        </span>
        <span>
          Duplicates: {rows.filter((r) => r.isDuplicate).length}
        </span>
        <span>
          Excluded: {rows.filter((r) => !r.included && !r.isDuplicate).length}
        </span>
        <span className="ml-auto font-medium text-fg-muted">
          Total amount: {formatMYR(
            rows
              .filter((r) => r.included)
              .reduce((sum, r) => sum + r.amount, 0)
          )}
        </span>
      </div>
    </div>
    </div>
  )
}

/** Visual-only mobile cell label — never a `<label>` element, so it can't be
 *  matched by `getByLabel`'s substring search (CLAUDE.md §3 Tests trap) and
 *  can't collide with a control's own `aria-label`. Hidden from assistive
 *  tech too: the control below it already carries the real accessible name,
 *  or (for Date/Amount/Type, which have none) the desktop `<th>` does. */
function Caption({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden="true" className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-fg-faint md:hidden">
      {children}
    </span>
  )
}
