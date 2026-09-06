/**
 * 64 — AI-assisted merchant name resolution for CSV import (docs/v1/flow-plan.md).
 *
 * Resolution ladder per row, run server-side in `resolveMerchantLadder`
 * (worker/routes/wallet.ts): regex guess -> `merchant_corrections` cache hit
 * -> the caller's own transaction history hit (case-insensitive) -> AI on the
 * raw narrative -> memoize the AI answer so the same guess resolves for free
 * next time. `POST /merchants/resolve` is the entry point; CSV import
 * (`CsvImport.tsx`) calls it for every row whose merchant was split out of a
 * single narrative column, before category suggestion runs.
 *
 * Stubbing note (same as spec 60): the Worker->api.anthropic.com call is
 * mocked via `POST /test/mock-ai-response` — this feature uses a SEPARATE
 * mock slot (`feature: 'merchants'`) so a spec exercising both AI features
 * cannot have one clobber the other (worker/lib/anthropic.ts
 * TEST_MOCK_KEY_MERCHANTS).
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { newAppPage, businessToday, accountCardFor, fillAccountForm, navigateToImportCsv, selectReviewAccount } from './helpers'

const API = '/api'
const CSV_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'narrative-unknown-merchants.csv')

async function setApiKey(page: Page, value: string) {
  const res = await page.request.put(`${API}/settings/anthropic_api_key`, { data: { value } })
  expect(res.ok()).toBeTruthy()
}

async function mockMerchantAiResponse(page: Page, text: string) {
  const res = await page.request.post(`${API}/test/mock-ai-response`, { data: { text, feature: 'merchants' } })
  expect(res.ok()).toBeTruthy()
}

// useAI defaults true here: every test in the "POST /merchants/resolve"
// describe block below is specifically exercising the ladder's AI-reaching
// behavior (Stage 3) — the same opt-in the review page's explicit "Ask AI to
// resolve merchant names" button now sends. The automatic on-import pass
// (tested separately below) omits it.
async function resolveMerchants(page: Page, items: Array<{ raw: string; guess: string }>, useAI = true) {
  return page.request.post(`${API}/merchants/resolve`, { data: { items, useAI } })
}

// ── Server contract: POST /merchants/resolve ────────────────────────────

test.describe('POST /merchants/resolve', () => {
  test('an empty items array short-circuits to an empty result', async ({ browser }: { browser: Browser }) => {
    const page = await newAppPage(browser, '/wallet')
    const res = await resolveMerchants(page, [])
    expect(res.status()).toBe(200)
    expect(await res.json()).toEqual({ resolutions: [], failedGuesses: [] })
    await page.context().close()
  })

  test('(a) a correction already cached for this guess resolves with zero AI calls', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')
    // Seed the cache the same way the ladder itself would: resolve once
    // through AI, then confirm a second, differently-cased request for the
    // same guess comes back as 'correction' with the mock left in place but
    // never consulted (the mock only fires once if it were reused).
    await setApiKey(page, 'sk-ant-test-dummy')
    await mockMerchantAiResponse(
      page,
      JSON.stringify({ resolutions: [{ guess: 'Dodo Korea', name: 'Dodo Korea Restaurant' }] }),
    )
    const first = await resolveMerchants(page, [{ raw: 'IBG FROM DODO KOREA SDN BHD', guess: 'Dodo Korea' }])
    expect(first.status()).toBe(200)
    const firstBody = (await first.json()) as { resolutions: { guess: string; name: string; source: string }[] }
    expect(firstBody.resolutions).toEqual([
      { guess: 'Dodo Korea', name: 'Dodo Korea Restaurant', source: 'ai' },
    ])

    // Clear the mock — a second call for the SAME guess (different case/
    // spacing, correctionKey-normalized) must not need it.
    await mockMerchantAiResponse(page, 'not valid json{{{')
    const second = await resolveMerchants(page, [{ raw: 'irrelevant raw text', guess: '  dodo korea  ' }])
    expect(second.status()).toBe(200)
    const secondBody = (await second.json()) as { resolutions: { guess: string; name: string; source: string }[] }
    expect(secondBody.resolutions).toEqual([
      { guess: '  dodo korea  ', name: 'Dodo Korea Restaurant', source: 'correction' },
    ])
    await page.context().close()
  })

  test('(b) a guess matching the caller\'s own transaction history (case-insensitive) resolves with zero AI calls', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, '/wallet')
    const acct = (await (
      await page.request.post(`${API}/accounts`, { data: { name: 'History Seed Acct', type: 'cash', openingBalance: 0 } })
    ).json()) as { id: string }
    await page.request.post(`${API}/transactions`, {
      data: { accountId: acct.id, date: businessToday(), merchant: 'Nasi Kandar Pelangi', amount: 9, type: 'expense' },
    })

    // No key configured at all — proves this step never reaches AI.
    const res = await resolveMerchants(page, [
      { raw: 'DUITNOW QR NASI KANDAR PELANGI ENTERPRISE', guess: 'nasi kandar pelangi' },
    ])
    expect(res.status()).toBe(200)
    const { resolutions } = (await res.json()) as { resolutions: { guess: string; name: string; source: string }[] }
    expect(resolutions).toEqual([
      { guess: 'nasi kandar pelangi', name: 'nasi kandar pelangi', source: 'history' },
    ])
    await page.context().close()
  })

  test('(c) a fresh narrative falls through to AI, and a repeat resolves from the corrections cache with the mock cleared — proving memoization', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, '/wallet')
    await setApiKey(page, 'sk-ant-test-dummy')
    await mockMerchantAiResponse(
      page,
      JSON.stringify({ resolutions: [{ guess: 'Warung Pak Cik Abu', name: 'Warung Pak Cik Abu' }] }),
    )
    const first = await resolveMerchants(page, [
      { raw: 'MEPS PAYMENT FROM WARUNG PAK CIK ABU TRADING', guess: 'Warung Pak Cik Abu' },
    ])
    const firstBody = (await first.json()) as { resolutions: { guess: string; name: string; source: string }[] }
    expect(firstBody.resolutions).toEqual([
      { guess: 'Warung Pak Cik Abu', name: 'Warung Pak Cik Abu', source: 'ai' },
    ])

    // Mock cleared to malformed JSON: if the second call reached AI again it
    // would fail. It must not — memoization means it never tries.
    await mockMerchantAiResponse(page, 'not valid json{{{')
    const second = await resolveMerchants(page, [
      { raw: 'MEPS PAYMENT FROM WARUNG PAK CIK ABU TRADING', guess: 'Warung Pak Cik Abu' },
    ])
    const secondBody = (await second.json()) as { resolutions: { guess: string; name: string; source: string }[] }
    expect(secondBody.resolutions).toEqual([
      { guess: 'Warung Pak Cik Abu', name: 'Warung Pak Cik Abu', source: 'correction' },
    ])
    await page.context().close()
  })

  test('(d) an AI failure is reported in failedGuesses/failureReason, never silently dropped', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')
    await setApiKey(page, 'sk-ant-test-dummy')
    // No mock stashed at all -> fetchTestText throws "no AI mock configured".
    const res = await resolveMerchants(page, [{ raw: 'SOME UNMOCKED NARRATIVE', guess: 'Some Unmocked' }])
    expect(res.status()).toBe(200)
    const body = (await res.json()) as { resolutions: unknown[]; failedGuesses: string[]; failureReason?: string }
    expect(body.resolutions).toHaveLength(0)
    expect(body.failedGuesses).toEqual(['Some Unmocked'])
    expect(body.failureReason).toBeTruthy()
    await page.context().close()
  })

  test('(e) no API key configured: unresolved guesses reported with a reason naming the missing key, zero AI calls', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, '/wallet')
    const res = await resolveMerchants(page, [{ raw: 'NO KEY NARRATIVE', guess: 'No Key Merchant' }])
    expect(res.status()).toBe(200)
    const body = (await res.json()) as { resolutions: unknown[]; failedGuesses: string[]; failureReason?: string }
    expect(body.resolutions).toHaveLength(0)
    expect(body.failedGuesses).toEqual(['No Key Merchant'])
    expect(body.failureReason).toContain('API key')
    await page.context().close()
  })

  test('(f) a guess the builtin category map recognises resolves for free — no key, no AI call, not reported as failed', async ({
    browser,
  }) => {
    // Regression: category suggestion (a separate system, worker/lib/merchant-map.ts)
    // confidently tags GUARDIAN "Personal Care · common merchant" regardless of
    // whether this ladder has ever confirmed the name — before this stage
    // existed, the exact same guess was simultaneously marked "couldn't be
    // cleaned up automatically" in the review table, which read as a
    // contradiction to the user. A builtin-map hit is independent confirmation
    // the guess already IS a real name, so it must resolve here too, with zero
    // AI spend (no key set at all in this test).
    const page = await newAppPage(browser, '/wallet')
    const res = await resolveMerchants(page, [
      { raw: 'IBG FROM GUARDIAN HEALTH AND BEAUTY SDN BHD REF 552013', guess: 'Guardian Health And Beauty' },
    ])
    expect(res.status()).toBe(200)
    const body = (await res.json()) as { resolutions: { guess: string; name: string; source: string }[]; failedGuesses: string[] }
    expect(body.resolutions).toEqual([
      { guess: 'Guardian Health And Beauty', name: 'Guardian Health And Beauty', source: 'builtin' },
    ])
    expect(body.failedGuesses).toEqual([])
    await page.context().close()
  })

  test('duplicate guesses within one request are deduplicated before any AI call', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')
    await setApiKey(page, 'sk-ant-test-dummy')
    await mockMerchantAiResponse(
      page,
      JSON.stringify({ resolutions: [{ guess: 'Repeat Merchant', name: 'Repeat Merchant Clean' }] }),
    )
    const res = await resolveMerchants(page, [
      { raw: 'raw one', guess: 'Repeat Merchant' },
      { raw: 'raw two', guess: 'Repeat Merchant' },
      { raw: 'raw three', guess: 'repeat merchant' },
    ])
    const { resolutions } = (await res.json()) as { resolutions: { guess: string; name: string; source: string }[] }
    expect(resolutions).toHaveLength(3)
    expect(resolutions.every((r) => r.name === 'Repeat Merchant Clean' && r.source === 'ai')).toBe(true)
    await page.context().close()
  })

  test('the merchant-mock slot is separate from the category-suggestion mock slot', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')
    await setApiKey(page, 'sk-ant-test-dummy')
    // Stash a category-suggestion mock only (default feature) — the merchant
    // slot stays unset, so this request must fail with "no AI mock configured",
    // not accidentally succeed by reading the other feature's slot.
    await page.request.post(`${API}/test/mock-ai-response`, { data: { text: JSON.stringify({ suggestions: [] }) } })
    const res = await resolveMerchants(page, [{ raw: 'CROSS SLOT CHECK', guess: 'Cross Slot Check' }])
    const body = (await res.json()) as { resolutions: unknown[]; failedGuesses: string[] }
    expect(body.resolutions).toHaveLength(0)
    expect(body.failedGuesses).toEqual(['Cross Slot Check'])
    await page.context().close()
  })
})

// ── UI flow: CSV import round-trips through the ladder ──────────────────

test.describe('CSV import: merchant AI resolution', () => {
  test('the automatic pass never reaches AI; the explicit "Ask AI" button resolves what rules could not', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Merchant AI Import Acct', type: 'bank' })
    await expect(accountCardFor(page, 'Merchant AI Import Acct')).toBeVisible()

    await setApiKey(page, 'sk-ant-test-dummy')
    // hasAnthropicKey is read once at app load and cached in app.store — a
    // key set afterwards via a raw API call needs a reload to be picked up
    // (see 59-merchant-suggestions.spec.ts's identical note).
    await page.reload()
    // Left in place for the WHOLE test but must not be consulted until the
    // explicit button click — proving the automatic on-import pass is
    // rules-only (corrections cache + own history), never AI.
    await mockMerchantAiResponse(
      page,
      JSON.stringify({
        resolutions: [
          { guess: 'Dodo Korea', name: 'Dodo Korea Restaurant' },
          { guess: 'Nasi Kandar Pelangi', name: 'Nasi Kandar Pelangi' },
        ],
      }),
    )

    await navigateToImportCsv(page)

    const csvContent = await import('node:fs/promises').then((fs) => fs.readFile(CSV_PATH, 'utf-8'))
    await page.evaluate(async (content) => {
      const file = new File([content], 'narrative-unknown-merchants.csv', { type: 'text/csv' })
      await window.__testCsvFileSelect(file)
    }, csvContent)
    await expect(page.getByText('rows detected')).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: 'Review rows' }).click()
    await expect(page.getByRole('heading', { name: 'Review transactions' })).toBeVisible({ timeout: 10_000 })

    // Account is picked on the review page (shared by both import types).
    await selectReviewAccount(page, 'Merchant AI Import Acct')

    // A fresh account with no history and no cached corrections: the free
    // rules pass resolves nothing, so all 3 rows are marked unresolved and
    // the banner offers the explicit button — no toast, this is a normal
    // outcome, not a failure.
    await expect(page.getByTestId('csv-merchant-banner')).toContainText('3 rows still need merchant cleanup')
    const merchantInputsBefore = page.getByRole('textbox', { name: /^Merchant for row/ })
    await expect(merchantInputsBefore).toHaveCount(3)
    await expect(page.getByText('Merchant name not resolved automatically').first()).toBeVisible()

    // Explicit click reaches AI: 2 of the 3 resolve, 1 stays marked.
    await page.getByTestId('csv-ask-ai-merchants').click()
    await expect(page.getByTestId('csv-merchant-ai-message')).toContainText('Cleaned up 2 of 3 merchant names')

    const merchantInputs = page.getByRole('textbox', { name: /^Merchant for row/ })
    const values = await merchantInputs.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))
    expect(values).toContain('Dodo Korea Restaurant')
    expect(values).toContain('Nasi Kandar Pelangi')

    // The unresolved row keeps its regex guess and is still visually marked.
    await expect(page.getByText('Merchant name not resolved automatically')).toBeVisible()

    await page.context().close()
  })
})
