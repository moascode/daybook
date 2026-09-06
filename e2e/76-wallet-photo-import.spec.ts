/**
 * 76 — Photo import (P2 in docs/v2/cross-cutting/ai-usage.md, approved
 * 2026-09-06; full spec docs/v2/wallet/feature-photo-import.md).
 *
 * Two layers, same convention as 59-merchant-suggestions / 64-merchant-ai-resolve:
 *  - API-level tests hit POST /transactions/import-photo directly — fast and
 *    precise for the route's contract (always 200, kind selection, rate
 *    limit, no-key, malformed-response handling).
 *  - UI-level tests drive the modal's Photo tab, intercepting the BROWSER's
 *    own call to our route (not the Worker->Anthropic call, which e2e can't
 *    see per CLAUDE.md §16 trap 6) so a multi-photo batch can be given
 *    different per-call outcomes — something the single DAYBOOK_TEST mock
 *    slot can't do, since it returns one canned value regardless of which
 *    photo triggered it.
 */

import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { newAppPage, fillAccountForm } from './helpers'

const API = '/api'
const PHOTO1 = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'photo1.png')
const PHOTO2 = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'photo2.png')

async function setApiKey(page: Page, value: string) {
  const res = await page.request.put(`${API}/settings/anthropic_api_key`, { data: { value } })
  expect(res.ok()).toBeTruthy()
}

async function mockPhotoAiResponse(page: Page, text: string) {
  const res = await page.request.post(`${API}/test/mock-ai-response`, { data: { text, feature: 'photo_import' } })
  expect(res.ok()).toBeTruthy()
}

async function importPhoto(page: Page, kind: 'receipt' | 'statement') {
  return page.request.post(`${API}/transactions/import-photo`, {
    data: { image: 'ZmFrZQ==', imageType: 'image/png', kind },
  })
}

// ── Server contract: POST /transactions/import-photo ────────────────────

