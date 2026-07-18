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

export function generateId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
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
