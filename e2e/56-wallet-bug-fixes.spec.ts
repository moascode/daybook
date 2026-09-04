/**
 * 56 — Three reported wallet bugs.
 *
 * 1. Net worth counted shared-in accounts, so a co-member's balance was
 *    reported as the viewer's own money.
 * 2. Day headers in the transaction list showed no weekday.
 * 3. Category management was only reachable from an option inside the Category
 *    filter dropdown, inside the collapsed filter panel. (It has since moved
 *    again, to Settings → Wallet — see the mockup-parity rebuild of the
 *    Transactions page — but the discoverability regression this guards
 *    against is unchanged: reachable without opening any filter.)
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, businessToday } from './helpers'

test.describe.configure({ mode: 'serial' })

const API = '/api'

// ── Bug 1: net worth must exclude shared-in accounts ───────────────────

/**
 * Two users in one group, where the SECOND user owns a large account shared
 * into the first user's view. The first user owns a small one. Their net worth
 * must report only what they own.
 */
async function setupSharedHousehold(browser: Browser) {
  const ownerCtx = await browser.newContext()
  const viewerCtx = await browser.newContext()
  const ownerPage = await ownerCtx.newPage()
  const viewerPage = await viewerCtx.newPage()

  const stamp = Date.now()
  const ownerName = `nw_owner_${stamp}`
  const viewerName = `nw_viewer_${stamp}`

  await ownerPage.request.post(`${API}/auth/signup`, { data: { username: ownerName, password: 'test-password' } })
  await viewerPage.request.post(`${API}/auth/signup`, { data: { username: viewerName, password: 'test-password' } })

  // The owner builds the group and pulls the viewer in.
  const group = await (await ownerPage.request.post(`${API}/groups`, { data: { name: 'NW House' } })).json() as { id: string }
  await ownerPage.request.post(`${API}/groups/${group.id}/invites`, { data: { username: viewerName } })
  const invites = await (await viewerPage.request.get(`${API}/invites`)).json() as { id: string }[]
  await viewerPage.request.post(`${API}/invites/${invites[0].id}/accept`)

  // The owner's big account, shared into the viewer's view read-only.
  const shared = await (await ownerPage.request.post(`${API}/accounts`, {
    data: { name: 'Owner Savings', type: 'bank', openingBalance: 9999 },
  })).json() as { id: string }
  await ownerPage.request.post(`${API}/accounts/${shared.id}/shares`, { data: { groupId: group.id, canWrite: 0 } })

  // The viewer's own, much smaller account.
  await viewerPage.request.post(`${API}/accounts`, {
    data: { name: 'Viewer Cash', type: 'cash', openingBalance: 100 },
  })

  return { ownerPage, viewerPage, ownerCtx, viewerCtx }
}

test('net worth excludes shared-in accounts on the Accounts page', async ({ browser }) => {
  const { viewerPage, ownerCtx, viewerCtx } = await setupSharedHousehold(browser)

  await viewerPage.goto('/wallet/accounts')
  await expect(viewerPage.locator('main')).toBeVisible({ timeout: 20_000 })

  // Both cards render — the shared account stays visible with its real balance.
  await expect(viewerPage.getByText('Viewer Cash')).toBeVisible({ timeout: 10_000 })
  await expect(viewerPage.getByText('Owner Savings')).toBeVisible()

  const banner = viewerPage.getByTestId('net-worth-banner')
  // 100, not 10,099. The regression is the shared 9,999 leaking into the total.
  await expect(banner).toContainText('100.00')
  await expect(banner).not.toContainText('10,099')
  // The caption must count the same set the figure was summed over.
  await expect(banner).toContainText('1 account')

  await ownerCtx.close()
  await viewerCtx.close()
})

// The Transactions page no longer shows a whole-account-book net worth total
// at all (docs/v2 wallet-transactions rebuild, a literal mockup port) — it
// only reports the filtered range's Money in / Money out / Net, so the
// shared-in-account-leaking-into-a-total regression this test guarded against
// can no longer occur there. Coverage stays on the Accounts page above, which
// still owns that figure.

// ── Bugs 2 and 3: single-user, one page ────────────────────────────────

test.describe('day headers and category management', () => {
  let page: Page

  test.beforeAll(async ({ browser }) => {
    page = await newAppPage(browser, '/wallet')
    const acct = await (await page.request.post(`${API}/accounts`, {
      data: { name: 'Day Header Cash', type: 'cash', openingBalance: 0 },
    })).json() as { id: string }
    await page.request.post(`${API}/transactions`, {
      data: { accountId: acct.id, date: businessToday(), merchant: 'Kopitiam', amount: 12.5, type: 'expense' },
    })
    await page.reload()
  })

  test.afterAll(async () => {
    await page.context().close()
  })

  test('day header names the weekday', async () => {
    await expect(page.getByText('Kopitiam')).toBeVisible({ timeout: 15_000 })

    // Assert the shape, not a fixed string: the spec must not start failing
    // simply because a different day of the week rolled around.
    const header = page.getByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} \w{3} \d{4}$/i).first()
    await expect(header).toBeVisible()

    // And it must name the weekday the date actually falls on.
    const expected = new Date(`${businessToday()}T00:00:00`)
      .toLocaleDateString('en-US', { weekday: 'short' })
    await expect(header).toContainText(new RegExp(`^${expected},`, 'i'))
  })

  test('categories are reachable from Settings, not only the filter dropdown', async () => {
    // The original bug was discoverability: the manager existed but sat three
    // levels down inside a collapsed filter panel. It was later surfaced on
    // the Transactions toolbar (PR #56), then moved again — to Settings →
    // Wallet, its single canonical location — as part of the mockup-parity
    // rebuild of the Transactions page. Either way, it must be reachable
    // without opening any filter.
    await page.goto('/settings')
    const button = page.getByTestId('manage-categories')
    await expect(button).toBeVisible()
    await button.click()

    await expect(page.getByRole('dialog').getByText('Manage Categories')).toBeVisible()
  })

  test('a category added from the Settings manager persists', async () => {
    const dialog = page.getByRole('dialog')
    const name = `Subscriptions ${Date.now()}`

    await dialog.getByLabel('Name').fill(name)
    await dialog.getByRole('button', { name: 'Add Category' }).click()

    // It appears in the manager's own list...
    await expect(dialog.getByText(name)).toBeVisible({ timeout: 10_000 })

    // ...and it really reached the server, rather than only the local list.
    const categories = await (await page.request.get(`${API}/categories`)).json() as { name: string }[]
    expect(categories.some((c) => c.name === name)).toBe(true)
  })
})
