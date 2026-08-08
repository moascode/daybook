import { api } from '@/lib/api'

// docs/auto-categorisation-plan.md. Shared by the CSV import review step
// (src/lib/csv.ts) and the Transactions bulk-edit dialog (BulkEditDialog.tsx)
// — both suggest a category per merchant string from POST
// /transactions/suggest-categories.

export interface MerchantSuggestion {
  raw: string
  canonical: string
  categoryId: string
  categoryName: string
  categoryType: 'income' | 'expense' | 'both'
  matchCount: number // how many of the caller's own past rows; 0 = builtin map, not history
  totalCount: number // …out of how many categorised rows for this canonical name
}

/**
 * Whether a suggested category may be applied to a row of this direction.
 *
 * The route reads history across both directions and its builtin map is all
 * expense categories, so a money-in row can come back with an expense
 * suggestion. Applying it would set a category the row's own Category select
 * does not offer — the select renders blank while the value is still set, so
 * the mismatch is invisible right up until it is saved. Same rule the Category
 * selects use (TransactionForm, CsvReviewTable, BulkEditDialog).
 */
export function suggestionFitsType(
  suggestion: MerchantSuggestion,
  type: 'income' | 'expense',
): boolean {
  return suggestion.categoryType === type || suggestion.categoryType === 'both'
}

/**
 * Fetch a category suggestion per distinct merchant string, derived from the
 * caller's own categorised history (plus a builtin cold-start map).
 *
 * THROWS on failure. It used to swallow errors and return `[]`, which made a
 * broken suggestion service indistinguishable from a service that simply had
 * nothing to suggest — the user saw an empty panel either way and had no
 * reason to retry. Callers must catch and say something; suggestions are still
 * optional, so a failure should degrade the feature, not block the screen.
 */
export async function suggestCategories(merchants: string[]): Promise<MerchantSuggestion[]> {
  if (merchants.length === 0) return []
  const { suggestions } = await api.post<{ suggestions: MerchantSuggestion[] }>(
    '/transactions/suggest-categories',
    { merchants },
  )
  return suggestions
}

export interface AiSuggestionResult {
  suggestions: MerchantSuggestion[]
  /** Distinct canonical merchants the server actually asked Claude about. */
  askedMerchants: number
  /** How many of those were in a batch that failed, so have no answer. */
  failedMerchants: number
}

/**
 * Ask Claude for a category suggestion per merchant string, for the leftover
 * the rule-based pass above found nothing for (docs/ai-bulk-categorize-feature.md).
 * `matchCount: -1` on the returned rows marks them as AI-sourced.
 *
 * THROWS on failure, and reports partial failure through `failedMerchants`
 * rather than hiding it. The caller must surface both — this is a paid call
 * behind an explicit button, and the one thing it must never do is look like
 * it did nothing.
 */
export async function suggestCategoriesAI(merchants: string[]): Promise<AiSuggestionResult> {
  if (merchants.length === 0) return { suggestions: [], askedMerchants: 0, failedMerchants: 0 }
  return api.post<AiSuggestionResult>('/transactions/suggest-categories-ai', { merchants })
}
