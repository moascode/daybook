/**
 * 80 — Capture ↔ CSV duplicate reconciliation (R18 PR-5,
 * docs/archive/design-adoption/feature-capture-inbox.md §5.3).
 *
 * Capture can only ever OVERLAY the bank statement, never replace it — Apple
 * Pay sees only what you tap with the phone, so cash, transfers, standing
 * instructions and card swipes still arrive by CSV. That makes "the same
 * payment reaching the app twice" the normal case, not an edge, and these two
 * gaps the difference between a correct ledger and a Friday coffee counted
 * twice.
 */

import { test, expect, request as playwrightRequest } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { newAppPage, businessToday, businessDatePlus } from './helpers'

const API = '/api'

let seq = 0
const key = () => `dup-${Date.now()}-${seq++}`

async function setup(browser: Parameters<typeof newAppPage>[0], baseURL: string | undefined) {
  const page = await newAppPage(browser)
  const created = await page.request.post(`${API}/accounts`, { data: { name: 'Everyday', type: 'bank' } })
  const account = await created.json()
  const tok = await page.request.post(`${API}/capture-tokens`, { data: { label: 'Dup spec' } })
  const token = (await tok.json()).token
  const anon = await playwrightRequest.newContext({ baseURL })
  return { page, token, anon, accountId: account.id as string }
}

function capture(anon: APIRequestContext, token: string, data: Record<string, unknown>) {
  return anon.post(`${API}/capture/transaction`, {
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': key() },
    data,
  })
}

/** The check an import runs before showing the review table. */
function checkDuplicates(page: Page, items: Record<string, unknown>[]) {
  return page.request.post(`${API}/transactions/check-duplicates`, { data: { items } })
}

