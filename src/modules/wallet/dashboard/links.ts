/**
 * Build a link into the transaction list.
 *
 * Always states the date range explicitly: the dashboard links to a month that
 * is not necessarily the current one, and the list's default current-month
 * window would silently hide every row the link was pointing at.
 */
export function transactionsLink(params: {
  categoryId?: string
  dateFrom?: string
  dateTo?: string
}): string {
  const q = new URLSearchParams()
  if (params.categoryId) q.set('category', params.categoryId)
  if (params.dateFrom) q.set('dateFrom', params.dateFrom)
  if (params.dateTo) q.set('dateTo', params.dateTo)
  return `/wallet?${q.toString()}`
}
