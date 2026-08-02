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

const API = 'http://localhost:5173/api'

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
    await page.locator('#bulk-edit-tags').fill('work')
    await page.locator('#bulk-edit-tags').press('Enter')

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
