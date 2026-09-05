/**
 * Pure aggregation for the Accounts page's composition card and net-worth
 * history chart. No React, no fetching — everything here is arithmetic over
 * accounts/transactions already loaded by the page.
 *
 * Both figures are real reconstructions, never fabricated: a balance at any
 * past date is opening balance + every transaction touching the account up
 * to that date, the same formula the server uses for the CURRENT balance
 * (`worker/routes/wallet.ts` `/accounts/:id/balance`) — just evaluated at an
 * earlier cutoff instead of "now".
 */
import { format, parseISO } from 'date-fns'
import { ACCOUNT_TYPE_LABELS } from '@/lib/accountDisplay'
import { daysBetween, monthBounds, monthKey, shiftMonth } from '@/modules/wallet/dashboard/insights'
import type { Account, Transaction } from '@/types/wallet.types'

/** CSS custom property (without `var()`) used for each account type's slice/legend dot. */
export const TYPE_COLOR_VAR: Record<Account['type'], string> = {
  bank: '--info',
  cash: '--pos',
  'e-wallet': '--warn',
  card: '--neg',
  investment: '--calm',
  other: '--fg-subtle',
}

/**
 * `{bg, fg}` CSS custom property pair for each account type, used for the
 * account card's icon mark — the same semantic tokens the mockup's own
 * `.acct-mark` backgrounds use (`background:rgb(var(--info-bg))` etc.), not
 * the account's user-chosen accent colour. Keeps every account card's icon
 * mark on the same theme as Overview's featured-account card and this page's
 * own composition legend, instead of six cards each carrying a different
 * custom hex. `other` has no semantic accent family, so it falls back to the
 * neutral surface/muted-text pair used elsewhere for "no particular colour".
 */
export const TYPE_ACCENT_VAR: Record<Account['type'], { bg: string; fg: string }> = {
  bank: { bg: '--info-bg', fg: '--info-fg' },
  cash: { bg: '--pos-bg', fg: '--pos-fg' },
  'e-wallet': { bg: '--warn-bg', fg: '--warn-fg' },
  card: { bg: '--neg-bg', fg: '--neg-fg' },
  investment: { bg: '--calm-bg', fg: '--calm-fg' },
  other: { bg: '--surface-sunk', fg: '--fg-muted' },
}

export interface CompositionRow {
  type: Account['type']
  label: string
  amount: number
  /** 0-100, share of total absolute balance across all rows. */
  share: number
  colorVar: string
}

/**
 * Own-account balances grouped by their real `type` (§ decision: map to our
 * own account types, not the mockup's fictional Savings/Investments/Cash/Card
 * debt buckets). Returns [] when every balance nets to ~0 — nothing to show.
 */
