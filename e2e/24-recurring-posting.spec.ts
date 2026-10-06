/**
 * Phase B — recurring rules now actually post transactions.
 *
 * Before this, a recurring rule was inert: it never created a transaction and
 * its due date never moved. These tests prove the two new behaviours:
 *   1. "Post now" posts one transaction immediately and advances the schedule.
 *   2. The process pass catches up every occurrence that is due on/before today.
 * Plus the form now captures Type and Category (previously missing).
 *
 * FEAT-068 moved "Post now" behind the row's "⋯" menu (`RecurringRowMenu`)
 * and dropped the "Next" column's year ("d MMM" only — see RecurringTable.tsx
 * `nextLabel`), so this file no longer asserts a four-digit year. Due dates
 * are relative (`businessDatePlus`), not hardcoded calendar dates — the old
 * literals ('2026-01-01' etc.) were already sliding into "more than a year
 * ago" territory, which `farPastDueError` rejects outright (CLAUDE.md §3
 * "never hardcode a future date" — the past-dated version of the same trap).
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { format, parseISO } from 'date-fns'
import { newAppPage, fillAccountForm, transactionRowFor, ensureFiltersOpen, businessDatePlus } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

/** Mirrors RecurringTable.tsx's `nextLabel` for a date that is neither today nor tomorrow. */
function nextLabelFor(dateISO: string): string {
  return format(parseISO(dateISO), 'd MMM')
}

/** Mirrors worker/routes/wallet.ts's `advanceDate` for a monthly rule (B-10 end-of-month anchoring). */
function advanceMonthly(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  let ny = y
  let nm = m + 1
  if (nm > 12) { nm = 1; ny += 1 }
  const lastDayThis = new Date(y, m, 0).getDate()
  const lastDayNext = new Date(ny, nm, 0).getDate()
  const nd = d >= lastDayThis ? lastDayNext : Math.min(d, lastDayNext)
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Recurring Bank', type: 'bank' })
})

test.afterAll(async () => {
  await page.context().close()
})

async function openForm() {
  await page.goto('/wallet/recurring')
  await page.getByRole('button', { name: /Add recurring|New Rule/i }).click()
  return page.getByRole('dialog')
}

async function postNowFor(merchant: string) {
  const row = page.getByTestId('recurring-row').filter({ hasText: merchant })
  await row.getByRole('button', { name: `More actions for ${merchant}` }).click()
  await page.getByRole('menuitem', { name: 'Post now' }).click()
}

test('recurring form now captures Type and Category', async () => {
  const dialog = await openForm()
  await expect(dialog.getByLabel(/^Type$/i)).toBeVisible()
  await expect(dialog.getByLabel(/^Category$/i)).toBeVisible()
  await dialog.getByRole('button', { name: /Cancel/i }).click()
})

test('"Post now" on a not-yet-due rule posts a transaction but does NOT advance the schedule', async () => {
  const notDueDate = businessDatePlus(60)
  const dialog = await openForm()
  await dialog.getByLabel(/^Type$/i).selectOption('expense')
  await dialog.getByLabel(/Amount/i).fill('30')
  await dialog.locator('#account').selectOption('Recurring Bank')
  await dialog.getByLabel(/Merchant/i).fill('Spotify')
  await dialog.locator('#frequency').selectOption('monthly')
  await dialog.getByLabel(/Next due/i).fill(notDueDate)
  await dialog.getByRole('button', { name: /Create/i }).click()

  const row = page.getByTestId('recurring-row').filter({ hasText: 'Spotify' })
  await expect(row).toBeVisible()
  await expect(row.getByText(nextLabelFor(notDueDate))).toBeVisible()

  // Posting early must not consume the upcoming scheduled occurrence: the
  // schedule stays put, but a transaction is created today.
  await postNowFor('Spotify')
  await expect(row.getByText(nextLabelFor(notDueDate))).toBeVisible()

  await page.goto('/wallet')
  await expect(transactionRowFor(page, 'Spotify')).toBeVisible()
})

