/**
 * 60 — AI fallback for bulk categorisation (docs/ai-bulk-categorize-feature.md).
 *
 * For the transactions the rule-based suggest-categories pass has nothing for,
 * the bulk edit dialog can ask Claude — only for that leftover, never the
 * whole selection.
 *
 * Stubbing note: Playwright intercepts requests the BROWSER makes. The call
 * this feature adds goes Worker -> api.anthropic.com, from a separate
 * `wrangler dev` process the test has no route into. worker/lib/anthropic.ts
 * therefore reads a canned response from the `settings` table instead of
 * hitting the network whenever DAYBOOK_TEST=1 (always true under this
 * harness) — POST /test/mock-ai-response stashes it. Production never sets
 * DAYBOOK_TEST, so that branch cannot run there.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, businessToday } from './helpers'

const API = 'http://localhost:5173/api'

async function categoryIdByName(page: Page, name: string): Promise<string> {
  const cats = (await (await page.request.get(`${API}/categories`)).json()) as { id: string; name: string }[]
  return cats.find((c) => c.name === name)!.id
}

async function setApiKey(page: Page, value: string) {
  const res = await page.request.put(`${API}/settings/anthropic_api_key`, { data: { value } })
  expect(res.ok()).toBeTruthy()
}

async function mockAiResponse(page: Page, text: string) {
  const res = await page.request.post(`${API}/test/mock-ai-response`, { data: { text } })
  expect(res.ok()).toBeTruthy()
}

async function askAi(page: Page, merchants: string[]) {
  return page.request.post(`${API}/transactions/suggest-categories-ai`, { data: { merchants } })
}

// ── Server contract ────────────────────────────────────────────────────

test.describe('POST /transactions/suggest-categories-ai', () => {
  test('400 without a key configured', async ({ browser }: { browser: Browser }) => {
    const page = await newAppPage(browser, '/wallet')
    const res = await askAi(page, ['SOME MERCHANT'])
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toContain('no API key configured')
    await page.context().close()
  })

  // 200 raw strings that canonicalise to a handful of merchants: well past the
  // old raw-count cap of 100, and accepted now that the ceiling is measured
  // after canonicalisation. This is the shape a real select-all takes — one
  // merchant, a different reference number on every row.
  test('hundreds of raw strings are accepted when they canonicalise to few merchants', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, '/wallet')
    await setApiKey(page, 'sk-ant-test-dummy')
    await mockAiResponse(page, JSON.stringify({ suggestions: [] }))

    const merchants = Array.from({ length: 200 }, (_, i) => `GRAB RIDE ${i}`)
    const res = await askAi(page, merchants)
    expect(res.status()).toBe(200)
    const bodyJson = (await res.json()) as { askedMerchants: number; failedMerchants: number }
    expect(bodyJson.failedMerchants).toBe(0)
    // Deduped before any tokens are spent — fewer questions than rows.
    expect(bodyJson.askedMerchants).toBeLessThan(200)
    // …and still past the old raw-count cap of 100, which this request would
    // have been rejected by. That rejection is what the client swallowed.
    expect(bodyJson.askedMerchants).toBeGreaterThan(100)
    await page.context().close()
  })

  test('past the ceiling the caller is told the number, not silently ignored', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')
    await setApiKey(page, 'sk-ant-test-dummy')
    // Letter suffixes, not numeric ones: canonicalMerchant strips a trailing
    // run of 3+ digits, so `MERCHANT 500` folds into `MERCHANT` and 501 names
    // would arrive as a handful of merchants.
    const merchants = Array.from({ length: 501 }, (_, i) => {
      const a = String.fromCharCode(65 + Math.floor(i / 676))
      const b = String.fromCharCode(65 + (Math.floor(i / 26) % 26))
      const cc = String.fromCharCode(65 + (i % 26))
      return `MERCHANT ${a}${b}${cc}`
    })
    const res = await askAi(page, merchants)
    expect(res.status()).toBe(400)
    const { error } = (await res.json()) as { error: string }
    expect(error).toContain('501 distinct merchants')
    expect(error).toContain('500')
    await page.context().close()
  })

  test('an empty merchants array short-circuits to an empty result, key or not', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')
    const res = await askAi(page, [])
    expect(res.status()).toBe(200)
    expect(await res.json()).toEqual({ suggestions: [], askedMerchants: 0, failedMerchants: 0 })
    await page.context().close()
  })

  // A failed call is REPORTED, not swallowed: failedMerchants is what lets the
  // dialog say "could not reach Claude" instead of showing an empty panel that
  // looks identical to "no confident suggestion".
  test('an unreachable model is reported as failed merchants, not as an empty result', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, '/wallet')
    await setApiKey(page, 'sk-ant-test-dummy')
    const res = await askAi(page, ['UNMOCKED MERCHANT'])
    expect(res.status()).toBe(200)
    const bodyJson = (await res.json()) as {
      suggestions: unknown[]
      askedMerchants: number
      failedMerchants: number
    }
    expect(bodyJson.suggestions).toHaveLength(0)
    expect(bodyJson.askedMerchants).toBe(1)
    expect(bodyJson.failedMerchants).toBe(1)
    await page.context().close()
  })

  test('malformed JSON from the model is reported as a failure, not as no suggestions', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, '/wallet')
    await setApiKey(page, 'sk-ant-test-dummy')
    await mockAiResponse(page, 'not valid json{{{')
    const res = await askAi(page, ['ANY MERCHANT'])
    expect(res.status()).toBe(200)
    const bodyJson = (await res.json()) as { failedMerchants: number; suggestions: unknown[] }
    expect(bodyJson.suggestions).toHaveLength(0)
    expect(bodyJson.failedMerchants).toBe(1)
    await page.context().close()
  })

  test('an invented category name is dropped; a merchant not requested is dropped', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')
    await setApiKey(page, 'sk-ant-test-dummy')
    const foodDrink = await categoryIdByName(page, 'Food & Drink')

    await mockAiResponse(
      page,
      JSON.stringify({
        suggestions: [
          { merchant: 'GOODMERCHANT', category: 'Food & Drink' },
          { merchant: 'BADCATMERCHANT', category: 'Not A Real Category' },
          { merchant: 'UNASKEDMERCHANT', category: 'Food & Drink' },
        ],
      }),
    )

    const res = await askAi(page, ['GOODMERCHANT', 'BADCATMERCHANT'])
    expect(res.status()).toBe(200)
    const { suggestions } = (await res.json()) as { suggestions: { raw: string; categoryId: string; matchCount: number }[] }
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]).toMatchObject({ raw: 'GOODMERCHANT', categoryId: foodDrink, matchCount: -1, totalCount: 0 })
    await page.context().close()
  })

  test('rate limit trips after the configured number of calls', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')
    await setApiKey(page, 'sk-ant-test-dummy')
    await mockAiResponse(page, JSON.stringify({ suggestions: [] }))

    let last: Awaited<ReturnType<typeof askAi>> | undefined
    for (let i = 0; i < 21; i++) {
      last = await askAi(page, [`RATE LIMIT MERCHANT ${i}`])
    }
    expect(last!.status()).toBe(429)
    // The message names the cap — a 429 the user cannot see is the same dead
    // button as any other silent failure.
    expect((await last!.json()).error).toContain('20 per hour')
    await page.context().close()
  })
})

test.describe('settings: anthropic_api_key', () => {
  test('unset by default, masked to a presence flag once set, clears back to absent', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')

    async function keyRow(): Promise<{ key: string; value: string } | undefined> {
      const rows = (await (await page.request.get(`${API}/settings`)).json()) as { key: string; value: string }[]
      return rows.find((r) => r.key === 'anthropic_api_key')
    }

    expect(await keyRow()).toBeUndefined()

    await setApiKey(page, 'sk-ant-super-secret-value')
    const row = await keyRow()
    expect(row?.value).toBe('set')
    expect(row?.value).not.toContain('secret')

    await setApiKey(page, '')
    expect((await keyRow())?.value).toBe('')

    await page.context().close()
  })

  test('internal bookkeeping keys are neither writable nor readable through the settings API', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')
    await setApiKey(page, 'sk-ant-test-dummy')
    await mockAiResponse(page, JSON.stringify({ suggestions: [] }))
    await askAi(page, ['TRIGGER RATE LIMIT ROW']) // makes an ai_rate_limit_* row exist

    const rows = (await (await page.request.get(`${API}/settings`)).json()) as { key: string }[]
    expect(rows.some((r) => r.key.startsWith('ai_rate_limit_'))).toBe(false)
    expect(rows.some((r) => r.key.startsWith('_test_'))).toBe(false)

    const res = await page.request.put(`${API}/settings/ai_rate_limit_suggest_categories`, { data: { value: '{}' } })
    expect(res.status()).toBe(400)

    await page.context().close()
  })

  // The quota exists to cap spend. A request rejected before any token is
  // spent must not cost a slot, or a user with no key configured could burn
  // their whole hour on 400s.
  test('a request rejected before spending anything does not consume quota', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')

    for (let i = 0; i < 25; i++) {
      const res = await askAi(page, [`NO KEY MERCHANT ${i}`])
      expect(res.status()).toBe(400)
    }

    // Quota untouched: the very next call, once a key exists, still succeeds.
    await setApiKey(page, 'sk-ant-test-dummy')
    await mockAiResponse(page, JSON.stringify({ suggestions: [] }))
    const res = await askAi(page, ['FIRST REAL CALL'])
    expect(res.status()).toBe(200)

    await page.context().close()
  })
})

// ── UI flow ────────────────────────────────────────────────────────────

test.describe('bulk edit dialog: Ask AI', () => {
  async function seed(page: Page, merchant: string, type: 'expense' | 'income' = 'expense') {
    const acct = (await (await page.request.post(`${API}/accounts`, {
      data: { name: 'AI Bulk Acct', type: 'cash', openingBalance: 0 },
    })).json()) as { id: string }
    await page.request.post(`${API}/transactions`, {
      data: { accountId: acct.id, date: businessToday(), merchant, amount: 12, type },
    })
  }

  async function openBulkEditOnRow(page: Page, merchant: string) {
    await expect(page.getByText(merchant)).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Select transactions' }).click()
    await page.getByRole('button', { name: `Select transaction ${merchant}` }).click()
    await page.getByTestId('bulk-edit-btn').click()
  }

  test('no key set: no button, a link to Settings instead', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')
    await seed(page, 'NOKEY MERCHANT')
    await page.reload()
    await openBulkEditOnRow(page, 'NOKEY MERCHANT')

    const suggestions = page.getByTestId('bulk-edit-suggestions')
    await expect(suggestions).toContainText('no suggestion')
    await expect(suggestions.getByRole('link', { name: /Anthropic API key in Settings/ })).toBeVisible()
    await expect(page.getByTestId('bulk-edit-ask-ai')).not.toBeVisible()

    await page.context().close()
  })

  test('key set: clicking Ask AI merges a suggestion in, marked as AI-sourced, and it applies', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')
    await setApiKey(page, 'sk-ant-test-dummy')
    await seed(page, 'ASKAI MERCHANT')
    await mockAiResponse(page, JSON.stringify({ suggestions: [{ merchant: 'ASKAI MERCHANT', category: 'Shopping' }] }))

    await page.reload()
    await openBulkEditOnRow(page, 'ASKAI MERCHANT')

    const suggestions = page.getByTestId('bulk-edit-suggestions')
    await expect(suggestions).toContainText('1 transaction has no suggestion')
    const askButton = page.getByTestId('bulk-edit-ask-ai')
    await expect(askButton).toContainText('Ask AI for the remaining 1')

    await askButton.click()
    await expect(suggestions).toContainText('suggested by AI')
    await expect(suggestions).toContainText('Shopping')

    await page.getByTestId('bulk-edit-apply-suggestions').click()
    await expect(page.getByText('Updated 1 transaction')).toBeVisible({ timeout: 10_000 })

    const row = page.locator('[data-testid="transaction-row"]').filter({ hasText: 'ASKAI MERCHANT' })
    await expect(row).toContainText('Shopping')

    await page.context().close()
  })

  // docs/ai-bulk-categorize-feature.md §6 PR3. The guard is shared with the
  // rule-based path (suggestionFitsType), but nothing pinned it for AI
  // suggestions, which are merged into suggestionGroups at a different point.
  test('an expense category suggested by AI never lands on a money-in row', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')
    await setApiKey(page, 'sk-ant-test-dummy')
    await seed(page, 'REFUND MERCHANT', 'income')
    // 'Food & Drink' is a seeded EXPENSE category — inapplicable to income.
    await mockAiResponse(
      page,
      JSON.stringify({ suggestions: [{ merchant: 'REFUND MERCHANT', category: 'Food & Drink' }] }),
    )

    await page.reload()
    await openBulkEditOnRow(page, 'REFUND MERCHANT')

    const suggestions = page.getByTestId('bulk-edit-suggestions')
    await page.getByTestId('bulk-edit-ask-ai').click()

    // The suggestion is dropped, so the row stays uncategorised and no
    // Apply button appears for it.
    await expect(suggestions).toContainText('1 transaction has no suggestion')
    await expect(suggestions).not.toContainText('Food & Drink')
    await expect(page.getByTestId('bulk-edit-apply-suggestions')).not.toBeVisible()

    await page.context().close()
  })

  test('a failed AI call says so instead of leaving the button looking dead', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')
    await setApiKey(page, 'sk-ant-test-dummy')
    await seed(page, 'FAILING MERCHANT')
    await mockAiResponse(page, 'not valid json{{{')

    await page.reload()
    await openBulkEditOnRow(page, 'FAILING MERCHANT')
    await page.getByTestId('bulk-edit-ask-ai').click()

    await expect(page.getByTestId('bulk-edit-suggestion-message')).toContainText(
      'Could not reach Claude',
    )
    await page.context().close()
  })

  test('an AI call with no confident answer says that too, rather than nothing', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')
    await setApiKey(page, 'sk-ant-test-dummy')
    await seed(page, 'UNKNOWABLE MERCHANT')
    await mockAiResponse(page, JSON.stringify({ suggestions: [] }))

    await page.reload()
    await openBulkEditOnRow(page, 'UNKNOWABLE MERCHANT')
    await page.getByTestId('bulk-edit-ask-ai').click()

    await expect(page.getByTestId('bulk-edit-suggestion-message')).toContainText(
      'no confident suggestion',
    )
    await page.context().close()
  })
})

// ── Settings page ──────────────────────────────────────────────────────

test.describe('Settings page: AI categorisation section', () => {
  test('save shows Clear and hides the raw value; clear removes it', async ({ browser }) => {
    const page = await newAppPage(browser, '/settings')

    await expect(page.getByTestId('anthropic-api-key-input')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('anthropic-api-key-clear')).not.toBeVisible()

    await page.getByTestId('anthropic-api-key-input').fill('sk-ant-from-the-ui')
    await page.getByTestId('anthropic-api-key-save').click()
    await expect(page.getByText('API key saved.')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('anthropic-api-key-clear')).toBeVisible()
    // The field clears after a successful save — the value never lingers in the DOM.
    await expect(page.getByTestId('anthropic-api-key-input')).toHaveValue('')

    await page.getByTestId('anthropic-api-key-clear').click()
    await expect(page.getByText('API key removed.')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('anthropic-api-key-clear')).not.toBeVisible()

    await page.context().close()
  })

  test('saving an empty value is rejected client-side', async ({ browser }) => {
    const page = await newAppPage(browser, '/settings')
    await expect(page.getByTestId('anthropic-api-key-input')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('anthropic-api-key-save').click()
    await expect(page.getByTestId('anthropic-api-key-error')).toBeVisible()
    await page.context().close()
  })
})