test.describe('capture duplicate reconciliation', () => {
  test('gap 1: an import row matching a WAITING capture is flagged, not excluded', async ({ browser, baseURL }) => {
    const { page, token, anon } = await setup(browser, baseURL)
    const date = businessToday()
    await capture(anon, token, { merchant: 'Starbucks', amount: 18.9, occurredAt: date })

    const res = await checkDuplicates(page, [
      // The bank's own narrative. canonicalMerchant folds the outlet suffix
      // off at the separator, so this and "Starbucks" share a duplicate_key.
      { hash: 'csv-hash-1', date, amount: 18.9, merchant: 'STARBUCKS - KLCC', type: 'expense' },
    ])
    const body = await res.json()

    // Not a duplicate: the LEDGER does not have it. Auto-excluding could lose
    // the payment entirely if the capture is never accepted.
    expect(body.duplicateHashes).toEqual([])
    expect(body.pendingCaptureMatches['csv-hash-1']).toHaveLength(1)
    expect(body.pendingCaptureMatches['csv-hash-1'][0].merchant).toBe('Starbucks')

    await anon.dispose()
  })

  test('gap 1 reverse: a capture whose payment is already banked arrives pre-excluded', async ({ browser, baseURL }) => {
    const { page, token, anon, accountId } = await setup(browser, baseURL)
    const date = businessToday()

    // The bank statement got imported first.
    await page.request.post(`${API}/transactions`, {
      data: { accountId, date, merchant: 'STARBUCKS - KLCC', amount: 18.9, type: 'expense' },
    })
    // …then the phone's capture for the same payment shows up, under Apple's
    // clean name rather than the bank's narrative.
    await capture(anon, token, { merchant: 'Starbucks', amount: 18.9, occurredAt: date })

    const inbox = await (await page.request.get(`${API}/captures`)).json()
    expect(inbox).toHaveLength(1)
    expect(Number(inbox[0].already_in_ledger)).toBe(1)

    await page.goto('/wallet/inbox')
    await expect(page.getByTestId('csv-review-row').getByText('Duplicate')).toBeVisible()
    // Pre-excluded, so the action bar offers nothing to accept by default.
    await expect(page.getByTestId('capture-action-bar')).toHaveCount(0)

    await anon.dispose()
  })

  test('gap 2: a bank row posting 2 days after a captured payment is surfaced', async ({ browser, baseURL }) => {
    const { page, token, anon } = await setup(browser, baseURL)
    const paid = businessToday()
    const posted = businessDatePlus(2)

    await capture(anon, token, { merchant: 'Kopitiam', amount: 23.5, occurredAt: paid })
    // Accept it, so it becomes a capture-created ledger row.
    const inbox = await (await page.request.get(`${API}/captures`)).json()
    const accounts = await (await page.request.get(`${API}/accounts`)).json()
    const accepted = await page.request.post(`${API}/captures/accept`, {
      data: {
        rows: [{
          id: inbox[0].id, accountId: accounts[0].id, destinationAccountId: null,
          date: paid, merchant: 'Kopitiam', description: '', amount: 23.5,
          type: 'expense', categoryId: null,
        }],
      },
    })
    expect(accepted.status()).toBe(201)

    // The statement carries the POSTING date, two days later, and the bank's
    // own narrative — so neither the hash nor the canonical key matches.
    const res = await checkDuplicates(page, [
      { hash: 'csv-hash-2', date: posted, amount: 23.5, merchant: 'KOPITIAM SDN BHD 4471', type: 'expense' },
    ])
    const body = await res.json()
    expect(body.duplicateHashes).toEqual([])
    const candidates = body.possibleDuplicates['csv-hash-2']
    expect(candidates, 'the captured row should be offered as a candidate').toHaveLength(1)
    expect(candidates[0].merchant).toBe('Kopitiam')
    expect(candidates[0].fromCapture).toBe(true)

    await anon.dispose()
  })

  test('gap 2 stays quiet: two ordinary same-amount rows days apart are NOT flagged', async ({ browser, baseURL }) => {
    const { page, anon, accountId } = await setup(browser, baseURL)
    const first = businessToday()

    // A normal manual/CSV transaction — nothing to do with capture.
    await page.request.post(`${API}/transactions`, {
      data: { accountId, date: first, merchant: 'Grab', amount: 12, type: 'expense' },
    })

    // Three days later, another RM12 Grab ride. Ordinary life, not a duplicate.
    const res = await checkDuplicates(page, [
      { hash: 'csv-hash-3', date: businessDatePlus(3), amount: 12, merchant: 'Grab', type: 'expense' },
    ])
    const body = await res.json()
    expect(body.duplicateHashes).toEqual([])
    expect(body.possibleDuplicates['csv-hash-3']).toBeUndefined()

    await anon.dispose()
  })

  test('same-date exact-key matching still auto-excludes', async ({ browser, baseURL }) => {
    const { page, anon, accountId } = await setup(browser, baseURL)
    const date = businessToday()
    await page.request.post(`${API}/transactions`, {
      data: { accountId, date, merchant: 'Village Grocer', amount: 55, type: 'expense' },
    })

    const res = await checkDuplicates(page, [
      { hash: 'csv-hash-4', date, amount: 55, merchant: 'VILLAGE GROCER', type: 'expense' },
    ])
    expect((await res.json()).duplicateHashes).toEqual(['csv-hash-4'])
    await anon.dispose()
  })

  // ── Fuzzy pairs: the bank's narrative never folds to Apple's clean name ──
  // "SHELL - NILAI MASYHUR MUKIM PETALIN MY" and "NILAI MASYHUR SDN BHD" are
  // the same RM167.09 fill-up, but share no duplicate_key — the exact layers
  // above miss them in both directions. Real pairs from production.

  test('inbox: a capture whose payment the statement already brought in (other name) is hinted, not excluded', async ({ browser, baseURL }) => {
    const { page, token, anon, accountId } = await setup(browser, baseURL)
    const paid = businessToday()
    await page.request.post(`${API}/transactions`, {
      data: { accountId, date: businessDatePlus(2), merchant: 'SHELL - NILAI MASYHUR MUKIM PETALIN MY', amount: 167.09, type: 'expense' },
    })
    await capture(anon, token, { merchant: 'NILAI MASYHUR SDN BHD', amount: 167.09, occurredAt: paid })

    const inbox = await (await page.request.get(`${API}/captures`)).json()
    expect(Number(inbox[0].already_in_ledger)).toBe(0)
    expect(inbox[0].possible_matches).toHaveLength(1)
    expect(inbox[0].possible_matches[0].merchant).toBe('SHELL - NILAI MASYHUR MUKIM PETALIN MY')

    await page.goto('/wallet/inbox')
    const hint = page.getByTestId('csv-possible-duplicate')
    await expect(hint).toBeVisible()
    await expect(hint).toContainText('Already recorded?')
    // A hint, not a verdict: the row stays ticked, so Accept is still offered.
    await expect(page.getByTestId('capture-action-bar')).toBeVisible()

    await anon.dispose()
  })

  test('inbox stays quiet: two captured same-amount payments on consecutive days are NOT hinted', async ({ browser, baseURL }) => {
    const { page, token, anon, accountId } = await setup(browser, baseURL)
    const first = businessToday()
    await capture(anon, token, { merchant: 'Grab', amount: 12, occurredAt: first })
    const [pending] = await (await page.request.get(`${API}/captures`)).json()
    const accepted = await page.request.post(`${API}/captures/accept`, {
      data: {
        rows: [{
          id: pending.id, accountId, destinationAccountId: null,
          date: first, merchant: 'Grab', description: '', amount: 12,
          type: 'expense', categoryId: null,
        }],
      },
    })
    expect(accepted.status()).toBe(201)

    // Next day's ride, captured the same way under a different string.
    await capture(anon, token, { merchant: 'Grab Rides', amount: 12, occurredAt: businessDatePlus(1) })
    const inbox = await (await page.request.get(`${API}/captures`)).json()
    expect(inbox).toHaveLength(1)
    expect(inbox[0].possible_matches).toEqual([])

    await anon.dispose()
  })

  test('import: a statement row matching a WAITING capture under another name is flagged', async ({ browser, baseURL }) => {
    const { page, token, anon } = await setup(browser, baseURL)
    await capture(anon, token, { merchant: 'NILAI MASYHUR SDN BHD', amount: 167.09, occurredAt: businessToday() })

    const res = await checkDuplicates(page, [
      { hash: 'csv-hash-5', date: businessDatePlus(2), amount: 167.09, merchant: 'SHELL - NILAI MASYHUR MUKIM PETALIN MY', type: 'expense' },
    ])
    const body = await res.json()
    expect(body.duplicateHashes).toEqual([])
    expect(body.pendingCaptureMatches['csv-hash-5']).toHaveLength(1)
    expect(body.pendingCaptureMatches['csv-hash-5'][0].merchant).toBe('NILAI MASYHUR SDN BHD')

    await anon.dispose()
  })
})