test('"Post now" on a due rule advances the schedule one period', async () => {
  const dueDate = businessDatePlus(-10)
  const dialog = await openForm()
  await dialog.getByLabel(/Amount/i).fill('12')
  await dialog.locator('#account').selectOption('Recurring Bank')
  await dialog.getByLabel(/Merchant/i).fill('DueBill')
  await dialog.locator('#frequency').selectOption('monthly')
  // Already due (in the past), so posting advances one month.
  await dialog.getByLabel(/Next due/i).fill(dueDate)
  await dialog.getByRole('button', { name: /Create/i }).click()

  const row = page.getByTestId('recurring-row').filter({ hasText: 'DueBill' })
  await expect(row.getByText(nextLabelFor(dueDate))).toBeVisible()
  await postNowFor('DueBill')
  await expect(row.getByText(nextLabelFor(advanceMonthly(dueDate)))).toBeVisible()
})

test('processing catches up every occurrence due on/before today', async () => {
  const dialog = await openForm()
  await dialog.getByLabel(/Amount/i).fill('99')
  await dialog.locator('#account').selectOption('Recurring Bank')
  await dialog.getByLabel(/Merchant/i).fill('OldBill')
  await dialog.locator('#frequency').selectOption('monthly')
  // Well in the past so several occurrences are overdue, but under the
  // 1-year `farPastDueError` ceiling.
  await dialog.getByLabel(/Next due/i).fill(businessDatePlus(-200))
  await dialog.getByRole('button', { name: /Create/i }).click()
  await expect(page.getByTestId('recurring-row').filter({ hasText: 'OldBill' })).toBeVisible()

  // Run the same catch-up pass the app fires on boot.
  const res = await page.request.post(
    '/api/recurring-transactions/process',
  )
  expect(res.ok()).toBeTruthy()
  const body = await res.json()
  expect(body.posted).toBeGreaterThan(0)

  // The back-dated occurrences now exist as real transactions.
  await page.goto('/wallet')
  await ensureFiltersOpen(page)
  await page.getByTestId('filter-clear-dates').click()
  await expect(transactionRowFor(page, 'OldBill').first()).toBeVisible()
})

test('boot processing posts due rules and surfaces a toast', async () => {
  const dialog = await openForm()
  await dialog.getByLabel(/Amount/i).fill('7')
  await dialog.locator('#account').selectOption('Recurring Bank')
  await dialog.getByLabel(/Merchant/i).fill('BootBill')
  await dialog.locator('#frequency').selectOption('monthly')
  await dialog.getByLabel(/Next due/i).fill(businessDatePlus(-5))
  await dialog.getByRole('button', { name: /Create/i }).click()
  await expect(page.getByTestId('recurring-row').filter({ hasText: 'BootBill' })).toBeVisible()

  // Reload → App fires the catch-up pass on boot, which posts the due rule and
  // tells the user (rather than silently changing balances).
  await page.reload()
  await expect(page.getByText(/Posted \d+ due recurring transaction/i)).toBeVisible({
    timeout: 12_000,
  })
})

test('the API rejects a transfer-type or invalid-frequency recurring rule', async () => {
  const accounts = await (
    await page.request.get('/api/accounts')
  ).json()
  const accountId = accounts[0].id

  const transferRule = await page.request.post(
    '/api/recurring-transactions',
    { data: { accountId, amount: 10, merchant: 'Bad', type: 'transfer', frequency: 'monthly', nextDueDate: businessDatePlus(60) } },
  )
  expect(transferRule.status()).toBe(400)

  const badFreq = await page.request.post(
    '/api/recurring-transactions',
    { data: { accountId, amount: 10, merchant: 'Bad', type: 'expense', frequency: 'yearly', nextDueDate: businessDatePlus(60) } },
  )
  expect(badFreq.status()).toBe(400)
})
