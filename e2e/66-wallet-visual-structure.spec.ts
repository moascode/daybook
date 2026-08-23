/**
 * R3 PR-1 — structural-seam checks for the wallet restyle
 * (docs/v2/.flow/r3-pr1-wallet-transactions-accounts/flow-plan.md, step 9 /
 * criterion 29 / docs/v2/foundation/04-e2e-and-migration.md §3).
 *
 * This spec asserts only that the new CSS class hooks exist on the right
 * elements — never copy text or computed money values. Those are already
 * covered by 02-wallet-accounts, 03-wallet-transactions, 10-wallet-net-worth,
 * 23-wallet-navigation, 37-wallet-filter-bar and 44-filter-chips; duplicating
 * them here would just be a second, weaker copy of the same assertions.
 */

import { test, expect } from '@playwright/test'
import { newAppPage, accountCardFor, transactionRowFor, fillAccountForm, fillTransactionForm, businessToday } from './helpers'

test.describe('wallet visual structure (R3 PR-1)', () => {
  test('transaction-row carries the .trow class', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Structure Bank', type: 'bank' })
    await expect(accountCardFor(page, 'Structure Bank')).toBeVisible()

    await page.goto('/wallet')
    await page.getByRole('button', { name: 'Add Transaction' }).click()
    await fillTransactionForm(page, {
      type: 'Expense',
      date: businessToday(),
      amount: '42.00',
      account: 'Structure Bank',
      merchant: 'Structure Coffee',
    })

    const row = transactionRowFor(page, 'Structure Coffee')
    await expect(row).toBeVisible()
    await expect(row).toHaveClass(/\btrow\b/)
  })

  test('day-header carries .tgroup-head and its day-net pill carries .tg-total, with .pos on a positive day', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Structure Income Bank', type: 'bank' })
    await expect(accountCardFor(page, 'Structure Income Bank')).toBeVisible()

    await page.goto('/wallet')
    await page.getByRole('button', { name: 'Add Transaction' }).click()
    // A single income transaction guarantees a strictly positive day net —
    // the negative case is symmetric (same pill, `pos` class simply absent)
    // and isn't re-tested here to keep this a structural, not a behavioural, spec.
    await fillTransactionForm(page, {
      type: 'Income',
      date: businessToday(),
      amount: '100.00',
      account: 'Structure Income Bank',
      merchant: 'Structure Payday',
    })

    const dayHeader = page.locator('[data-testid="day-header"]:visible')
    await expect(dayHeader).toHaveClass(/\btgroup-head\b/)

    const pill = dayHeader.getByTestId('day-header-net')
    await expect(pill).toHaveClass(/\btg-total\b/)
    await expect(pill).toHaveClass(/\bpos\b/)
  })

  test('the three summary tiles carry .stat-card', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Structure Stat Bank', type: 'bank' })
    await expect(accountCardFor(page, 'Structure Stat Bank')).toBeVisible()

    await page.goto('/wallet')
    // Summary row only renders once there's an account to work with — it's
    // there as soon as the page has loaded them.
    const statCards = page.locator('.stat-card:visible')
    await expect(statCards).toHaveCount(3)
  })

  test('import-csv-btn is visible on /wallet and navigates to /wallet/import', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')

    const importBtn = page.getByTestId('import-csv-btn')
    await expect(importBtn).toBeVisible()
    await importBtn.click()
    await expect(page).toHaveURL(/\/wallet\/import$/)
  })

  test('account-card carries the .acct class', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Structure Acct Card', type: 'cash' })

    const card = accountCardFor(page, 'Structure Acct Card')
    await expect(card).toBeVisible()
    await expect(card).toHaveClass(/\bacct\b/)
  })
})
