/**
 * Merchant canonicalisation + category suggestions
 * (docs/auto-categorisation-plan.md).
 *
 * Two layers:
 *  - API-level tests hit POST /transactions/suggest-categories directly —
 *    fast and precise for the canonicaliser, the majority rule, and the
 *    builtin map's prefix lookup.
 *  - UI-level tests drive the CSV import review step, where suggestions are
 *    actually surfaced to the user.
 *
 * Each test signs up its own fresh user (per-user history must not bleed
 * between scenarios) via a bare browser context, following the pattern in
 * e2e/51-reimport-dedup.spec.ts rather than newAppPage()'s full page render —
 * the API-level tests never need the app shell to mount.
 */

import { test, expect, type Page } from '@playwright/test'
import { newAppPage } from './helpers'

const API = 'http://localhost:5173/api'

interface Suggestion {
  raw: string
  canonical: string
  categoryId: string
  categoryName: string
  categoryType: string
  matchCount: number
  totalCount: number
}

async function categoryId(page: Page, name: string): Promise<string> {
  const cats = (await (await page.request.get(`${API}/categories`)).json()) as { id: string; name: string }[]
  const cat = cats.find((c) => c.name === name)
  if (!cat) throw new Error(`category not seeded: ${name}`)
  return cat.id
}

async function mkAccount(page: Page, name: string): Promise<string> {
  const res = await page.request.post(`${API}/accounts`, {
    data: { name, type: 'bank', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
  })
  return ((await res.json()) as { id: string }).id
}

async function mkTxn(page: Page, data: Record<string, unknown>): Promise<void> {
  const res = await page.request.post(`${API}/transactions`, { data: { date: '2026-06-01', ...data } })
  expect(res.status()).toBe(201)
}

async function suggest(page: Page, merchants: string[]): Promise<Suggestion[]> {
  const res = await page.request.post(`${API}/transactions/suggest-categories`, { data: { merchants } })
  expect(res.ok()).toBeTruthy()
  return ((await res.json()) as { suggestions: Suggestion[] }).suggestions
}

// ── Stage 2 — history-derived suggestions ─────────────────────────────────

test('canonical folding: three spellings of one merchant suggest for a fourth', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.request.post(`${API}/auth/signup`, { data: { username: `e2e_fold_${Date.now()}`, password: 'test-password' } })
  const account = await mkAccount(page, 'Card')
  const foodDrink = await categoryId(page, 'Food & Drink')

  for (const merchant of [
    'MCDONALDS-PAVILION KL  MY 03/08/2026 •••• •••• •••• 3523',
    'MCDONALDS-MY TOWN00368 KUALA LUMPUR  MY 28/07/2026 •••• •••• •••• 3523',
    'MCDONALDS*SETAPAK 4471102',
  ]) {
    await mkTxn(page, { accountId: account, amount: 9.5, type: 'expense', merchant, categoryId: foodDrink })
  }

  const [hit] = await suggest(page, ['MCDONALDS/KLCC'])
  expect(hit.canonical).toBe('MCDONALDS')
  expect(hit.categoryId).toBe(foodDrink)
  expect(hit.matchCount).toBe(3)
  expect(hit.totalCount).toBe(3)

  await ctx.close()
})

// MIN_MATCHES was lowered 2 -> 1 on 2026-08-07 (worker/routes/wallet.ts): a
// single sighting now suggests, because with two users and a young history
// almost every merchant sat at exactly one and nothing was ever suggested.
// A merchant with NO history still falls through to the builtin map or
// nothing — covered by the builtin/no-suggestion tests below.
test('MIN_MATCHES: a single sighting produces a suggestion', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.request.post(`${API}/auth/signup`, { data: { username: `e2e_min_${Date.now()}`, password: 'test-password' } })
  const account = await mkAccount(page, 'Card')
  const transport = await categoryId(page, 'Transport')

  await mkTxn(page, { accountId: account, amount: 20, type: 'expense', merchant: 'SOLO MERCHANT XY', categoryId: transport })
  const [first] = await suggest(page, ['SOLO MERCHANT XY'])
  expect(first.categoryId).toBe(transport)
  expect(first.matchCount).toBe(1)

  await mkTxn(page, { accountId: account, amount: 22, type: 'expense', merchant: 'SOLO MERCHANT XY', categoryId: transport })
  const [hit] = await suggest(page, ['SOLO MERCHANT XY'])
  expect(hit.categoryId).toBe(transport)
  expect(hit.matchCount).toBe(2)

  await ctx.close()
})

