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
