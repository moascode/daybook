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
import type { Browser } from '@playwright/test'
import {
  newAppPage,
  accountCardFor,
  transactionRowFor,
  fillAccountForm,
  fillTransactionForm,
  businessToday,
  signUpOnPage,
  waitForApp,
  openBlankTransactionForm,
} from './helpers'

const MOBILE_VIEWPORT = { width: 390, height: 844 }

test.describe('wallet visual structure (R3 PR-1)', () => {
  test('transaction-row carries the .trow class', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Structure Bank', type: 'bank' })
    await expect(accountCardFor(page, 'Structure Bank')).toBeVisible()

    await page.goto('/wallet')
    await openBlankTransactionForm(page)
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
    await openBlankTransactionForm(page)
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

  // ── Mobile (390 px) regression coverage ──────────────────────────────
  // Every case below reproduces a bug the R3 restyle actually shipped and
  // caught on review, not a hypothetical. None of the specs the plan cited
  // as "mobile coverage" (21-mobile-responsive) exercise a row/stat-card/
  // account-card with real seeded data at 390 px — they either check bare
  // scrollWidth on an empty page or sign up a fresh accountless user, so
  // none of these three would have failed without a purpose-built test.

  test('at 390px, a transaction row\'s actions are neither visible nor hittable', async ({ browser }: { browser: Browser }) => {
    // Regression for: .trow-actions kept its Tailwind `flex` class, which
    // (same specificity, later in Tailwind's utilities layer) always beat
    // data.css's `@media (max-width:680px) { .trow-actions { display:none } }`
    // — every row was ~115px tall with an invisible (opacity:0) but fully
    // hittable Delete button sitting in the dead space below the visible
    // content, deleting the transaction on any blind tap there.
    const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT })
    const page = await ctx.newPage()
    await signUpOnPage(page)
    await page.request.post('/api/accounts', { data: { name: 'Mobile Row Bank', type: 'cash', openingBalance: 100 } })
    await page.request.post('/api/transactions', {
      data: { accountId: (await (await page.request.get('/api/accounts')).json())[0].id, date: businessToday(), merchant: 'Mobile Coffee', amount: 5, type: 'expense' },
    })
    await page.goto('/wallet')
    await waitForApp(page)

    const row = transactionRowFor(page, 'Mobile Coffee')
    await expect(row).toBeVisible()
    await expect(row.locator('.trow-actions')).toBeHidden()

    // The row itself must stay compact — no implicit second grid row from
    // an action group the layout thinks is still flex-laid-out at full size.
    const rowBox = await row.boundingBox()
    expect(rowBox?.height).toBeLessThan(90)
    await ctx.close()
  })

  test('at 390px, the summary stat values render on one line without overflowing their card', async ({ browser }: { browser: Browser }) => {
    // Regression for: .g3 goes 2-column at 860px, leaving ~130px per card at
    // 390px — too narrow for a --t-xl "RM 5,000.00"-shaped amount, which
    // spilled past the card's right edge (and, in an earlier fix attempt,
    // wrapped mid-number instead). Fixed by g-1-on-mobile (single column).
    const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT })
    const page = await ctx.newPage()
    await signUpOnPage(page)
    const acctRes = await page.request.post('/api/accounts', { data: { name: 'Mobile Stat Bank', type: 'cash', openingBalance: 1000 } })
    const acct = (await acctRes.json()) as { id: string }
    await page.request.post('/api/transactions', { data: { accountId: acct.id, date: businessToday(), merchant: 'Salary', amount: 5000, type: 'income' } })
    await page.request.post('/api/transactions', { data: { accountId: acct.id, date: businessToday(), merchant: 'Rent', amount: 4500, type: 'expense' } })
    await page.goto('/wallet')
    await waitForApp(page)

    for (const id of ['summary-income', 'summary-expense', 'summary-net']) {
      const el = page.getByTestId(id)
      const card = page.locator('.stat-card', { has: el })
      const elBox = await el.boundingBox()
      const cardBox = await card.boundingBox()
      expect(elBox && cardBox && elBox.x + elBox.width).toBeLessThanOrEqual((cardBox?.x ?? 0) + (cardBox?.width ?? 0) + 1)
      // A single wrapped line is fine typographically; a wrap mid-number is
      // not — assert the value's own box is exactly one line tall.
      const lineHeight = await el.evaluate((e) => parseFloat(getComputedStyle(e).lineHeight))
      expect(elBox?.height).toBeLessThanOrEqual(lineHeight + 2)
    }
    await ctx.close()
  })

  test('at 390px, account-card actions (share, edit, delete) are all visible', async ({ browser }: { browser: Browser }) => {
    // Regression for: .acct-top had no flex-wrap, and the account-card root
    // keeps overflow-hidden for its coloured accent bar — so the three
    // always-visible 40px touch targets overflowed past that ancestor and
    // were invisibly clipped instead of wrapping to a second line, taking
    // edit and delete out of reach on mobile (share, being first, survived).
    const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT })
    const page = await ctx.newPage()
    await signUpOnPage(page)
    await page.goto('/wallet/accounts')
    await waitForApp(page)
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Mobile Acct Card', type: 'cash' })

    const card = accountCardFor(page, 'Mobile Acct Card')
    await expect(card).toBeVisible()
    for (const name of ['Manage sharing', 'Edit account', 'Delete account']) {
      await expect(card.getByRole('button', { name })).toBeVisible()
    }
    await ctx.close()
  })
})