test.describe('POST /transactions/import-photo', () => {
  test('receipt kind returns one row shaped per PhotoImportRow', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await setApiKey(page, 'sk-ant-test-dummy')
    await mockPhotoAiResponse(
      page,
      JSON.stringify({
        rows: [{ date: '2026-09-05', merchant: 'Village Grocer', amount: 42.6, type: 'expense', categoryGuess: 'Food & Drink' }],
      }),
    )

    const res = await importPhoto(page, 'receipt')
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.failureReason).toBeUndefined()
    expect(body.rows).toEqual([
      { date: '2026-09-05', merchant: 'Village Grocer', amount: 42.6, type: 'expense', categoryGuess: 'Food & Drink' },
    ])
  })

  test('statement kind returns multiple mixed-direction rows', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await setApiKey(page, 'sk-ant-test-dummy')
    await mockPhotoAiResponse(
      page,
      JSON.stringify({
        rows: [
          { date: '2026-09-01', merchant: 'Netflix', amount: 54.9, type: 'expense', categoryGuess: 'Entertainment' },
          { date: '2026-09-03', merchant: 'Salary', amount: 4200, type: 'income', categoryGuess: null },
        ],
      }),
    )

    const res = await importPhoto(page, 'statement')
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.rows).toHaveLength(2)
    expect(body.rows[0].type).toBe('expense')
    expect(body.rows[1].type).toBe('income')
    expect(body.rows[1].categoryGuess).toBeNull()
    expect(body.truncated).toBeUndefined()
  })

  test('a statement reply cut off mid-array still recovers the rows that completed, with truncated: true', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await setApiKey(page, 'sk-ant-test-dummy')
    // Simulates hitting max_tokens partway through the second row — the
    // first row's object is complete, the second is cut off before its
    // closing brace, and the array/object are never closed at all. Mirrors
    // the real Maybank-statement bug: JSON.parse on the whole reply fails,
    // so parsePhotoImportWithAI falls back to salvageTruncatedPhotoRows.
    await mockPhotoAiResponse(
      page,
      '{"rows":[{"date":"2026-08-01","merchant":"Grab","amount":20,"type":"expense","categoryGuess":"Transport"},{"date":"2026-08-02","merchant":"Star',
    )

    const res = await importPhoto(page, 'statement')
    expect(res.status()).toBe(200) // partial success, never an HTTP error — rule 13
    const body = await res.json()
    expect(body.rows).toEqual([
      { date: '2026-08-01', merchant: 'Grab', amount: 20, type: 'expense', categoryGuess: 'Transport' },
    ])
    expect(body.truncated).toBe(true)
    expect(body.failureReason).toBeUndefined()
  })

  test('a malformed AI response still returns 200 with an empty rows array and a failureReason', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await setApiKey(page, 'sk-ant-test-dummy')
    await mockPhotoAiResponse(page, 'not valid json{{{')

    const res = await importPhoto(page, 'receipt')
    expect(res.status()).toBe(200) // never an HTTP error — rule 13, spec §3
    const body = await res.json()
    expect(body.rows).toEqual([])
    expect(typeof body.failureReason).toBe('string')
  })

  test('no API key configured returns 200 with an empty rows array and a failureReason', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    // Deliberately no setApiKey call.
    const res = await importPhoto(page, 'receipt')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.rows).toEqual([])
    expect(body.failureReason).toMatch(/no api key configured/i)
  })

  test('an invalid kind is rejected with 400', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await setApiKey(page, 'sk-ant-test-dummy')
    const res = await page.request.post(`${API}/transactions/import-photo`, {
      data: { image: 'ZmFrZQ==', imageType: 'image/png', kind: 'invoice' },
    })
    expect(res.status()).toBe(400)
  })

  test('an unsupported imageType is rejected with 400', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await setApiKey(page, 'sk-ant-test-dummy')
    const res = await page.request.post(`${API}/transactions/import-photo`, {
      data: { image: 'ZmFrZQ==', imageType: 'image/gif', kind: 'receipt' },
    })
    expect(res.status()).toBe(400)
  })

  test('the photo-import rate limit is its own bucket, independent of the others', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await setApiKey(page, 'sk-ant-test-dummy')
    await mockPhotoAiResponse(
      page,
      JSON.stringify({ rows: [{ date: '2026-09-05', merchant: 'Shop', amount: 10, type: 'expense', categoryGuess: null }] }),
    )

    // AI_RATE_LIMIT_MAX is 20 per hour (worker/routes/wallet.ts) — the 21st
    // call in the same window must be rejected, still with a 200 + failureReason.
    let last
    for (let i = 0; i < 21; i++) {
      last = await importPhoto(page, 'receipt')
    }
    expect(last!.status()).toBe(200)
    const body = await last!.json()
    expect(body.rows).toEqual([])
    expect(body.failureReason).toMatch(/limit reached/i)

    // The composer's own AI parse bucket is untouched — proves the buckets
    // are genuinely independent, not sharing one counter.
    const composerRes = await page.request.post(`${API}/transactions/parse-composer-ai`, {
      data: { text: 'coffee 4.20' },
    })
    expect(composerRes.status()).not.toBe(429)
  })
})

// ── UI: the Photo tab and no-key gating ──────────────────────────────────

