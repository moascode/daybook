/**
 * 85 — Global search (R17 §1).
 *
 * The app bar's field has existed since R2 and searched nothing. These cover
 * the two things that matter: that it finds what you own across modules, and
 * that it CANNOT find what you don't — a search box is a classic way to leak
 * rows past the scoping every other route applies.
 */

import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { newAppPage, businessToday } from './helpers'

const API = '/api'

async function seed(page: Page) {
  const acct = await (await page.request.post(`${API}/accounts`, { data: { name: 'Maybank Everyday', type: 'bank' } })).json()
  await page.request.post(`${API}/transactions`, {
    data: { accountId: acct.id, date: businessToday(), merchant: 'Zanzibar Coffee', amount: 14.5, type: 'expense' },
  })
  await page.request.post(`${API}/tasks`, { data: { content: 'Renew Zanzibar passport' } })
  return acct.id as string
}

test.describe('global search', () => {
  test('finds transactions, tasks and accounts, grouped', async ({ browser }) => {
    const page = await newAppPage(browser)
    await seed(page)
    await page.reload()

    await page.getByTestId('global-search-input').fill('Zanzibar')
    await expect(page.getByTestId('search-results')).toBeVisible()

    const hits = page.getByTestId('search-hit')
    await expect(hits).toHaveCount(2)
    await expect(page.locator('[data-testid="search-hit"][data-group="transactions"]')).toContainText('Zanzibar Coffee')
    await expect(page.locator('[data-testid="search-hit"][data-group="tasks"]')).toContainText('Renew Zanzibar passport')

    await page.getByTestId('global-search-input').fill('Maybank')
    await expect(page.locator('[data-testid="search-hit"][data-group="accounts"]')).toContainText('Maybank Everyday')
  })

  test('navigates on click and clears itself', async ({ browser }) => {
    const page = await newAppPage(browser)
    await seed(page)
    await page.reload()

    await page.getByTestId('global-search-input').fill('Maybank')
    await page.locator('[data-testid="search-hit"][data-group="accounts"]').click()

    await expect(page).toHaveURL(/\/wallet\/accounts/)
    await expect(page.getByTestId('global-search-input')).toHaveValue('')
    await expect(page.getByTestId('search-results')).toHaveCount(0)
  })

  test('is keyboard-driven — arrows move, Enter opens', async ({ browser }) => {
    const page = await newAppPage(browser)
    await seed(page)
    await page.reload()

    await page.getByTestId('global-search-input').fill('Zanzibar')
    await expect(page.getByTestId('search-hit')).toHaveCount(2)

    // First hit is the transaction; one ArrowDown reaches the task.
    await page.getByTestId('global-search-input').press('ArrowDown')
    await page.getByTestId('global-search-input').press('Enter')
    await expect(page).toHaveURL(/\/tasks/)
  })

  test('says when nothing matches', async ({ browser }) => {
    const page = await newAppPage(browser)
    await seed(page)
    await page.reload()
    await page.getByTestId('global-search-input').fill('qqzzxx')
    await expect(page.getByTestId('search-empty')).toContainText('Nothing matches')
  })

  test('stays quiet under two characters', async ({ browser }) => {
    const page = await newAppPage(browser)
    await page.getByTestId('global-search-input').fill('a')
    await expect(page.getByTestId('search-results')).toHaveCount(0)
  })

  test('says something when the search itself fails', async ({ browser }) => {
    const page = await newAppPage(browser)
    await page.route('**/api/search**', (route) => route.abort())
    await page.getByTestId('global-search-input').fill('anything')
    // Rule 13: a broken search and an empty result set must not look the same.
    await expect(page.getByTestId('search-error')).toBeVisible()
  })

  test("never returns another user's rows", async ({ browser }) => {
    const owner = await newAppPage(browser)
    await seed(owner)

    const other = await newAppPage(browser)
    const res = await other.request.get(`${API}/search?q=Zanzibar`)
    const { hits } = await res.json()
    expect(hits, 'a search box must not be a way around per-user scoping').toEqual([])

    // …and the owner still finds them.
    const mine = await (await owner.request.get(`${API}/search?q=Zanzibar`)).json()
    expect(mine.hits.length).toBe(2)
  })

  test('treats LIKE wildcards as literal characters', async ({ browser }) => {
    const page = await newAppPage(browser)
    const acct = await (await page.request.post(`${API}/accounts`, { data: { name: 'Plain', type: 'cash' } })).json()
    for (const merchant of ['Coffee', 'C%offee']) {
      await page.request.post(`${API}/transactions`, {
        data: { accountId: acct.id, date: businessToday(), merchant, amount: 5, type: 'expense' },
      })
    }

    // "C%o" escaped matches the literal string and finds one row. Unescaped,
    // the % is a wildcard and it would also match "Coffee" — so this fails
    // loudly if the ESCAPE clause is ever dropped.
    const res = await (await page.request.get(`${API}/search?q=${encodeURIComponent('C%o')}`)).json()
    expect(res.hits.map((h: { title: string }) => h.title)).toEqual(['C%offee'])
  })
})