test('majority rule: a genuine split withholds, a clear majority does not', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.request.post(`${API}/auth/signup`, { data: { username: `e2e_majority_${Date.now()}`, password: 'test-password' } })
  const account = await mkAccount(page, 'Card')
  const health = await categoryId(page, 'Health')
  const personalCare = await categoryId(page, 'Personal Care')

  // A 2-2 tie: neither category holds more than half the categorised history
  // for this canonical name, so no side is confidently picked.
  for (let i = 0; i < 2; i++) {
    await mkTxn(page, { accountId: account, amount: 15, type: 'expense', merchant: 'MIXED USE SHOP', categoryId: health })
    await mkTxn(page, { accountId: account, amount: 15, type: 'expense', merchant: 'MIXED USE SHOP', categoryId: personalCare })
  }
  expect(await suggest(page, ['MIXED USE SHOP'])).toEqual([])

  // 3 Health vs 1 Personal Care: Health holds a clear majority (3 of 4).
  await mkTxn(page, { accountId: account, amount: 15, type: 'expense', merchant: 'CLEAR MAJORITY SHOP', categoryId: health })
  await mkTxn(page, { accountId: account, amount: 15, type: 'expense', merchant: 'CLEAR MAJORITY SHOP', categoryId: health })
  await mkTxn(page, { accountId: account, amount: 15, type: 'expense', merchant: 'CLEAR MAJORITY SHOP', categoryId: health })
  await mkTxn(page, { accountId: account, amount: 15, type: 'expense', merchant: 'CLEAR MAJORITY SHOP', categoryId: personalCare })
  const [hit] = await suggest(page, ['CLEAR MAJORITY SHOP'])
  expect(hit.categoryId).toBe(health)
  expect(hit.matchCount).toBe(3)
  expect(hit.totalCount).toBe(4)

  await ctx.close()
})

test('transfers are excluded from the history read even when they carry a category', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.request.post(`${API}/auth/signup`, { data: { username: `e2e_transfer_${Date.now()}`, password: 'test-password' } })
  const from = await mkAccount(page, 'From')
  const to = await mkAccount(page, 'To')
  const transport = await categoryId(page, 'Transport')

  // A merchant with no builtin coverage, seen only as transfers carrying a
  // category — a synthetic case (transfers do not normally carry one), but it
  // is exactly what proves the route's own `type != 'transfer'` filter works
  // rather than relying on category_id already being null by convention.
  for (let i = 0; i < 3; i++) {
    await mkTxn(page, {
      accountId: from, amount: 10, type: 'transfer', merchant: 'ACME REGULAR PAYEE',
      categoryId: transport, destinationAccountId: to,
    })
  }
  expect(await suggest(page, ['ACME REGULAR PAYEE'])).toEqual([])

  await ctx.close()
})

// ── Stage 3 — builtin map ──────────────────────────────────────────────────

test('builtin fallback: a merchant with no history matches the map', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.request.post(`${API}/auth/signup`, { data: { username: `e2e_builtin_${Date.now()}`, password: 'test-password' } })
  const foodDrink = await categoryId(page, 'Food & Drink')

  // "DRIVE THRU" has no separator before it, so step 7 does not truncate it —
  // by design (§3.2: no hand-maintained location-suffix list). The canonical
  // stays "KFC DRIVE THRU"; builtinCategory() still resolves it via the
  // word-prefix fallback down to "KFC".
  const [hit] = await suggest(page, ['KFC DRIVE THRU 4471102'])
  expect(hit.canonical).toBe('KFC DRIVE THRU')
  expect(hit.categoryId).toBe(foodDrink)
  expect(hit.matchCount).toBe(0) // 0 = builtin, not history

  await ctx.close()
})

