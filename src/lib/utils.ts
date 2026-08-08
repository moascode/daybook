import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(inputs))
}

export function formatMYR(amount: number): string {
  return new Intl.NumberFormat('ms-MY', {
    style: 'currency',
    currency: 'MYR',
    minimumFractionDigits: 2,
  }).format(amount)
}

// Chart-fill greens for money series — mirror the Tailwind `positive` token
// (brand green) so chart income matches income text elsewhere in the wallet.
export const POSITIVE_MONEY_COLOR = '#1D9E75' // positive-500
export const POSITIVE_MONEY_COLOR_FADED = '#86efb0' // positive-300 (prior-year series)

// Chart axis ticks: plain ringgit below 10k ("2500"), thousands above ("12k").
// Avoids the "0k" ticks a fixed /1000 formatter produces on typical amounts.
export function formatAxisMYR(value: number): string {
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 1000)}k`
  return String(Math.round(value))
}

// C3: extracts a user-facing message from a caught mutation error — ApiError's
// message is now the server's `{error}` text (see lib/api.ts) — falling back to
// a generic message for non-Error throws (e.g. network failures).
export function errorMessage(err: unknown, fallback = 'Something went wrong — please try again.'): string {
  return err instanceof Error && err.message ? err.message : fallback
}

export function generateId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// §5.4: the one month-range implementation. Local year/month arithmetic only —
// never toISOString(), which converts to UTC and shifts the date by up to a day
// in non-UTC timezones (the §1.1 bug). offset 0 = this month, -1 = last month.
export function monthRange(offset: number): { dateFrom: string; dateTo: string } {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1) // normalises overflow/underflow
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const lastDay = new Date(y, d.getMonth() + 1, 0).getDate()
  return {
    dateFrom: `${y}-${m}-01`,
    dateTo: `${y}-${m}-${String(lastDay).padStart(2, '0')}`,
  }
}

// §6.4: which date-range preset matches a from/to pair. Lets the filter bar
// show the active segment and tell "default this-month" apart from a narrowed
// range (clear-all visibility) without storing a separate preset state.
export type DateRangePreset =
  | 'this-month'
  | 'last-month'
  | 'last-3-months'
  | 'last-12-months'
  | 'all-time'
  | 'custom'

// Trailing window of `months` calendar months INCLUDING the current one,
// ending today — not ending on the last day of the current month, since the
// window is meant to read as "up to right now." E.g. trailingRange(3) on
// 4 Aug 2026 → 1 Jun 2026 through 4 Aug 2026. Local Date arithmetic only, for
// the same §1.1 reason monthRange avoids toISOString().
export function trailingRange(months: number): { dateFrom: string; dateTo: string } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1)
  const y = start.getFullYear()
  const m = String(start.getMonth() + 1).padStart(2, '0')
  return { dateFrom: `${y}-${m}-01`, dateTo: todayISO() }
}

export function dateRangePreset({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }): DateRangePreset {
  const thisMonth = monthRange(0)
  if (dateFrom === thisMonth.dateFrom && dateTo === thisMonth.dateTo) return 'this-month'
  const lastMonth = monthRange(-1)
  if (dateFrom === lastMonth.dateFrom && dateTo === lastMonth.dateTo) return 'last-month'
  const last3 = trailingRange(3)
  if (dateFrom === last3.dateFrom && dateTo === last3.dateTo) return 'last-3-months'
  const last12 = trailingRange(12)
  if (dateFrom === last12.dateFrom && dateTo === last12.dateTo) return 'last-12-months'
  if (!dateFrom && !dateTo) return 'all-time'
  return 'custom'
}

// §5.9: the one equal-split implementation. Splits `amount` into n cent-exact
// shares; index 0 is the payer/owner, who absorbs the rounding remainder
// (owner-absorbs rule, §2.1 owner decision). Mirrored in server/lib.ts —
// keep the two in sync.
export function splitEqually(amount: number, n: number): number[] {
  if (n <= 0) return []
  // B-09: work in integer cents so a cleanly divisible amount splits exactly
  // (RM8.20 ÷ 4 = 2.05 each, not 2.08/2.04/2.04/2.04). Index 0 (owner) absorbs
  // the leftover cents from an uneven division.
  const cents = Math.round(amount * 100)
  const base = Math.floor(cents / n)
  const remainder = cents - base * n
  return [(base + remainder) / 100, ...Array<number>(n - 1).fill(base / 100)]
}

// Converts percentages (expected to sum to 100) into cent-exact amounts.
// Index 0 (owner) absorbs the rounding remainder — mirrors splitEqually above.
// Client-only: the server never sees percentages, only the resulting amounts.
export function splitByPercents(amount: number, percents: number[]): number[] {
  if (percents.length === 0) return []
  const cents = Math.round(amount * 100)
  const others = percents.slice(1).map((p) => Math.round((cents * p) / 100))
  const ownerCents = cents - others.reduce((sum, c) => sum + c, 0)
  return [ownerCents / 100, ...others.map((c) => c / 100)]
}

export function todayISO(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function nowISO(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

/**
 * True when the build should expose e2e test hooks (window.__test* helpers and
 * the UAT Tests nav entry).
 *
 * Previously these were gated on `import.meta.env.DEV` alone, which worked while
 * the e2e suite ran against the Vite dev server. Under Workers the suite runs
 * against a production build served by `wrangler dev` — DEV is false there, so
 * every hook disappeared and nine specs failed.
 *
 * VITE_E2E is set only by the Playwright build step, so real production bundles
 * still contain none of this.
 */
export const TEST_HOOKS_ENABLED =
  import.meta.env.DEV || import.meta.env.VITE_E2E === '1'
