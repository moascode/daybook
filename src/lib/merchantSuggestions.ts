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
 * caller's own categorised history (plus a builtin cold-start map). Never
 * throws — a failed call must degrade to no suggestions rather than an error
 * screen, so the caller always gets a (possibly empty) array back.
 */
export async function suggestCategories(merchants: string[]): Promise<MerchantSuggestion[]> {
  if (merchants.length === 0) return []
  try {
    const { suggestions } = await api.post<{ suggestions: MerchantSuggestion[] }>(
      '/transactions/suggest-categories',
      { merchants },
    )
    return suggestions
  } catch {
    return []
  }
}

/**
 * Ask Claude for a category suggestion per merchant string, for the leftover
 * the rule-based pass above found nothing for (docs/ai-bulk-categorize-feature.md).
 * Same never-throws contract as suggestCategories() — a failed call degrades
 * to no suggestions, never an error screen. `matchCount: -1` on the returned
 * rows marks them as AI-sourced.
 */
export async function suggestCategoriesAI(merchants: string[]): Promise<MerchantSuggestion[]> {
  if (merchants.length === 0) return []
  try {
    const { suggestions } = await api.post<{ suggestions: MerchantSuggestion[] }>(
      '/transactions/suggest-categories-ai',
      { merchants },
    )
    return suggestions
  } catch {
    return []
  }
}
