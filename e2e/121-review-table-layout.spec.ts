/**
 * 121 — Review table layout (CsvReviewTable rework).
 *
 * The capture inbox (/wallet/inbox) is the easiest surface to reach for this:
 * it needs no file upload, just a seeded capture (same pattern as
 * e2e/79-capture-inbox.spec.ts), and it renders CsvReviewTable with
 * `accountOptions` — the widest column set the table ever has to fit.
 *
 * Two assertions, matching the rework's acceptance criteria:
 *  - at 1280x800 the table itself must not force horizontal scroll
 *  - at 375x812 the page must not overflow horizontally, and the stacked
 *    card rows (CSS-only reflow, same DOM) must still be visible
 */

import { test, expect, request as playwrightRequest } from '@playwright/test'
import type { APIRequestContext, Page, Browser } from '@playwright/test'
import { waitForApp } from './helpers'

const API = '/api'

let seq = 0
const key = () => `review-layout-${Date.now()}-${seq++}`

/**
 * A locally-rolled sign-up rather than helpers.ts's shared `signUpOnPage` —
 * that helper's username is `e2e_${Date.now()}_${moduleCounter}`, and this
 * spec file's two tests run alongside four other spec files' own signups in
 * the same worker pool; a cross-worker collision on that exact string (same
 * millisecond, same per-process counter value) silently fails the signup
 * (the helper doesn't check its response) and leaves this test's request
 * context logged out, surfacing later as an unrelated 401 on account
 * creation. The random suffix here makes that collision astronomically
 * unlikely without touching the shared helper (out of this change's locked
 * file list).
 */
async function signUpUniquely(page: Page) {
  const username = `e2e_121_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await page.request.post(`${API}/auth/signup`, { data: { username, password: 'test-password' } })
}

async function tokenFor(page: Page): Promise<string> {
  const res = await page.request.post(`${API}/capture-tokens`, { data: { label: '121 spec' } })
  return (await res.json()).token
}

function capture(anon: APIRequestContext, token: string, data: Record<string, unknown>) {
  return anon.post(`${API}/capture/transaction`, {
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': key() },
    data,
  })
}

async function seedCapture(browser: Browser, viewport: { width: number; height: number }, baseURL: string | undefined) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  await signUpUniquely(page)
  const created = await page.request.post(`${API}/accounts`, { data: { name: 'Everyday', type: 'bank' } })
  expect(created.ok()).toBeTruthy()
  const token = await tokenFor(page)
  const anon = await playwrightRequest.newContext({ baseURL })
  await capture(anon, token, { merchant: 'Hotlink Postpaid Bill Payment Statement Narrative', amount: 45.6, card: 'Visa 1234' })
  await anon.dispose()
  return { ctx, page }
}

test('the review table does not overflow horizontally at 1280x800', async ({ browser, baseURL }) => {
  const { ctx, page } = await seedCapture(browser, { width: 1280, height: 800 }, baseURL)

  await page.goto('/wallet/inbox')
  await waitForApp(page)
  await expect(page.getByTestId('csv-review-row')).toHaveCount(1)

  // The scroll WRAPPER (`md:overflow-x-auto`, the table's parentElement) is
  // what actually clips/scrolls content — measuring the <table> element
  // itself only proves the table's intrinsic layout, not whether its wrapper
  // ended up needing to scroll.
  const table = page.locator('table').first()
  const { scrollWidth, clientWidth } = await table.evaluate((el) => {
    const wrapper = el.parentElement as HTMLElement
    return { scrollWidth: wrapper.scrollWidth, clientWidth: wrapper.clientWidth }
  })
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1) // 1px tolerance for sub-pixel rounding

  const page_ = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(page_.scrollWidth).toBeLessThanOrEqual(page_.innerWidth)

  await ctx.close()
})

test('the inbox reflows into stacked rows with no page overflow at 375x812', async ({ browser, baseURL }) => {
  const { ctx, page } = await seedCapture(browser, { width: 375, height: 812 }, baseURL)

  await page.goto('/wallet/inbox')
  await waitForApp(page)
  await expect(page.getByTestId('csv-review-row')).toHaveCount(1)
  await expect(page.getByTestId('csv-review-row').first()).toBeVisible()

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)

  // The reflowed card must stay a real, usable width — not just "not
  // overflowing" (a width of a few px would also satisfy the above).
  const rowBox = await page.getByTestId('csv-review-row').first().boundingBox()
  expect(rowBox?.width).toBeGreaterThan(300)

  const merchantBox = await page.getByRole('textbox', { name: 'Merchant for row 1' }).boundingBox()
  expect(merchantBox?.width).toBeGreaterThan(250)

  await ctx.close()
})
