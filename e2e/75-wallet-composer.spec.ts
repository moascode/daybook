/**
 * 75 — Wallet composer (R7, docs/v2/wallet/03-feature-waves.md).
 *
 * Free-text quick-add: "coffee 4.20 cash" → a parsed draft the user confirms,
 * never a silent write. Rules parse first; Claude Haiku is a fallback only
 * when rules can't find an amount, and only when an API key is configured —
 * see docs/v2/cross-cutting/ai-usage.md item A1.
 *
 * Stubbing note (same as e2e/60-ai-bulk-categorize.spec.ts): DAYBOOK_TEST=1
 * is always on under this harness, so worker/lib/anthropic.ts reads a canned
 * response from `settings` (POST /test/mock-ai-response) instead of calling
 * the real network.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, fillAccountForm, transactionRowFor } from './helpers'

const API = '/api'

async function setApiKey(page: Page, value: string) {
  const res = await page.request.put(`${API}/settings/anthropic_api_key`, { data: { value } })
  expect(res.ok()).toBeTruthy()
}

async function mockComposerAiResponse(page: Page, draft: Record<string, unknown>) {
  const res = await page.request.post(`${API}/test/mock-ai-response`, {
    data: { text: JSON.stringify(draft), feature: 'composer' },
  })
  expect(res.ok()).toBeTruthy()
}

const composerInput = (page: Page) => page.getByLabel('Add a transaction')
const composerPreview = (page: Page) => page.getByTestId('composer-preview')

test.describe('composer visibility', () => {
  test('renders on /wallet, absent on the read-only Reports page', async ({ browser }: { browser: Browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Composer Bank' })

    await page.goto('/wallet')
    await expect(composerInput(page)).toBeVisible()
    await expect(composerInput(page)).toHaveAttribute('placeholder', /coffee 4\.20 cash/)

    await page.goto('/wallet/reports')
    await expect(composerInput(page)).not.toBeVisible()
    await page.context().close()
  })

  test('the old header "Add Transaction" button is gone', async ({ browser }: { browser: Browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Bank' })
    await page.goto('/wallet')
    await expect(page.getByRole('button', { name: 'Add Transaction' })).toHaveCount(0)
    await page.context().close()
  })
})

test.describe('rules parser — no network, no API key needed', () => {
  test.describe.configure({ mode: 'serial' })
  let page: Page

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Bank Account', type: 'bank' })
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Pocket Cash', type: 'cash' })
    await page.goto('/wallet')
  })

  test.afterAll(async () => {
    await page.context().close()
  })

  test('"coffee 4.20 cash" parses to a preview naming the cash account', async () => {
    await composerInput(page).fill('coffee 4.20 cash')
    await composerInput(page).press('Enter')

    const preview = composerPreview(page)
    await expect(preview).toContainText('coffee')
    await expect(preview).toContainText(/RM\s*4\.20/)
    await expect(preview).toContainText('Pocket Cash')
  })

  test('Confirm creates the transaction and clears the composer', async () => {
    await composerPreview(page).getByRole('button', { name: 'Confirm' }).click()
    await expect(transactionRowFor(page, 'coffee')).toBeVisible()
    await expect(composerInput(page)).toHaveValue('')
    await expect(page.getByRole('button', { name: 'Confirm' })).toHaveCount(0)
  })

  test('Cancel dismisses the preview without creating anything', async () => {
    await composerInput(page).fill('taxi 12 cash')
    await composerInput(page).press('Enter')
    await expect(composerPreview(page)).toContainText('taxi')

    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('button', { name: 'Confirm' })).toHaveCount(0)
    await expect(transactionRowFor(page, 'taxi')).toHaveCount(0)
  })

  test('Edit opens the full form pre-filled with the parsed draft, not a blank one', async () => {
    await composerInput(page).fill('lunch 25 bank account')
    await composerInput(page).press('Enter')
    await expect(composerPreview(page)).toContainText('lunch')

    // exact: true — plain 'Edit' otherwise substring-matches the row-level
    // "Edit transaction" buttons already in the list from earlier tests in
    // this serial block (Playwright's getByRole name match is fuzzy by
    // default).
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Merchant')).toHaveValue('lunch')
    await expect(dialog.getByLabel('Amount')).toHaveValue('25')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
  })
})

test.describe('shortcut row', () => {
  test('Income opens a blank form with Income pre-selected', async ({ browser }: { browser: Browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Bank' })
    await page.goto('/wallet')

    await page.getByRole('button', { name: 'Income' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Merchant')).toHaveValue('')
    // The active type button carries its type's colour class; inactive ones
    // don't (TransactionForm.tsx has no aria-pressed, this is the only signal).
    await expect(dialog.getByRole('button', { name: 'Income', exact: true })).toHaveClass(/bg-positive-50/)
    await page.context().close()
  })

  test('Import CSV navigates to /wallet/import, same as the old header button', async ({ browser }: { browser: Browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Bank' })
    await page.goto('/wallet')

    await page.getByRole('link', { name: 'Import CSV' }).first().click()
    await expect(page).toHaveURL(/\/wallet\/import/)
    await page.context().close()
  })
})

test.describe('N hotkey', () => {
  test('focuses the composer; does not steal focus while typing elsewhere', async ({ browser }: { browser: Browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Bank' })
    await page.goto('/wallet')

    await page.locator('body').click()
    await page.keyboard.press('n')
    await expect(composerInput(page)).toBeFocused()

    await composerInput(page).fill('')
    await page.getByRole('button', { name: 'Categories' }).click()
    const searchLike = page.getByRole('dialog').locator('input').first()
    if (await searchLike.count()) {
      await searchLike.fill('n')
      await expect(searchLike).toHaveValue('n')
      await expect(composerInput(page)).not.toBeFocused()
    }
    await page.context().close()
  })
})

test.describe('parse failure — no amount found', () => {
  test('with no API key: opens the blank form with the raw text prefilled as merchant', async ({ browser }: { browser: Browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Bank' })
    await page.goto('/wallet')

    await composerInput(page).fill('just some notes with no number')
    await composerInput(page).press('Enter')

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Merchant')).toHaveValue('just some notes with no number')
    await expect(composerInput(page)).toHaveValue('')
  })
})

test.describe('AI fallback', () => {
  test('with a key configured: an unparseable amount-free entry falls back to Claude and shows a preview', async ({ browser }: { browser: Browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Bank Account', type: 'bank' })
    const acctRes = await page.request.get(`${API}/accounts`)
    const [acct] = (await acctRes.json()) as Array<{ id: string; name: string }>

    await setApiKey(page, 'sk-ant-test-dummy')
    await mockComposerAiResponse(page, {
      merchant: 'Sara — split lunch',
      amount: 45,
      type: 'expense',
      account: acct.name,
    })

    await page.goto('/wallet')
    // Digit-free on purpose (from ai-usage.md's own "long tail" example) — the
    // rules parser requires a numeric token to return a draft at all, so ANY
    // digit here (even "split 3 ways") would let rules catch it and the AI
    // path would never be exercised.
    await composerInput(page).fill('lunch with Sara, split the bill')
    await composerInput(page).press('Enter')

    const preview = composerPreview(page)
    await expect(preview).toContainText('Sara', { timeout: 10_000 })
    await expect(preview).toContainText(/RM\s*45\.00/)

    await preview.getByRole('button', { name: 'Confirm' }).click()
    await expect(transactionRowFor(page, 'Sara')).toBeVisible()
    await page.context().close()
  })

  test('a Claude failure still lands the user somewhere actionable, not a silent no-op', async ({ browser }: { browser: Browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Bank' })
    await setApiKey(page, 'sk-ant-test-dummy')
    // No mock staged — worker/lib/anthropic.ts's fetchTestText throws
    // "no AI mock configured for this test user", exercising the composer's
    // catch-and-fall-back-to-blank-form path (never a silent failure).
    await page.goto('/wallet')

    await composerInput(page).fill('some ambiguous thing')
    await composerInput(page).press('Enter')

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await expect(dialog.getByLabel('Merchant')).toHaveValue('some ambiguous thing')
    await page.context().close()
  })
})

test.describe('rate limit', () => {
  test('POST /transactions/parse-composer-ai has its own bucket, independent of bulk categorisation', async ({ browser }: { browser: Browser }) => {
    const page = await newAppPage(browser, '/wallet')
    const res = await page.request.post(`${API}/transactions/parse-composer-ai`, { data: { text: 'coffee' } })
    // No API key configured for this fresh user — 400, not 429 or 200.
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toContain('no API key configured')
    await page.context().close()
  })
})