export function computeComposition(accounts: Account[], balances: Record<string, number>): CompositionRow[] {
  const totals = new Map<Account['type'], number>()
  for (const a of accounts) {
    const balance = balances[a.id] ?? 0
    totals.set(a.type, (totals.get(a.type) ?? 0) + balance)
  }

  const totalAbs = Array.from(totals.values()).reduce((sum, v) => sum + Math.abs(v), 0)
  if (totalAbs < 0.005) return []

  return Array.from(totals.entries())
    .filter(([, amount]) => Math.abs(amount) >= 0.005)
    .map(([type, amount]) => ({
      type,
      label: ACCOUNT_TYPE_LABELS[type],
      amount,
      share: (Math.abs(amount) / totalAbs) * 100,
      colorVar: TYPE_COLOR_VAR[type],
    }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
}

/** What an account's balance changes by when one transaction touches it. */
function accountDelta(t: Transaction, accountId: string): number {
  if (t.isNonCash) return 0
  if (t.accountId === accountId) {
    if (t.type === 'income') return t.amount
    if (t.type === 'expense') return -t.amount
    if (t.type === 'transfer') return -t.amount
  }
  if (t.destinationAccountId === accountId && t.type === 'transfer') return t.amount
  return 0
}

/**
 * One account's real balance as of `asOfDate` (inclusive), reconstructed from
 * its ledger. Genuinely $0 — not the opening balance — for any date before
 * the account existed: that money wasn't part of anyone's net worth yet, so
 * this is the honest value for a pre-creation date, not a gap to be hidden.
 */
export function accountBalanceAsOf(account: Account, txns: Transaction[], asOfDate: string): number {
  if (asOfDate < account.createdAt.slice(0, 10)) return 0
  let balance = account.openingBalance
  for (const t of txns) {
    if (t.date > asOfDate) continue
    balance += accountDelta(t, account.id)
  }
  return balance
}

export interface AccountMonthChange {
  amount: number
  /** Percent change vs the start-of-month balance; null when that balance is ~0 (division makes no sense). */
  percent: number | null
}

/**
 * One account's real month-to-date movement — current balance minus its real
 * balance at the end of last month, reconstructed from the ledger the same
 * way the net-worth chart is. Returns null when the account didn't exist for
 * the full prior month (no honest "vs last month" for a brand-new account),
 * matching the same guard the page-level summary chip uses.
 */
export function accountMonthChange(account: Account, txns: Transaction[], currentBalance: number, todayIso: string): AccountMonthChange | null {
  const prevMonth = shiftMonth(monthKey(todayIso), -1)
  if (monthKey(account.createdAt) > prevMonth) return null
  const priorBalance = accountBalanceAsOf(account, txns, monthBounds(prevMonth).to)
  const amount = currentBalance - priorBalance
  const percent = Math.abs(priorBalance) >= 0.005 ? (amount / Math.abs(priorBalance)) * 100 : null
  return { amount, percent }
}

/**
 * The most recent date any transaction touched this account (as either leg),
 * regardless of `isNonCash` — this is "when did something last happen here",
 * not a balance computation. Null when the account has no transactions yet.
 */
export function accountLastActivityDate(account: Account, txns: Transaction[]): string | null {
  let latest: string | null = null
  for (const t of txns) {
    if (t.accountId !== account.id && t.destinationAccountId !== account.id) continue
    if (latest === null || t.date > latest) latest = t.date
  }
  return latest
}

/** "Updated today" / "Updated 3 days ago" / "No activity yet" — the account card's foot-row label. */
export function formatLastActivity(lastActivityDate: string | null, todayIso: string): string {
  if (lastActivityDate === null) return 'No activity yet'
  const daysAgo = daysBetween(lastActivityDate, todayIso) - 1
  if (daysAgo <= 0) return 'Updated today'
  if (daysAgo === 1) return 'Updated yesterday'
  if (daysAgo < 7) return `Updated ${daysAgo} days ago`
  if (daysAgo < 30) return `Updated ${Math.floor(daysAgo / 7)}w ago`
  return `Updated ${Math.floor(daysAgo / 30)}mo ago`
}

/**
 * The next date a card's statement closes — the closest occurrence of
 * `statementDay` that is today or later. Clamped to the last real day of a
 * shorter month (e.g. day 31 in February lands on the 28th/29th) rather than
 * overflowing into the next month.
 */
export function nextStatementDate(statementDay: number, todayIso: string): string {
  const clampedThisMonth = Math.min(statementDay, Number(monthBounds(monthKey(todayIso)).to.slice(8, 10)))
  const thisMonthDate = `${monthKey(todayIso)}-${String(clampedThisMonth).padStart(2, '0')}`
  if (thisMonthDate >= todayIso) return thisMonthDate
  const nextMonth = shiftMonth(monthKey(todayIso), 1)
  const clampedNextMonth = Math.min(statementDay, Number(monthBounds(nextMonth).to.slice(8, 10)))
  return `${nextMonth}-${String(clampedNextMonth).padStart(2, '0')}`
}

/** "Statement 28 Aug" — the account card's foot-row label for a card with a statement day set. */
export function formatStatementDate(statementDay: number, todayIso: string): string {
  return `Statement ${format(parseISO(nextStatementDate(statementDay, todayIso)), 'd MMM')}`
}

export interface NetWorthPoint {
  month: string
  /** The date the balance was evaluated at — today for the in-progress month, month-end otherwise. */
  asOf: string
  label: string
  value: number
  /**
   * Real net worth at the end of the PRECEDING month — for month 2..12 this
   * is just the previous point's own `value`, but for month 1 it reaches one
   * month further back than the visible window, via the same
   * `accountBalanceAsOf` reconstruction. An account already years old by the
   * time the 12-month window starts still has a real prior month; hardcoding
   * "no delta" for the first bar just because it's first was the bug — the
   * data exists, it just wasn't fetched.
   */
  previousValue: number
}

const NET_WORTH_MONTHS = 12

/**
 * Real month-end net worth for the trailing 12 months, always — an account
 * that didn't exist yet contributes a genuine $0 for those months
 * (`accountBalanceAsOf` returns 0 before an account's creation date), so
 * this is never padded with fabricated figures, just an honest zero for
 * "not open yet". `txns` should be the full, unfiltered transaction history
 * for `accounts` (all-time), not a date-ranged slice.
 */
export function computeMonthlyNetWorth(accounts: Account[], txns: Transaction[], todayIso: string): NetWorthPoint[] {
  if (accounts.length === 0) return []

  const currentMonth = monthKey(todayIso)
  const startMonth = shiftMonth(currentMonth, -(NET_WORTH_MONTHS - 1))

  const months: string[] = []
  for (let m = startMonth; m <= currentMonth; m = shiftMonth(m, 1)) {
    months.push(m)
    if (months.length >= NET_WORTH_MONTHS) break // guard against a bad date never reaching currentMonth
  }

  const valueAt = (asOf: string) => accounts.reduce((sum, a) => sum + accountBalanceAsOf(a, txns, asOf), 0)

  // One extra month before the window, purely to seed the first point's `previousValue`.
  let previous = valueAt(monthBounds(shiftMonth(startMonth, -1)).to)

  return months.map((month) => {
    const asOf = month === currentMonth ? todayIso : monthBounds(month).to
    const value = valueAt(asOf)
    const label = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)
      .toLocaleDateString('en-US', { month: 'short' })
    const point = { month, asOf, value, label, previousValue: previous }
    previous = value
    return point
  })
}

/** Sparkline viewBox, matching the mockup's own `<svg viewBox="0 0 220 34">` account-card sparklines. */
export const SPARKLINE_WIDTH = 220
export const SPARKLINE_HEIGHT = 34

/**
 * An SVG `<path>` `d` string tracing `values` left to right across the
 * mockup's own sparkline viewBox — real per-month balances
 * (`computeMonthlyNetWorth` called with a single account), not a decorative
 * curve. A flat (or single-point) series still produces a valid flat line
 * down the vertical centre rather than dividing by zero.
 */
export function sparklinePath(values: number[]): string {
  if (values.length === 0) return ''
  const padding = 4
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min
  const usableHeight = SPARKLINE_HEIGHT - padding * 2
  const points = values.map((v, i) => {
    const x = values.length === 1 ? 0 : (i / (values.length - 1)) * SPARKLINE_WIDTH
    const y = range === 0 ? SPARKLINE_HEIGHT / 2 : padding + (1 - (v - min) / range) * usableHeight
    return `${x},${Math.round(y * 100) / 100}`
  })
  return `M${points.join(' L')}`
}
