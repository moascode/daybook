/**
 * Wallet: recurring transactions — Tier 2 feature.
 * Define weekly/monthly schedules; view upcoming entries; edit and delete rules.
 *
 * FEAT-068 rebuilt the page to mock parity: row actions now live behind a
 * single "⋯" (`RecurringRowMenu`) instead of always-visible Edit/Delete
 * buttons, and the row no longer carries a standalone "Expense" badge — its
 * sub-line reads "{account} · {category|Uncategorised}" instead. Dates are
 * relative (`businessDatePlus`), not hardcoded — CLAUDE.md §3 "never
 * hardcode a future date" (it rots into the past exactly like this file's
 * old 2026-06-* literals did).
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { format, parseISO } from 'date-fns'
import { newAppPage, fillAccountForm, navItem, businessDatePlus } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

// Far enough out that no boot-time catch-up sweep will ever treat these as
// due during this spec's run, and distinct from each other.
const NETFLIX_DUE = businessDatePlus(40)
const COFFEE_DUE = businessDatePlus(47)

/** Mirrors RecurringTable.tsx's `nextLabel` for a date that is neither today nor tomorrow. */
function nextLabelFor(dateISO: string): string {
  return format(parseISO(dateISO), 'd MMM')
}

/** Open a recurring row's "⋯" menu. */
async function openRowMenu(row: ReturnType<Page['getByTestId']>, merchant: string) {
  await row.getByRole('button', { name: `More actions for ${merchant}` }).click()
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Recurring Bank', type: 'bank' })
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Navigation ─────────────────────────────────────────────────────────

test('wallet navigation contains a "Recurring" link', async () => {
  await expect(navItem(page, 'recurring')).toBeVisible()
})

test('navigating to /wallet/recurring shows the Recurring page', async () => {
  await page.goto('/wallet/recurring')
  await expect(page).toHaveURL(/\/wallet\/recurring$/)
  await expect(page.locator('main').getByRole('heading', { name: /Recurring/i })).toBeVisible()
})

// ── Empty state ────────────────────────────────────────────────────────

test('shows empty state when no recurring rules exist', async () => {
  await expect(page.getByText(/No recurring transactions|Add your first recurring/i)).toBeVisible()
})

// ── Create monthly rule ────────────────────────────────────────────────

test('"Add recurring" button opens the form dialog', async () => {
  await page.getByRole('button', { name: /Add recurring|New Rule/i }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('recurring form has Amount, Account, Merchant, Frequency, and Next-due fields', async () => {
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel(/Amount/i)).toBeVisible()
  await expect(dialog.getByLabel(/Account/i)).toBeVisible()
  await expect(dialog.getByLabel(/Merchant|Description/i).first()).toBeVisible()
  await expect(dialog.getByLabel(/Frequency|Repeats/i)).toBeVisible()
  await expect(dialog.getByLabel(/Next due/i)).toBeVisible()
})

test('create form pre-selects the first account and defaults next-due to today', async () => {
  // §2.8: the rule form starts with the same low-friction defaults as the
  // sibling forms — an account is already chosen and the next-due date is set.
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('#account')).not.toHaveValue('')
  await expect(dialog.getByLabel(/Next due/i)).toHaveValue(/^\d{4}-\d{2}-\d{2}$/)
})

test('save a monthly recurring expense (Netflix, MYR 55)', async () => {
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/Amount/i).fill('55')
  await dialog.locator('#account, [name="account"]').selectOption('Recurring Bank')
  await dialog.getByLabel(/Merchant/i).fill('Netflix')
  await dialog.locator('#frequency, [name="frequency"]').selectOption('monthly')
  await dialog.getByLabel(/Next due/i).fill(NETFLIX_DUE)
  await dialog.getByRole('button', { name: /Save|Create/i }).click()
  await expect(page.getByTestId('recurring-row').filter({ hasText: 'Netflix' })).toBeVisible()
})

// ── Row display ────────────────────────────────────────────────────────

test('recurring row shows the frequency and next-due date', async () => {
  const row = page.getByTestId('recurring-row').filter({ hasText: 'Netflix' })
  await expect(row.getByText(/Monthly/i)).toBeVisible()
  await expect(row.getByText(nextLabelFor(NETFLIX_DUE))).toBeVisible()
})

test('recurring row shows the amount', async () => {
  const row = page.getByTestId('recurring-row').filter({ hasText: 'Netflix' })
  await expect(row.getByText(/55/)).toBeVisible()
})

// ── Create weekly rule ─────────────────────────────────────────────────

test('save a weekly recurring expense (Coffee Weekly, MYR 20)', async () => {
  await page.getByRole('button', { name: /Add recurring|New Rule/i }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/Amount/i).fill('20')
  await dialog.locator('#account, [name="account"]').selectOption('Recurring Bank')
  await dialog.getByLabel(/Merchant/i).fill('Coffee Weekly')
  await dialog.locator('#frequency, [name="frequency"]').selectOption('weekly')
  await dialog.getByLabel(/Next due/i).fill(COFFEE_DUE)
  await dialog.getByRole('button', { name: /Save|Create/i }).click()
  await expect(page.getByTestId('recurring-row').filter({ hasText: 'Coffee Weekly' })).toBeVisible()
})

test('weekly rule row shows "Weekly" frequency', async () => {
  const row = page.getByTestId('recurring-row').filter({ hasText: 'Coffee Weekly' })
  // Scoped to the cadence cell's class, not a bare text search — the row's
  // closed "⋯" menu also contains "Weekly" (inside "Edit Coffee Weekly" etc.,
  // still in the DOM though hidden via CSS), which a plain getByText('Weekly')
  // strict-mode-matches too.
  await expect(row.locator('.tmeta').filter({ hasText: 'Weekly' })).toBeVisible()
})

// ── Sub-line & category chip at rest (Phase 5c B10, revised FEAT-068) ───
// The row no longer shows a standalone "Expense" badge (FEAT-068 dropped it);
// the sub-line now reads "{account} · {category|Uncategorised}".

test('rule row sub-line shows the account and "Uncategorised" before a category is set', async () => {
  const row = page.getByTestId('recurring-row').filter({ hasText: 'Netflix' })
  await expect(row.getByText('Recurring Bank · Uncategorised')).toBeVisible()
})

test('rule row sub-line shows its category once one is set', async () => {
  const row = page.getByTestId('recurring-row').filter({ hasText: 'Netflix' })
  await openRowMenu(row, 'Netflix')
  await page.getByRole('menuitem', { name: 'Edit Netflix' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('#category').selectOption({ label: 'Entertainment' })
  await dialog.getByRole('button', { name: /Save|Update/i }).click()
  await expect(row.getByText('Recurring Bank · Entertainment')).toBeVisible()
})

// ── Edit rule ──────────────────────────────────────────────────────────

test('"Edit {merchant}" menu item pre-fills the form with existing values', async () => {
  const row = page.getByTestId('recurring-row').filter({ hasText: 'Netflix' })
  await openRowMenu(row, 'Netflix')
  await page.getByRole('menuitem', { name: 'Edit Netflix' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel(/Amount/i)).toHaveValue('55')
})

test('updating amount and saving reflects the new value', async () => {
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/Amount/i).fill('60')
  await dialog.getByRole('button', { name: /Save|Update/i }).click()
  const row = page.getByTestId('recurring-row').filter({ hasText: 'Netflix' })
  await expect(row.getByText(/60/)).toBeVisible()
})

// ── Delete rule ────────────────────────────────────────────────────────

test('"Delete {merchant}" menu item, with confirmation, removes the recurring rule', async () => {
  const row = page.getByTestId('recurring-row').filter({ hasText: 'Coffee Weekly' })
  await openRowMenu(row, 'Coffee Weekly')
  await page.getByRole('menuitem', { name: 'Delete Coffee Weekly' }).click()
  await page.getByRole('button', { name: /Confirm|Yes/i }).click()
  await expect(page.getByTestId('recurring-row').filter({ hasText: 'Coffee Weekly' })).not.toBeVisible()
})

test('Netflix rule is still present after deleting Coffee Weekly', async () => {
  await expect(page.getByTestId('recurring-row').filter({ hasText: 'Netflix' })).toBeVisible()
})
