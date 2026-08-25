/**
 * Wallet — Merchant canonicalisation admin tool end-to-end tests.
 * Covers: preview of merchants a cleanup pass would rewrite, applying the
 * bulk update behind a confirm dialog, and that the change lands on the
 * actual transaction while leaving its description untouched.
 *
 * `CanonicalizeMerchantsPage` (src/modules/wallet/CanonicalizeMerchantsPage.tsx)
 * is a one-time admin tool with no nav link anywhere in the app — it is only
 * reachable by navigating directly to /wallet/canonicalize-merchants — and it
 * only renders a preview table when there is actually messy data to clean up
 * (`totalAffected > 0`), so this spec creates that messy data itself rather
 * than relying on a fixture.
 *
 * The raw merchant string below is chosen to exercise `canonicalizeMerchantForDisplay()`
 * (worker/lib/merchant.ts) predictably: the `POS DEBIT ` prefix is stripped
 * by RAIL_PREFIX, the string is then split on the `*` separator, and the
 * head "GRABFOOD" passes the trimTails() usability check unchanged — so the
 * canonical form is deterministically "Grabfood" (title-cased for display), not a guess.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, accountCardFor, transactionRowFor, fillAccountForm, navTo } from './helpers'

test.describe.configure({ mode: 'serial' })

const MESSY_MERCHANT = 'POS DEBIT GRABFOOD*MY KUALA LUMPUR'
const CANONICAL_MERCHANT = 'Grabfood'
const RAW_DESCRIPTION = 'POS DEBIT GRABFOOD*MY KUALA LUMPUR REF 029384'

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Merchant Test Bank', type: 'bank' })
  await expect(accountCardFor(page, 'Merchant Test Bank')).toBeVisible()
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Setup: a transaction with a messy bank-narrative merchant name ────────

test('create a transaction with a messy merchant name', async () => {
  await navTo(page, 'transactions')
  await expect(page).toHaveURL(/\/wallet$/)

  await page.getByRole('button', { name: 'Add Transaction' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  // Wait for the account list to load before filling — see fillTransactionForm's
  // comment in helpers.ts for why this matters.
  const accountSelect = dialog.locator('#account')
  await expect
    .poll(async () => accountSelect.locator('option[value]:not([value=""])').count(), {
      timeout: 15_000,
      message: 'transaction form never loaded an account to select',
    })
    .toBeGreaterThan(0)

  await dialog.getByLabel('Amount').fill('18.50')
  await dialog.getByLabel('Merchant').fill(MESSY_MERCHANT)
  await dialog.getByLabel('Description').fill(RAW_DESCRIPTION)
  await dialog.getByRole('button', { name: /Add Transaction/ }).click()
  await expect(dialog).toBeHidden()
})

test('the messy merchant name is visible in the transaction list', async () => {
  await expect(transactionRowFor(page, MESSY_MERCHANT)).toBeVisible()
})

// ── Preview: navigate directly to the canonicalize-merchants admin page ───

test('navigating directly to /wallet/canonicalize-merchants loads a preview table', async () => {
  await page.goto('/wallet/canonicalize-merchants')
  await expect(page.getByRole('heading', { name: 'Clean up merchant names' })).toBeVisible()
  await expect(page.getByTestId('canonicalize-merchants-table')).toBeVisible()
})

test('the preview table shows the messy merchant and its canonical form', async () => {
  const row = page.getByTestId('canonicalize-merchant-row').filter({ hasText: MESSY_MERCHANT })
  await expect(row).toBeVisible()
  await expect(row.getByText(CANONICAL_MERCHANT, { exact: true })).toBeVisible()
})

// ── Apply ───────────────────────────────────────────────────────────────

test('Apply button is visible and enabled', async () => {
  const applyButton = page.getByRole('button', { name: 'Apply' })
  await expect(applyButton).toBeVisible()
  await expect(applyButton).toBeEnabled()
})

test('clicking Apply shows a modal, then canonicalizes and shows a success summary', async () => {
  await page.getByRole('button', { name: 'Apply' }).click()

  // Wait for the ConfirmDeleteModal to appear
  const modal = page.getByRole('dialog')
  await expect(modal).toBeVisible()
  await expect(modal.getByRole('heading', { name: 'Canonicalize merchant names' })).toBeVisible()

  // Click the Canonicalize button in the modal
  await modal.getByRole('button', { name: 'Canonicalize' }).click()

  // Verify the success page is shown
  await expect(page.getByRole('heading', { name: 'Merchant cleanup complete' })).toBeVisible()
  // Match in main only — the same text also appears in the toast (data-testid="toast").
  await expect(page.locator('main').getByText(/Updated 1 transaction/)).toBeVisible()
})

// ── Verify the update landed on the real transaction ───────────────────────

test('returning to wallet shows the canonical merchant on the transaction', async () => {
  await page.getByRole('button', { name: 'Return to wallet' }).click()
  await expect(page).toHaveURL(/\/wallet$/)

  const row = transactionRowFor(page, CANONICAL_MERCHANT)
  await expect(row).toBeVisible()
  // The merchant LABEL itself was overwritten to the canonical form, not appended
  // to — exact-match the primary merchant span so a leftover raw string in the
  // description underneath (verified separately below) can't make this pass.
  await expect(row.getByText(CANONICAL_MERCHANT, { exact: true })).toBeVisible()
})

test('the description still holds the raw narrative text', async () => {
  // canonicalize only rewrites the `merchant` column (worker/routes/wallet.ts
  // POST /merchants/canonicalize) — the description is untouched.
  await expect(transactionRowFor(page, CANONICAL_MERCHANT).getByText(RAW_DESCRIPTION)).toBeVisible()
})

// ── Edge cases (isolated contexts so they don't disturb the serial flow) ──

test('clean merchants are not flagged as needing cleanup', async ({ browser }) => {
  // A transaction with an already-clean merchant name (title-case, no card/ref
  // numbers) should not appear in the canonicalize list, confirming the tool
  // doesn't try to "fix" what is already clean.
  const isoPage = await newAppPage(browser, '/wallet/accounts')
  await isoPage.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(isoPage, { name: 'Clean Merchant Test', type: 'bank' })
  await expect(accountCardFor(isoPage, 'Clean Merchant Test')).toBeVisible()

  await navTo(isoPage, 'transactions')
  await isoPage.getByRole('button', { name: 'Add Transaction' }).click()
  const dialog = isoPage.getByRole('dialog')
  const accountSelect = dialog.locator('#account')
  await expect
    .poll(async () => accountSelect.locator('option[value]:not([value=""])').count(), { timeout: 15_000 })
    .toBeGreaterThan(0)
  // Add a clean merchant (title-case, no card numbers, no reference codes)
  const cleanMerchant = 'Netflix'
  await dialog.getByLabel('Amount').fill('14.99')
  await dialog.getByLabel('Merchant').fill(cleanMerchant)
  await dialog.getByRole('button', { name: /Add Transaction/ }).click()
  await expect(dialog).toBeHidden()

  // Navigate to canonicalize-merchants page
  await isoPage.goto('/wallet/canonicalize-merchants')
  // The preview should be empty — no merchants to clean
  await expect(isoPage.getByText('No merchants to clean up.')).toBeVisible()
  await isoPage.context().close()
})

test('Cancel leaves the merchant name unchanged', async ({ browser }) => {
  const isoPage = await newAppPage(browser, '/wallet/accounts')
  await isoPage.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(isoPage, { name: 'Cancel Test Bank', type: 'bank' })
  await expect(accountCardFor(isoPage, 'Cancel Test Bank')).toBeVisible()

  await navTo(isoPage, 'transactions')
  await isoPage.getByRole('button', { name: 'Add Transaction' }).click()
  const dialog = isoPage.getByRole('dialog')
  const accountSelect = dialog.locator('#account')
  await expect
    .poll(async () => accountSelect.locator('option[value]:not([value=""])').count(), { timeout: 15_000 })
    .toBeGreaterThan(0)
  await dialog.getByLabel('Amount').fill('9.90')
  await dialog.getByLabel('Merchant').fill(MESSY_MERCHANT)
  await dialog.getByRole('button', { name: /Add Transaction/ }).click()
  await expect(dialog).toBeHidden()

  await isoPage.goto('/wallet/canonicalize-merchants')
  await expect(isoPage.getByTestId('canonicalize-merchants-table')).toBeVisible()
  await isoPage.getByRole('button', { name: 'Cancel' }).click()
  await expect(isoPage).toHaveURL(/\/wallet$/)

  await expect(transactionRowFor(isoPage, MESSY_MERCHANT)).toBeVisible()
  await isoPage.context().close()
})

test('the page shows an empty state when there is no messy merchant data', async ({ browser }) => {
  // Fresh user with no accounts or transactions at all — totalAffected stays 0.
  const emptyPage = await newAppPage(browser, '/wallet/canonicalize-merchants')
  await expect(emptyPage.getByText('No merchants to clean up.')).toBeVisible()
  await expect(emptyPage.getByRole('button', { name: 'Return to wallet' })).toBeVisible()
  await emptyPage.context().close()
})

// docs/v1/flow-plan.md step 9: /merchants/canonicalize reuses the same
// resolve ladder as CSV import — a merchant the regex step alone leaves
// unchanged (no card mask, no rail prefix, no separator to strip) can still
// surface as a cleanup candidate via AI, with the preview naming the source.
test('a merchant unchanged by regex alone resolves via AI, and the preview shows its source', async ({
  browser,
}) => {
  const isoPage = await newAppPage(browser, '/wallet/accounts')
  await isoPage.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(isoPage, { name: 'AI Cleanup Bank', type: 'bank' })
  await expect(accountCardFor(isoPage, 'AI Cleanup Bank')).toBeVisible()

  const rawMerchant = 'IBG FROM DODO KOREA SDN BHD REF 883921'
  // canonicalizeMerchantForDisplay() strips the IBG rail prefix, the ref
  // number, and "SDN BHD" but has no rule for a leading "FROM" or a trailing
  // "REF" left after those strips — a genuine regex miss, distinct from the
  // raw string, so the ladder's history stage (which would otherwise
  // self-match a guess identical to the raw merchant) cannot short-circuit it.
  const regexGuess = 'From Dodo Korea Sdn Bhd Ref'
  const aiName = 'Dodo Korea Restaurant'

  await isoPage.request.put('/api/settings/anthropic_api_key', { data: { value: 'sk-ant-test-dummy' } })
  await isoPage.request.post('/api/test/mock-ai-response', {
    data: { text: JSON.stringify({ resolutions: [{ guess: regexGuess, name: aiName }] }), feature: 'merchants' },
  })

  await navTo(isoPage, 'transactions')
  await isoPage.getByRole('button', { name: 'Add Transaction' }).click()
  const dialog = isoPage.getByRole('dialog')
  const accountSelect = dialog.locator('#account')
  await expect
    .poll(async () => accountSelect.locator('option[value]:not([value=""])').count(), { timeout: 15_000 })
    .toBeGreaterThan(0)
  await dialog.getByLabel('Amount').fill('7.20')
  await dialog.getByLabel('Merchant').fill(rawMerchant)
  await dialog.getByRole('button', { name: /Add Transaction/ }).click()
  await expect(dialog).toBeHidden()

  await isoPage.goto('/wallet/canonicalize-merchants')
  await expect(isoPage.getByTestId('canonicalize-merchants-table')).toBeVisible()

  const row = isoPage.getByTestId('canonicalize-merchant-row').filter({ hasText: rawMerchant })
  await expect(row).toBeVisible()
  await expect(row).toContainText(aiName)
  await expect(row.getByTestId('canonicalize-merchant-source')).toHaveText('AI-suggested')

  await isoPage.context().close()
})
