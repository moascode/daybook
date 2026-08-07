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
  matchCount: number // how many of the caller's own past rows; 0 = builtin map, not history
  totalCount: number // …out of how many categorised rows for this canonical name
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