test('GRAB does not capture GRABFOOD', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.request.post(`${API}/auth/signup`, { data: { username: `e2e_grab_${Date.now()}`, password: 'test-password' } })
  const transport = await categoryId(page, 'Transport')
  const foodDrink = await categoryId(page, 'Food & Drink')

  const [grab] = await suggest(page, ['GRAB*RIDE 99012'])
  expect(grab.canonical).toBe('GRAB')
  expect(grab.categoryId).toBe(transport)

  const [grabfood] = await suggest(page, ['GRABFOOD*ORDER 88123'])
  expect(grabfood.canonical).toBe('GRABFOOD')
  expect(grabfood.categoryId).toBe(foodDrink)

  await ctx.close()
})

test('INDAH WATER 26 GRACE WONG hits the map by word-prefix', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.request.post(`${API}/auth/signup`, { data: { username: `e2e_prefix_${Date.now()}`, password: 'test-password' } })
  const billsUtilities = await categoryId(page, 'Bills & Utilities')

  const [hit] = await suggest(page, ['INDAH WATER 26 GRACE WONG LING SAN'])
  expect(hit.canonical).toBe('INDAH WATER 26 GRACE WONG LING SAN')
  expect(hit.categoryId).toBe(billsUtilities)

  await ctx.close()
})

test('an internal separator does not truncate the name to nothing (7-ELEVEN)', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.request.post(`${API}/auth/signup`, { data: { username: `e2e_seven_${Date.now()}`, password: 'test-password' } })
  const shopping = await categoryId(page, 'Shopping')

  // Splitting on '-' leaves "7", which is not a usable name — the canonicaliser
  // falls back to the whole string rather than giving up, or no history and no
  // map entry could ever match one of the most common merchants in the country.
  const [hit] = await suggest(page, ['7-ELEVEN MY TOWN 4471102'])
  expect(hit.canonical).toBe('7 ELEVEN MY TOWN')
  expect(hit.categoryId).toBe(shopping)

  await ctx.close()
})

test('a generic map key matches the whole name only, never as a prefix', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.request.post(`${API}/auth/signup`, { data: { username: `e2e_generic_${Date.now()}`, password: 'test-password' } })
  const transport = await categoryId(page, 'Transport')

  // PLUS is the highway operator, but it is also an ordinary English word.
  const [toll] = await suggest(page, ['PLUS 1234'])
  expect(toll.categoryId).toBe(transport)
  expect(await suggest(page, ['PLUS SIZE STORE'])).toEqual([])

  await ctx.close()
})

test('a suggestion reports its category direction', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.request.post(`${API}/auth/signup`, { data: { username: `e2e_dir_${Date.now()}`, password: 'test-password' } })

  // The map is all expense categories and history is read across both
  // directions, so the caller needs the direction to decide whether a
  // suggestion may be applied to a given row.
  const [hit] = await suggest(page, ['KFC 4471102'])
  expect(hit.categoryType).toBe('expense')

  await ctx.close()
})

// ── CSV import review UI ────────────────────────────────────────────────────

async function uploadCsv(page: Page, csv: string, filename: string) {
  await page.evaluate(
    async ({ content, name }) => {
      const file = new File([content], name, { type: 'text/csv' })
      await window.__testCsvFileSelect(file)
    },
    { content: csv, name: filename },
  )
  await expect(page.getByText('Map Columns')).toBeVisible({ timeout: 10_000 })
}