test('the Photo tab does not appear in the Import modal with no API key set', async ({ browser }) => {
  const page = await newAppPage(browser, '/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'No Key Bank', type: 'bank' })
  await page.goto('/wallet')

  await page.getByTestId('import-csv-btn').click()
  await expect(page.getByRole('dialog').filter({ hasText: 'Import transactions' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Photo' })).toHaveCount(0)
  // CSV still works with no key — the dropzone shows straight away.
  await expect(page.getByText('Drag a file here')).toBeVisible()
})

test('the Photo tab appears once an API key is set', async ({ browser }) => {
  const page = await newAppPage(browser, '/wallet/accounts')
  await setApiKey(page, 'sk-ant-test-dummy')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Key Bank', type: 'bank' })
  await page.goto('/wallet')

  await page.getByTestId('import-csv-btn').click()
  await expect(page.getByRole('tab', { name: 'Photo' })).toBeVisible()
})

// ── UI: multi-photo batch with one photo failing ─────────────────────────
//
// The browser's own call to POST /transactions/import-photo is intercepted
// directly (Playwright CAN see this one — it's a same-origin fetch the page
// itself makes, unlike the Worker->Anthropic call) so each of the two
// photos in the batch gets a different canned response: the first succeeds,
// the second comes back unreadable. Exercises the partial-failure notice
// (transactions-import-error.html) and the review table's Photo column.

test('a batch of 2 photos with one unreadable shows the partial-failure notice and imports the other', async ({ browser }) => {
  const page = await newAppPage(browser, '/wallet/accounts')
  await setApiKey(page, 'sk-ant-test-dummy')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Photo Batch Bank', type: 'bank' })
  await page.goto('/wallet')

  let callCount = 0
  await page.route('**/api/transactions/import-photo', async (route) => {
    callCount += 1
    if (callCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          rows: [{ date: '2026-09-05', merchant: 'Village Grocer', amount: 42.6, type: 'expense', categoryGuess: null }],
        }),
      })
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rows: [], failureReason: 'too blurry for Claude to read reliably' }),
      })
    }
  })

  await page.getByTestId('import-csv-btn').click()
  await expect(page.getByRole('dialog').filter({ hasText: 'Import transactions' })).toBeVisible()
  await page.getByRole('tab', { name: 'Photo' }).click()

  const fileInput = page.locator('input[type=file][accept="image/*"]')
  await fileInput.setInputFiles([PHOTO1, PHOTO2])
  await expect(page.getByText('photo1.png')).toBeVisible()
  await expect(page.getByText('photo2.png')).toBeVisible()

  await page.getByRole('button', { name: 'Extract transactions' }).click()
  await expect(page.getByRole('heading', { name: 'Review transactions' })).toBeVisible({ timeout: 15_000 })

  // Partial-failure notice names the file and doesn't block the other row.
  await expect(page.getByText(/Couldn't read 1 of 2 photos/)).toBeVisible()
  await expect(page.getByText('too blurry for Claude to read reliably')).toBeVisible()
  await expect(page.getByTestId('csv-review-row')).toHaveCount(1)
  await expect(page.getByRole('textbox', { name: /^Merchant for row/ })).toHaveValue('Village Grocer')

  // Photo column (not Description) is showing for this photo-mode review.
  await expect(page.locator('th', { hasText: 'Photo' })).toBeVisible()
  await expect(page.locator('th', { hasText: 'Description' })).toHaveCount(0)
})

test('a truncated statement photo shows the cut-off notice and still imports the rows it recovered', async ({ browser }) => {
  const page = await newAppPage(browser, '/wallet/accounts')
  await setApiKey(page, 'sk-ant-test-dummy')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Truncated Statement Bank', type: 'bank' })
  await page.goto('/wallet')

  await page.route('**/api/transactions/import-photo', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        rows: [
          { date: '2026-08-01', merchant: 'Grab', amount: 20, type: 'expense', categoryGuess: null },
          { date: '2026-08-02', merchant: 'Netflix', amount: 54.9, type: 'expense', categoryGuess: null },
        ],
        truncated: true,
      }),
    })
  })

  await page.getByTestId('import-csv-btn').click()
  await expect(page.getByRole('dialog').filter({ hasText: 'Import transactions' })).toBeVisible()
  await page.getByRole('tab', { name: 'Photo' }).click()
  await page.getByRole('tab', { name: 'Bank statement' }).click()

  const fileInput = page.locator('input[type=file][accept="image/*"]')
  await fileInput.setInputFiles([PHOTO1])
  await expect(page.getByText('photo1.png')).toBeVisible()

  await page.getByRole('button', { name: 'Extract transactions' }).click()
  await expect(page.getByRole('heading', { name: 'Review transactions' })).toBeVisible({ timeout: 15_000 })

  // Cut-off notice names the file and the recovered row count, but both rows
  // stay in the table — a truncated photo is a partial success, not a failure.
  await expect(page.getByText('1 photo was cut off partway through')).toBeVisible()
  await expect(page.getByText(/had more transactions than fit in one reply/)).toBeVisible()
  await expect(page.getByText(/2 rows were extracted below/)).toBeVisible()
  await expect(page.getByTestId('csv-review-row')).toHaveCount(2)
})
