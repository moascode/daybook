/**
 * 57 — Bulk apply categories and tags.
 *
 * Select-mode gains a "Categorise" action that applies a category and/or a tag
 * change to the whole selection in one request (POST /transactions/bulk-update).
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, businessToday } from './helpers'

test.describe.configure({ mode: 'serial' })

const API = '/api'

async function seed(page: Page, merchants: string[]) {
  const acct = await (await page.request.post(`${API}/accounts`, {
    data: { name: 'Bulk Acct', type: 'cash', openingBalance: 0 },
  })).json() as { id: string }

  for (const merchant of merchants) {
    await page.request.post(`${API}/transactions`, {
      data: { accountId: acct.id, date: businessToday(), merchant, amount: 10, type: 'expense' },
    })
  }
  return acct
}

// ── UI flow ────────────────────────────────────────────────────────────

test.describe('bulk edit dialog', () => {
  let page: Page

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    page = await newAppPage(browser, '/wallet')
    await seed(page, ['Coffee', 'Lunch', 'Taxi'])
    await page.reload()
  })

  test.afterAll(async () => {
    await page.context().close()
  })

  test('the Categorise action appears only with a selection', async () => {
    await expect(page.getByText('Coffee')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Select transactions' }).click()
    await expect(page.getByTestId('select-mode-bar')).toBeVisible()

    await expect(page.getByTestId('bulk-edit-btn')).not.toBeVisible()

    await page.getByTestId('select-mode-bar').locator('input[type="checkbox"]').click()
    await expect(page.getByTestId('bulk-edit-btn')).toBeVisible()
    await expect(page.getByTestId('bulk-edit-btn')).toContainText('Categorise 3')
  })

  test('the category list is filtered to the selected transactions\' types', async () => {
    await page.getByTestId('bulk-edit-btn').click()
    const select = page.getByTestId('bulk-edit-category')
    await expect(select).toBeVisible()

    // All three rows are expenses, so income-only categories must not be offered.
    await expect(select.locator('option', { hasText: 'Food & Drink' })).toHaveCount(1)
    await expect(select.locator('option', { hasText: 'Salary' })).toHaveCount(0)
  })

  test('Apply is disabled until something would actually change', async () => {
    // Opening the dialog and pressing Apply must not silently wipe categories
    // or tags — "Keep current category" plus untouched tags is a no-op.
    await expect(page.getByTestId('bulk-edit-apply')).toBeDisabled()
  })

  test('applying a category and a tag updates every selected transaction', async () => {
    await page.getByTestId('bulk-edit-category').selectOption({ label: 'Food & Drink' })
    await page.getByTestId('bulk-edit-tags').fill('work')
    await page.getByTestId('bulk-edit-tags').press('Enter')

    await expect(page.getByTestId('bulk-edit-apply')).toBeEnabled()
    await page.getByTestId('bulk-edit-apply').click()

    await expect(page.getByText('Updated 3 transactions')).toBeVisible({ timeout: 10_000 })

    // Every row now shows the category and the tag.
    for (const merchant of ['Coffee', 'Lunch', 'Taxi']) {
      const row = page.locator('[data-testid="transaction-row"]').filter({ hasText: merchant })
      await expect(row).toContainText('Food & Drink')
      await expect(row).toContainText('work')
    }
  })
})

// ── Server contract ────────────────────────────────────────────────────
//
// The tag modes and the transfer rule are cheaper and clearer to assert at the
// API than by driving three dialogs.

test.describe('bulk-update endpoint', () => {
  let page: Page
  let acctId: string
  let ids: string[]
  let transferId: string

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    page = await newAppPage(browser, '/wallet')
    const acct = await (await page.request.post(`${API}/accounts`, {
      data: { name: 'API Acct', type: 'cash', openingBalance: 0 },
    })).json() as { id: string }
    acctId = acct.id
    const second = await (await page.request.post(`${API}/accounts`, {
      data: { name: 'API Acct 2', type: 'bank', openingBalance: 0 },
    })).json() as { id: string }

    ids = []
    for (const merchant of ['A', 'B']) {
      const t = await (await page.request.post(`${API}/transactions`, {
        data: {
          accountId: acctId, date: businessToday(), merchant, amount: 10,
          type: 'expense', tag: JSON.stringify(['old']),
        },
      })).json() as { id: string }
      ids.push(t.id)
    }
    const tr = await (await page.request.post(`${API}/transactions`, {
      data: {
        accountId: acctId, destinationAccountId: second.id, date: businessToday(),
        merchant: 'Move', amount: 5, type: 'transfer',
      },
    })).json() as { id: string }
    transferId = tr.id
  })

  test.afterAll(async () => {
    await page.context().close()
  })

  async function tagsOf(id: string): Promise<string[]> {
    const rows = await (await page.request.get(`${API}/transactions?range=all`)).json() as
      { id: string; tag: string | null }[]
    const row = rows.find((r) => r.id === id)!
    return row.tag ? JSON.parse(row.tag) : []
  }

  test('mode "add" merges without duplicating, and trims whitespace', async () => {
    const res = await page.request.post(`${API}/transactions/bulk-update`, {
      data: { ids, tags: { mode: 'add', values: ['work', '  work  ', 'urgent'] } },
    })
    expect(res.status()).toBe(200)
    expect(await res.json()).toMatchObject({ updated: 2, skippedTransfers: 0 })
    expect(await tagsOf(ids[0])).toEqual(['old', 'work', 'urgent'])
  })

  test('mode "remove" drops only the named tags', async () => {
    await page.request.post(`${API}/transactions/bulk-update`, {
      data: { ids, tags: { mode: 'remove', values: ['old'] } },
    })
    expect(await tagsOf(ids[0])).toEqual(['work', 'urgent'])
  })

  test('mode "replace" with an empty list clears every tag', async () => {
    await page.request.post(`${API}/transactions/bulk-update`, {
      data: { ids: [ids[0]], tags: { mode: 'replace', values: [] } },
    })
    expect(await tagsOf(ids[0])).toEqual([])
  })

  test('transfers in the selection are skipped, not rejected', async () => {
    const res = await page.request.post(`${API}/transactions/bulk-update`, {
      data: { ids: [...ids, transferId], tags: { mode: 'add', values: ['trip'] } },
    })
    expect(res.status()).toBe(200)
    // A selection dragged down a list will often include a transfer; failing the
    // whole request over one would make the feature unusable.
    expect(await res.json()).toMatchObject({ updated: 2, skippedTransfers: 1 })
    expect(await tagsOf(transferId)).toEqual([])
  })

  test('a request that changes nothing is rejected', async () => {
    const res = await page.request.post(`${API}/transactions/bulk-update`, { data: { ids } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toContain('nothing to update')
  })

  test('an unknown tag mode is rejected', async () => {
    const res = await page.request.post(`${API}/transactions/bulk-update`, {
      data: { ids, tags: { mode: 'bogus', values: ['x'] } },
    })
    expect(res.status()).toBe(400)
  })

  test('an unknown transaction id is rejected', async () => {
    const res = await page.request.post(`${API}/transactions/bulk-update`, {
      data: { ids: ['does-not-exist'], tags: { mode: 'add', values: ['x'] } },
    })
    expect(res.status()).toBe(404)
  })

  test('another user cannot touch these transactions', async ({ browser }) => {
    const intruder = await newAppPage(browser, '/wallet')
    const res = await intruder.request.post(`${API}/transactions/bulk-update`, {
      data: { ids, tags: { mode: 'add', values: ['pwned'] } },
    })
    expect(res.status()).toBe(403)
    // And nothing was written.
    expect(await tagsOf(ids[1])).not.toContain('pwned')
    await intruder.context().close()
  })

  test('a category belonging to another user is rejected', async ({ browser }) => {
    const other = await newAppPage(browser, '/wallet')
    const theirCategories = await (await other.request.get(`${API}/categories`)).json() as
      { id: string }[]
    const res = await page.request.post(`${API}/transactions/bulk-update`, {
      data: { ids, categoryId: theirCategories[0].id },
    })
    expect(res.status()).toBe(400)
    await other.context().close()
  })
})

// ── Suggestions in the bulk edit dialog (docs/auto-categorisation-plan.md §4.2) ──

test.describe('suggestions in the bulk edit dialog', () => {
  async function categoryIdByName(page: Page, name: string): Promise<string> {
    const cats = await (await page.request.get(`${API}/categories`)).json() as { id: string; name: string }[]
    return cats.find((c) => c.name === name)!.id
  }

  async function selectRow(page: Page, merchant: string) {
    await page.getByRole('button', { name: `Select transaction ${merchant}` }).click()
  }

  test('suggestions appear for a mixed selection and Apply suggestions applies only the matched rows', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')
    const acct = await (await page.request.post(`${API}/accounts`, {
      data: { name: 'Suggest Acct', type: 'cash', openingBalance: 0 },
    })).json() as { id: string }
    const foodDrink = await categoryIdByName(page, 'Food & Drink')

    // History: three spellings of one merchant, already categorised.
    for (const merchant of ['MCDONALDS-ONE', 'MCDONALDS-TWO', 'MCDONALDS-THREE']) {
      await page.request.post(`${API}/transactions`, {
        data: { accountId: acct.id, date: businessToday(), merchant, amount: 9.5, type: 'expense', categoryId: foodDrink },
      })
    }
    // Two uncategorised rows to select: one folds to the same canonical, one matches nothing.
    await page.request.post(`${API}/transactions`, {
      data: { accountId: acct.id, date: businessToday(), merchant: 'MCDONALDS-FOUR', amount: 9.5, type: 'expense' },
    })
    await page.request.post(`${API}/transactions`, {
      data: { accountId: acct.id, date: businessToday(), merchant: 'FRESH MERCHANT NOPE', amount: 20, type: 'expense' },
    })

    await page.reload()
    await expect(page.getByText('MCDONALDS-FOUR')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Select transactions' }).click()
    await selectRow(page, 'MCDONALDS-FOUR')
    await selectRow(page, 'FRESH MERCHANT NOPE')
    await page.getByTestId('bulk-edit-btn').click()

    const suggestions = page.getByTestId('bulk-edit-suggestions')
    await expect(suggestions).toBeVisible()
    await expect(suggestions).toContainText('MCDONALDS')
    await expect(suggestions).toContainText('Food & Drink')
    await expect(suggestions).toContainText('you categorised this 3×')
    await expect(suggestions).toContainText('1 transaction has no suggestion')

    await page.getByTestId('bulk-edit-apply-suggestions').click()
    await expect(page.getByText('Updated 1 transaction')).toBeVisible({ timeout: 10_000 })

    const suggestedRow = page.locator('[data-testid="transaction-row"]').filter({ hasText: 'MCDONALDS-FOUR' })
    await expect(suggestedRow).toContainText('Food & Drink')
    const noSuggestionRow = page.locator('[data-testid="transaction-row"]').filter({ hasText: 'FRESH MERCHANT NOPE' })
    await expect(noSuggestionRow).not.toContainText('Food & Drink')

    await page.context().close()
  })

  test('a transfer in the selection is excluded from suggestions and reported separately', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')
    const acct = await (await page.request.post(`${API}/accounts`, {
      data: { name: 'Transfer Suggest Acct', type: 'cash', openingBalance: 0 },
    })).json() as { id: string }
    const other = await (await page.request.post(`${API}/accounts`, {
      data: { name: 'Transfer Suggest Acct 2', type: 'bank', openingBalance: 0 },
    })).json() as { id: string }

    // Builtin-covered merchant name, once as an expense (suggestible) and once
    // as a transfer (must never surface a suggestion, however it is spelled).
    await page.request.post(`${API}/transactions`, {
      data: { accountId: acct.id, date: businessToday(), merchant: 'SHELL STATION', amount: 80, type: 'expense' },
    })
    await page.request.post(`${API}/transactions`, {
      data: {
        accountId: acct.id, destinationAccountId: other.id, date: businessToday(),
        merchant: 'SHELL STATION', amount: 5, type: 'transfer',
      },
    })

    await page.reload()
    await expect(page.getByText('SHELL STATION').first()).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Select transactions' }).click()
    await page.getByTestId('select-mode-bar').locator('input[type="checkbox"]').click() // select all
    await page.getByTestId('bulk-edit-btn').click()

    await expect(page.getByTestId('bulk-edit-transfer-note')).toContainText('1 transfer')
    const suggestions = page.getByTestId('bulk-edit-suggestions')
    await expect(suggestions).toContainText('1 transaction')
    await expect(suggestions).not.toContainText('2 transaction')

    await page.getByTestId('bulk-edit-apply-suggestions').click()
    await expect(page.getByText('Updated 1 transaction')).toBeVisible({ timeout: 10_000 })

    await page.context().close()
  })

  test('a money-in row is excluded from an expense suggestion', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')
    const acct = await (await page.request.post(`${API}/accounts`, {
      data: { name: 'Refund Suggest Acct', type: 'cash', openingBalance: 0 },
    })).json() as { id: string }

    // Same builtin-covered merchant twice: an expense (suggestible) and a
    // refund booked as income. An expense category must not land on the
    // money-in row — the Category select in this very dialog does not offer it.
    await page.request.post(`${API}/transactions`, {
      data: { accountId: acct.id, date: businessToday(), merchant: 'KFC REFUND CASE', amount: 12, type: 'expense' },
    })
    await page.request.post(`${API}/transactions`, {
      data: { accountId: acct.id, date: businessToday(), merchant: 'KFC REFUND CASE', amount: 12, type: 'income' },
    })

    await page.reload()
    await expect(page.getByText('KFC REFUND CASE').first()).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Select transactions' }).click()
    await page.getByTestId('select-mode-bar').locator('input[type="checkbox"]').click() // select all
    await page.getByTestId('bulk-edit-btn').click()

    const suggestions = page.getByTestId('bulk-edit-suggestions')
    await expect(suggestions).toContainText('Food & Drink')
    await expect(suggestions).toContainText('1 transaction ·')
    await expect(suggestions).toContainText('1 transaction has no suggestion')

    await page.getByTestId('bulk-edit-apply-suggestions').click()
    await expect(page.getByText('Updated 1 transaction')).toBeVisible({ timeout: 10_000 })

    await page.context().close()
  })

  test('the manual Category select overrides suggestions when Apply is used instead', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')
    const acct = await (await page.request.post(`${API}/accounts`, {
      data: { name: 'Override Acct', type: 'cash', openingBalance: 0 },
    })).json() as { id: string }
    // Builtin-covered merchant (KFC -> Food & Drink), left uncategorised.
    await page.request.post(`${API}/transactions`, {
      data: { accountId: acct.id, date: businessToday(), merchant: 'KFC', amount: 12, type: 'expense' },
    })

    await page.reload()
    await expect(page.getByText('KFC')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Select transactions' }).click()
    await selectRow(page, 'KFC')
    await page.getByTestId('bulk-edit-btn').click()

    await expect(page.getByTestId('bulk-edit-suggestions')).toContainText('Food & Drink')
    // Hand-pick a different category and use the normal Apply button, not
    // Apply suggestions — the manual choice must win.
    await page.getByTestId('bulk-edit-category').selectOption({ label: 'Other' })
    await page.getByTestId('bulk-edit-apply').click()
    await expect(page.getByText('Updated 1 transaction')).toBeVisible({ timeout: 10_000 })

    const row = page.locator('[data-testid="transaction-row"]').filter({ hasText: 'KFC' })
    await expect(row).toContainText('Other')
    await expect(row).not.toContainText('Food & Drink')

    await page.context().close()
  })
})