test('review step pre-fills a category from history with a match-count caption', async ({ browser }) => {
  const ctx = await browser.newContext()
  const setup = await ctx.newPage()
  await setup.request.post(`${API}/auth/signup`, { data: { username: `e2e_uifold_${Date.now()}`, password: 'test-password' } })
  await mkAccount(setup, 'Card')
  const foodDrink = await categoryId(setup, 'Food & Drink')
  const account = (await (await setup.request.get(`${API}/accounts`)).json())[0].id
  for (const merchant of ['MCDONALDS-PAVILION KL', 'MCDONALDS-MY TOWN00368', 'MCDONALDS*SETAPAK']) {
    await mkTxn(setup, { accountId: account, amount: 9.5, type: 'expense', merchant, categoryId: foodDrink })
  }

  const page = await ctx.newPage()
  await page.goto('/wallet/import')
  await expect(page.locator('main').getByRole('heading', { name: 'Import CSV' })).toBeVisible()
  await uploadCsv(page, 'Date,Amount,Merchant\n2026-07-20,-9.50,MCDONALDS/KLCC\n', 'mcd.csv')
  await page.getByRole('button', { name: /Review Rows/ }).click()
  await expect(page.getByText('Review Import')).toBeVisible()

  await expect(page.getByTestId('csv-suggestions-banner')).toContainText('Suggested a category for 1 of 1 row')
  await expect(page.getByText('MCDONALDS · you categorised this 3×')).toBeVisible()

  const categorySelect = page.locator('tbody tr').first().locator('select').last()
  await expect(categorySelect).toHaveValue(foodDrink)

  await ctx.close()
})

