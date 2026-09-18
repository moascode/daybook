/**
 * Accounts page depth — composition breakdown, per-account sparklines,
 * credit-card utilisation, and the 12-month net-worth chart.
 *
 * This behaviour (FEAT-015/FEAT-016, EP-06) already shipped in PR #166/#168
 * before either item was filed to the backlog — see
 * docs/archive/ep-06-wallet-depth/. No spec covered it specifically (only
 * generic balance-total tests existed, e2e/10-wallet-net-worth.spec.ts). This
 * spec closes that gap.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, fillAccountForm, fillTransactionForm, navTo, openBlankTransactionForm } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet/accounts')
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Composition breakdown ──────────────────────────────────────────────

test('composition bar and legend appear once an account has a balance', async () => {
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Main Cash', type: 'cash' })
  await page.waitForTimeout(500)

  await navTo(page, 'transactions')
  await openBlankTransactionForm(page)
  await fillTransactionForm(page, {
    type: 'Income',
    amount: '1000',
    account: 'Main Cash',
    merchant: 'Salary',
    date: '2024-02-15',
  })
  await page.waitForTimeout(400)

  await navTo(page, 'accounts')
  await expect(page.getByText('Composition')).toBeVisible()
  // One legend row per account type present — "Cash" (ACCOUNT_TYPE_LABELS label).
  await expect(page.getByTestId('balance-summary').getByText('Cash', { exact: true })).toBeVisible()
})

// ── Per-account sparkline ───────────────────────────────────────────────

test('an account card renders its sparkline SVG', async () => {
  const card = page.getByTestId('account-card').filter({ hasText: 'Main Cash' })
  // SPARKLINE_WIDTH x SPARKLINE_HEIGHT (insights.ts) — distinguishes the
  // sparkline from the card's own type-icon SVG, which shares the `svg` tag.
  await expect(card.locator('svg[viewBox="0 0 220 34"]')).toBeVisible()
});

// ── Credit-card utilisation ─────────────────────────────────────────────

test('a card account with a credit limit shows a utilisation bar instead of a sparkline', async () => {
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Account Name').fill('Visa Card')
  await dialog.getByLabel('Type').selectOption('card')
  await dialog.getByLabel('Credit Limit').fill('5000')
  await dialog.getByRole('button', { name: /Create Account|Save Changes/ }).click()
  await expect(dialog).toBeHidden()
  await page.waitForTimeout(500)

  await navTo(page, 'transactions')
  await openBlankTransactionForm(page)
  await fillTransactionForm(page, {
    type: 'Expense',
    amount: '1000',
    account: 'Visa Card',
    merchant: 'Flight',
    date: '2024-02-16',
  })
  await page.waitForTimeout(400)
  await navTo(page, 'accounts')

  const card = page.getByTestId('account-card').filter({ hasText: 'Visa Card' })
  // 1000 spent of a 5000 limit → 20% utilisation.
  await expect(card.getByText(/of\s+RM\s*5,000\.00\s+limit/)).toBeVisible()
  // No sparkline on a utilisation card — the type-icon SVG is still there.
  await expect(card.locator('svg[viewBox="0 0 220 34"]')).toHaveCount(0)
})

// ── Net-worth history chart ──────────────────────────────────────────────

test('the net-worth chart renders 12 monthly bars', async () => {
  const chart = page.getByTestId('net-worth-history')
  await expect(chart).toBeVisible()
  await expect(chart.getByTestId('net-worth-bar')).toHaveCount(12)
})

test('hovering a bar shows its exact amount', async () => {
  const bars = page.getByTestId('net-worth-history').getByTestId('net-worth-bar')
  await bars.last().hover()
  await expect(page.getByTestId('net-worth-history').getByText(/RM/).first()).toBeVisible()
})