test('review step pre-fills from the builtin map with a "common merchant" caption', async ({ browser }) => {
  const page = await newAppPage(browser, '/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  const { fillAccountForm } = await import('./helpers')
  await fillAccountForm(page, { name: 'Card', type: 'bank' })

  await page.getByRole('link', { name: 'Import CSV' }).click()
  await uploadCsv(page, 'Date,Amount,Merchant\n2026-07-20,-12.00,KFC 4471102\n', 'kfc.csv')
  await page.getByRole('button', { name: /Review Rows/ }).click()
  await expect(page.getByText('Review Import')).toBeVisible()

  await expect(page.getByText('KFC · common merchant')).toBeVisible()

  await page.context().close()
})

test('Clear suggestions nulls only the pre-filled rows, hand-picked categories untouched', async ({ browser }) => {
  const ctx = await browser.newContext()
  const setup = await ctx.newPage()
  await setup.request.post(`${API}/auth/signup`, { data: { username: `e2e_clear_${Date.now()}`, password: 'test-password' } })
  await mkAccount(setup, 'Card')
  const foodDrink = await categoryId(setup, 'Food & Drink')
  const other = await categoryId(setup, 'Other')
  const account = (await (await setup.request.get(`${API}/accounts`)).json())[0].id
  for (const merchant of ['MCDONALDS-PAVILION KL', 'MCDONALDS-MY TOWN00368', 'MCDONALDS*SETAPAK']) {
    await mkTxn(setup, { accountId: account, amount: 9.5, type: 'expense', merchant, categoryId: foodDrink })
  }

  const page = await ctx.newPage()
  await page.goto('/wallet/import')
  await expect(page.locator('main').getByRole('heading', { name: 'Import CSV' })).toBeVisible()
  await uploadCsv(
    page,
    'Date,Amount,Merchant\n2026-07-20,-9.50,MCDONALDS/KLCC\n2026-07-21,-40.00,BRAND NEW SHOP\n',
    'mixed.csv',
  )
  await page.getByRole('button', { name: /Review Rows/ }).click()
  await expect(page.getByText('Review Import')).toBeVisible()

  // Row order mirrors CSV row order (the suggestion pass mutates rows in
  // place, it does not reorder them) — an input's value isn't part of its
  // textContent, so filtering by hasText can't locate a row by merchant here.
  const rows = page.locator('tbody tr')
  const suggestedRow = rows.nth(0) // MCDONALDS/KLCC
  const manualRow = rows.nth(1) // BRAND NEW SHOP

  await expect(suggestedRow.locator('select').last()).toHaveValue(foodDrink)
  // Hand-pick a category on the row that had no suggestion.
  await manualRow.locator('select').last().selectOption(other)

  await page.getByTestId('csv-suggestions-banner').getByRole('button', { name: 'Clear suggestions' }).click()

  await expect(suggestedRow.locator('select').last()).toHaveValue('')
  await expect(manualRow.locator('select').last()).toHaveValue(other)
  await expect(page.getByTestId('csv-suggestions-banner')).not.toBeVisible()

  await ctx.close()
})

test('a failed suggestion call still allows the import to proceed', async ({ browser }) => {
  const page = await newAppPage(browser, '/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  const { fillAccountForm } = await import('./helpers')
  await fillAccountForm(page, { name: 'Card', type: 'bank' })

  await page.route('**/api/transactions/suggest-categories', (route) => route.abort())

  await page.getByRole('link', { name: 'Import CSV' }).click()
  await uploadCsv(page, 'Date,Amount,Merchant\n2026-07-20,-5.00,SomeShop\n', 'fail.csv')
  await page.getByRole('button', { name: /Review Rows/ }).click()
  await expect(page.getByText('Review Import')).toBeVisible()
  await expect(page.getByText('1 to import')).toBeVisible()
  await expect(page.getByTestId('csv-suggestions-banner')).not.toBeVisible()

  await page.getByRole('button', { name: /Import 1 Transaction/ }).click()
  await expect(page.getByText('Import Complete')).toBeVisible({ timeout: 15_000 })

  await page.context().close()
})

test('a money-in row is not pre-filled with an expense suggestion', async ({ browser }) => {
  const page = await newAppPage(browser, '/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  const { fillAccountForm } = await import('./helpers')
  await fillAccountForm(page, { name: 'Card', type: 'bank' })

  await page.getByRole('link', { name: 'Import CSV' }).click()
  // A refund from a shop the builtin map covers: the row is income, the
  // suggestion is an expense category. Applying it would set a value the row's
  // own Category select does not offer — the select renders blank while the
  // value is still set, so it would import invisibly.
  await uploadCsv(page, 'Date,Amount,Merchant\n2026-07-20,12.00,KFC 4471102\n', 'refund.csv')
  await page.getByRole('button', { name: /Review Rows/ }).click()
  await expect(page.getByText('Review Import')).toBeVisible()

  await expect(page.locator('tbody tr').first().locator('select').first()).toHaveValue('income')
  await expect(page.getByText('KFC · common merchant')).not.toBeVisible()
  await expect(page.getByTestId('csv-suggestions-banner')).not.toBeVisible()
  await expect(page.locator('tbody tr').first().locator('select').last()).toHaveValue('')

  await page.context().close()
})

test('re-importing the same file after suggestions still detects duplicates (G11)', async ({ browser }) => {
  const page = await newAppPage(browser, '/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  const { fillAccountForm } = await import('./helpers')
  await fillAccountForm(page, { name: 'Card', type: 'bank' })

  const csv = 'Date,Amount,Merchant\n2026-07-20,-12.00,KFC 4471102\n'

  await page.getByRole('link', { name: 'Import CSV' }).click()
  await uploadCsv(page, csv, 'kfc.csv')
  await page.getByRole('button', { name: /Review Rows/ }).click()
  await expect(page.getByText('Review Import')).toBeVisible()
  await expect(page.getByText('KFC · common merchant')).toBeVisible() // suggestion did apply
  await page.getByRole('button', { name: /Import 1 Transaction/ }).click()
  await expect(page.getByText('Import Complete')).toBeVisible({ timeout: 15_000 })

  await page.getByRole('link', { name: 'Import CSV' }).click()
  await uploadCsv(page, csv, 'kfc.csv')
  await page.getByRole('button', { name: /Review Rows/ }).click()
  await expect(page.getByText('Review Import')).toBeVisible()
  await expect(page.getByText('0 to import')).toBeVisible()
  await expect(page.getByText('1 duplicate')).toBeVisible()

  await page.context().close()
})
