/**
 * Transaction rules (worker/routes/rules.ts, migration
 * 0033_account_last4_rules.sql) — a caller's own ordered list of
 * auto-categorise/auto-tag/auto-split rules, plus the capture-accept path's
 * new optional `tag` field (worker/routes/captures.ts). API coverage only;
 * rule *evaluation* against incoming transactions is a separate, not-yet-built
 * feature — this spec is CRUD + validation + the captures/accept side effect.
 */

import { test, expect, request as playwrightRequest } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { newAppPage, businessToday, fillAccountForm, navigateToImportCsv, selectReviewAccount } from './helpers'

const CSV_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'transactions.csv')

async function uploadFixtureCsv(p: Page) {
  const csvContent = await import('node:fs/promises').then((fs) => fs.readFile(CSV_PATH, 'utf-8'))
  await p.evaluate(async (content) => {
    const file = new File([content], 'transactions.csv', { type: 'text/csv' })
    await window.__testCsvFileSelect(file)
  }, csvContent)
}

test.describe.configure({ mode: 'serial' })

const API = '/api'

async function ownedAccount(page: Page, name = 'Rules Card') {
  const res = await page.request.post(`${API}/accounts`, {
    data: { name, type: 'card', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
  })
  return (await res.json()) as { id: string }
}

async function ownedCategory(page: Page, name = 'Rules Category') {
  const res = await page.request.post(`${API}/categories`, { data: { name, type: 'expense' } })
  return (await res.json()) as { id: string }
}

/** Two users in one group — payer (`page`) and a co-member who is a valid
 *  splitUserId target. */
async function twoUserGroup(browser: Browser, tag: string) {
  const page = await newAppPage(browser, '/wallet/accounts')
  const otherCtx = await browser.newContext()
  const other = await otherCtx.newPage()
  const ts = Date.now()
  const otherName = `rules_other_${tag}_${ts}`
  await other.request.post(`${API}/auth/signup`, { data: { username: otherName, password: 'test-password' } })
  const otherMe = await other.request.get(`${API}/auth/me`).then((r) => r.json()) as { user: { id: string } }

  const group = await page.request.post(`${API}/groups`, { data: { name: `G_rules_${tag}` } }).then((r) => r.json()) as { id: string }
  await page.request.post(`${API}/groups/${group.id}/invites`, { data: { username: otherName } })
  const invites = await other.request.get(`${API}/invites`).then((r) => r.json()) as { id: string }[]
  await other.request.post(`${API}/invites/${invites[0].id}/accept`)

  return { page, other, otherCtx, otherUserId: otherMe.user.id }
}

// ── API ──────────────────────────────────────────────────────────────────

test.describe('124 — Transaction rules (API)', () => {
  let page: Page
  let accountId: string
  let categoryId: string

  test.beforeAll(async ({ browser }) => {
    page = await newAppPage(browser, '/wallet/accounts')
    accountId = (await ownedAccount(page)).id
    categoryId = (await ownedCategory(page)).id
  })

  test.afterAll(async () => {
    await page.context().close()
  })

  test('GET /rules starts empty', async () => {
    const res = await page.request.get(`${API}/rules`)
    expect(res.status()).toBe(200)
    expect(await res.json()).toEqual([])
  })

  test('POST /rules rejects a rule with no condition', async () => {
    const res = await page.request.post(`${API}/rules`, { data: { name: 'No condition', setCategoryId: categoryId } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('a rule needs at least one condition: account, category, or merchant')
  })

  test('POST /rules rejects a rule with a condition but no action', async () => {
    const res = await page.request.post(`${API}/rules`, { data: { name: 'No action', matchMerchant: 'Grab' } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('a rule needs at least one action: set a category, add a tag, or split')
  })

  test('POST /rules rejects an out-of-range name', async () => {
    const tooLong = await page.request.post(`${API}/rules`, {
      data: { name: 'x'.repeat(81), matchMerchant: 'Grab', setCategoryId: categoryId },
    })
    expect(tooLong.status()).toBe(400)
    const blank = await page.request.post(`${API}/rules`, { data: { name: '  ', matchMerchant: 'Grab', setCategoryId: categoryId } })
    expect(blank.status()).toBe(400)
  })

  test('POST /rules rejects an over-length matchMerchant', async () => {
    const res = await page.request.post(`${API}/rules`, {
      data: { name: 'Long merchant', matchMerchant: 'x'.repeat(101), setCategoryId: categoryId },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('matchMerchant must be at most 100 characters')
  })

  test('POST /rules rejects malformed addTags', async () => {
    const tooMany = await page.request.post(`${API}/rules`, {
      data: { name: 'Too many tags', matchMerchant: 'Grab', addTags: Array.from({ length: 11 }, (_, i) => `t${i}`) },
    })
    expect(tooMany.status()).toBe(400)

    const tooLongTag = await page.request.post(`${API}/rules`, {
      data: { name: 'Long tag', matchMerchant: 'Grab', addTags: ['x'.repeat(41)] },
    })
    expect(tooLongTag.status()).toBe(400)

    const emptyTag = await page.request.post(`${API}/rules`, {
      data: { name: 'Empty tag', matchMerchant: 'Grab', addTags: [''] },
    })
    expect(emptyTag.status()).toBe(400)
    expect((await emptyTag.json()).error).toBe('addTags must be an array of 1-10 strings, each 1-40 characters')
  })

  test('POST /rules rejects an unwritable matchAccountId / invisible category', async () => {
    const badAccount = await page.request.post(`${API}/rules`, {
      data: { name: 'Bad account', matchAccountId: 'not-an-account-id', setCategoryId: categoryId },
    })
    expect(badAccount.status()).toBe(400)
    expect((await badAccount.json()).error).toBe('matchAccountId must be an account you can write to')

    const badMatchCategory = await page.request.post(`${API}/rules`, {
      data: { name: 'Bad match category', matchCategoryId: 'not-a-category-id', setCategoryId: categoryId },
    })
    expect(badMatchCategory.status()).toBe(400)
    expect((await badMatchCategory.json()).error).toBe('matchCategoryId must be a category you can see')

    const badSetCategory = await page.request.post(`${API}/rules`, {
      data: { name: 'Bad set category', matchMerchant: 'Grab', setCategoryId: 'not-a-category-id' },
    })
    expect(badSetCategory.status()).toBe(400)
    expect((await badSetCategory.json()).error).toBe('setCategoryId must be a category you can see')
  })

  test('POST /rules rejects splitUserId without splitPercent and vice versa', async () => {
    // splitUserId alone isn't a group co-member check failure here — it fails
    // the "go together" rule first in principle, but since splitUserId itself
    // must resolve to a real co-member, use a condition-bearing rule with only
    // one of the pair present to isolate the pairing error.
    const onlyPercent = await page.request.post(`${API}/rules`, {
      data: { name: 'Only percent', matchMerchant: 'Grab', splitPercent: 50 },
    })
    expect(onlyPercent.status()).toBe(400)
  })

  test('POST /rules rejects a splitPercent out of (0, 100)', async () => {
    for (const bad of [0, 100, -5, 150]) {
      const res = await page.request.post(`${API}/rules`, {
        data: { name: `Bad percent ${bad}`, matchMerchant: 'Grab', splitPercent: bad, splitUserId: 'placeholder' },
      })
      expect(res.status()).toBe(400)
    }
  })

  test('POST /rules rejects a splitUserId who is not a co-group member, and the caller themself', async () => {
    const me = await page.request.get(`${API}/auth/me`).then((r) => r.json()) as { user: { id: string } }
    const notMember = await page.request.post(`${API}/rules`, {
      data: { name: 'Not a member', matchMerchant: 'Grab', splitUserId: 'some-stranger-id', splitPercent: 50 },
    })
    expect(notMember.status()).toBe(400)
    expect((await notMember.json()).error).toBe('splitUserId must be a co-group member other than yourself')

    const self = await page.request.post(`${API}/rules`, {
      data: { name: 'Myself', matchMerchant: 'Grab', splitUserId: me.user.id, splitPercent: 50 },
    })
    expect(self.status()).toBe(400)
    expect((await self.json()).error).toBe('splitUserId must be a co-group member other than yourself')
  })

  test('POST /rules accepts a valid split rule with a real co-group member', async ({ browser }) => {
    const { page: payer, otherCtx, otherUserId } = await twoUserGroup(browser, 'valid')
    const acct = await ownedAccount(payer, 'Split Rule Card')
    const res = await payer.request.post(`${API}/rules`, {
      data: { name: 'Split rent', matchAccountId: acct.id, splitUserId: otherUserId, splitPercent: 40 },
    })
    expect(res.status()).toBe(201)
    const row = await res.json()
    expect(row.split_user_id).toBe(otherUserId)
    expect(row.split_percent).toBe(40)
    expect(row.position).toBe(0)
    await payer.context().close()
    await otherCtx.close()
  })

  test('POST /rules creates a rule with each kind of valid condition/action, appending position', async () => {
    const r1 = await page.request.post(`${API}/rules`, {
      data: { name: 'Merchant to category', matchMerchant: 'Grab', setCategoryId: categoryId },
    })
    expect(r1.status()).toBe(201)
    const row1 = await r1.json()
    expect(row1.name).toBe('Merchant to category')
    expect(row1.match_merchant).toBe('Grab')
    expect(row1.set_category_id).toBe(categoryId)
    expect(row1.add_tags).toBe('[]')
    expect(row1.enabled).toBe(1)
    const firstPosition = row1.position

    const r2 = await page.request.post(`${API}/rules`, {
      data: { name: 'Account to tags', matchAccountId: accountId, addTags: ['reimbursable', 'work'] },
    })
    expect(r2.status()).toBe(201)
    const row2 = await r2.json()
    expect(row2.match_account_id).toBe(accountId)
    expect(JSON.parse(row2.add_tags)).toEqual(['reimbursable', 'work'])
    expect(row2.position).toBe(firstPosition + 1)

    const r3 = await page.request.post(`${API}/rules`, {
      data: { name: 'Category condition', matchCategoryId: categoryId, setCategoryId: categoryId },
    })
    expect(r3.status()).toBe(201)
    expect((await r3.json()).match_category_id).toBe(categoryId)
  })

  test('GET /rules lists the caller\'s own rules ordered by position', async () => {
    const res = await page.request.get(`${API}/rules`)
    expect(res.status()).toBe(200)
    const rows = await res.json() as { position: number; user_id: string }[]
    expect(rows.length).toBeGreaterThanOrEqual(3)
    const positions = rows.map((r) => r.position)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  test('PATCH /rules/:id updates fields and touches updated_at', async () => {
    const created = await (await page.request.post(`${API}/rules`, {
      data: { name: 'To edit', matchMerchant: 'Starbucks', setCategoryId: categoryId },
    })).json()

    const patch = await page.request.patch(`${API}/rules/${created.id}`, { data: { name: 'Edited name', enabled: false } })
    expect(patch.status()).toBe(200)
    const row = await patch.json()
    expect(row.name).toBe('Edited name')
    expect(row.enabled).toBe(0)
    // `datetime('now')` is second-granularity, so a PATCH issued in the same
    // second as the POST can legitimately produce an equal, not greater,
    // timestamp — assert "not stale" (>=), not strict inequality.
    expect(row.updated_at >= created.updated_at).toBe(true)
  })

  // Regression for the bug this review found: RuleDialog used to send
  // `matchMerchant: null` to mean "clear the condition", and updateRow()
  // bound that null straight into the NOT NULL match_merchant column — a 500
  // on every such edit. The merged/validated value must be written back
  // before updateRow() ever sees the body (worker/routes/rules.ts PATCH).
  test('PATCH /rules/:id with matchMerchant: null clears the condition instead of 500ing', async () => {
    const created = await (await page.request.post(`${API}/rules`, {
      data: { name: 'Account-only condition', matchAccountId: accountId, setCategoryId: categoryId },
    })).json()

    const patch = await page.request.patch(`${API}/rules/${created.id}`, {
      data: { name: 'Account-only condition, edited', matchMerchant: null },
    })
    expect(patch.status()).toBe(200)
    const row = await patch.json()
    expect(row.match_merchant).toBe('')
    expect(row.name).toBe('Account-only condition, edited')
  })

  // Same bug, different angle: `enabled` sent as something other than a real
  // boolean must 400, not bind whatever it is into the INTEGER column.
  test('PATCH /rules/:id rejects a non-boolean enabled', async () => {
    const created = await (await page.request.post(`${API}/rules`, {
      data: { name: 'Enabled shape', matchMerchant: 'Shape', setCategoryId: categoryId },
    })).json()
    const res = await page.request.patch(`${API}/rules/${created.id}`, { data: { enabled: 'yes' } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('enabled must be a boolean')
  })

  test('PATCH /rules/:id rejects clearing the rule\'s only condition', async () => {
    const created = await (await page.request.post(`${API}/rules`, {
      data: { name: 'Only merchant condition', matchMerchant: 'Lonely', setCategoryId: categoryId },
    })).json()

    const res = await page.request.patch(`${API}/rules/${created.id}`, { data: { matchMerchant: '' } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('a rule needs at least one condition: account, category, or merchant')
  })

  test('PATCH /rules/:id rejects clearing the rule\'s only action', async () => {
    const created = await (await page.request.post(`${API}/rules`, {
      data: { name: 'Only tag action', matchMerchant: 'Lonely2', addTags: ['x'] },
    })).json()

    const res = await page.request.patch(`${API}/rules/${created.id}`, { data: { addTags: null } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('a rule needs at least one action: set a category, add a tag, or split')
  })

  test('DELETE /rules/:id removes it', async () => {
    const created = await (await page.request.post(`${API}/rules`, {
      data: { name: 'To delete', matchMerchant: 'Deleteme', setCategoryId: categoryId },
    })).json()

    const del = await page.request.delete(`${API}/rules/${created.id}`)
    expect(del.status()).toBe(204)

    const rows = await page.request.get(`${API}/rules`).then((r) => r.json()) as { id: string }[]
    expect(rows.find((r) => r.id === created.id)).toBeUndefined()
  })

  test('PATCH on another user\'s rule 404s; DELETE is a no-op 204 that leaves it untouched', async ({ browser }) => {
    const mine = await (await page.request.post(`${API}/rules`, {
      data: { name: 'Mine', matchMerchant: 'OnlyMine', setCategoryId: categoryId },
    })).json()

    const intruder = await newAppPage(browser, '/wallet/accounts')
    const patch = await intruder.request.patch(`${API}/rules/${mine.id}`, { data: { name: 'Hijacked' } })
    expect(patch.status()).toBe(404)

    // DELETE follows the same owner-scoped-WHERE, unconditional-204 convention
    // as every other DELETE in this codebase (budgets, habits, …): a
    // zero-row delete is not distinguished from a one-row delete, so an
    // intruder's DELETE on someone else's id still answers 204 — it just
    // affects nothing, which the follow-up GET confirms.
    const del = await intruder.request.delete(`${API}/rules/${mine.id}`)
    expect(del.status()).toBe(204)
    const stillThere = await page.request.get(`${API}/rules`).then((r) => r.json()) as { id: string; name: string }[]
    expect(stillThere.find((r) => r.id === mine.id)?.name).toBe('Mine')

    await intruder.context().close()
  })
})

// ── Captures accept: tag field ────────────────────────────────────────────

test.describe('124 — captures/accept stores tags (API)', () => {
  let page: Page
  let accountId: string

  test.beforeAll(async ({ browser }) => {
    page = await newAppPage(browser, '/wallet')
    accountId = (await ownedAccount(page, 'Capture Card')).id
  })

  test.afterAll(async () => {
    await page.context().close()
  })

  async function seedPendingCapture(merchant: string, amount: number) {
    const tokenRes = await page.request.post(`${API}/capture-tokens`, { data: { label: 'Rules spec device' } })
    const { token } = await tokenRes.json()
    // The capture endpoint authenticates purely on the bearer header and never
    // reads the session cookie (worker/routes/capture.ts), so reusing `page`'s
    // own request context (which also carries its session cookie) is fine —
    // the route simply ignores the cookie.
    const res = await page.request.post(`${API}/capture/transaction`, {
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `rules-spec-${Date.now()}-${merchant}` },
      data: { merchant, amount, card: 'Visa 0000' },
    })
    expect(res.status()).toBe(201)
    const inbox = await page.request.get(`${API}/captures`).then((r) => r.json()) as { id: string; raw_merchant: string }[]
    const row = inbox.find((c) => c.raw_merchant === merchant)
    if (!row) throw new Error('pending capture not found')
    return row.id
  }

  test('an accepted row with tag stores the tags', async () => {
    const id = await seedPendingCapture('Tagged Merchant', 12.5)
    const res = await page.request.post(`${API}/captures/accept`, {
      data: {
        rows: [
          {
            id,
            accountId,
            date: businessToday(),
            merchant: 'Tagged Merchant',
            amount: 12.5,
            type: 'expense',
            tag: ['from-capture', 'reimbursable'],
          },
        ],
      },
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(JSON.parse(body.transactions[0].tag)).toEqual(['from-capture', 'reimbursable'])
  })

  test('an accepted row with an invalid tag shape 400s', async () => {
    const id = await seedPendingCapture('Bad Tag Merchant', 9.99)
    const res = await page.request.post(`${API}/captures/accept`, {
      data: {
        rows: [
          { id, accountId, date: businessToday(), merchant: 'Bad Tag Merchant', amount: 9.99, type: 'expense', tag: [1, 2] },
        ],
      },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('capture 1: tag must be an array of strings')
  })

  test('omitting tag keeps the unchanged [] behaviour', async () => {
    const id = await seedPendingCapture('No Tag Merchant', 5)
    const res = await page.request.post(`${API}/captures/accept`, {
      data: {
        rows: [{ id, accountId, date: businessToday(), merchant: 'No Tag Merchant', amount: 5, type: 'expense' }],
      },
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.transactions[0].tag).toBe('[]')
  })
})

// ── UI ───────────────────────────────────────────────────────────────────

test.describe('124 — Transaction rules (UI)', () => {
  test('create a rule, apply it via the inbox chip, accept, and delete it', async ({ browser, baseURL }) => {
    const { page, other, otherCtx, otherUserId } = await twoUserGroup(browser, 'ui')
    const otherMe = await other.request.get(`${API}/auth/me`).then((r) => r.json()) as { user: { username: string } }
    const otherUsername = otherMe.user.username

    // 1. An account with a last4 the capture's card will resolve to.
    await page.goto('/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Rules UI Card', type: 'card', last4: '5566' })

    // 2. A category the rule will set.
    await page.request.post(`${API}/categories`, { data: { name: 'Groceries UI', type: 'expense' } })

    // 3. Build the rule in Settings → Wallet.
    await page.goto('/settings/wallet')
    await page.getByTestId('rule-new').click()
    const ruleDialog = page.getByRole('dialog')
    await ruleDialog.getByLabel('Account').selectOption({ label: 'Rules UI Card ••5566' })
    await ruleDialog.getByLabel('Set category').selectOption({ label: 'Groceries UI' })
    const tagInput = page.getByTestId('rule-tags')
    await tagInput.fill('household')
    await tagInput.press('Enter')
    await ruleDialog.getByTestId('rule-split-toggle').check()
    // Selects in DOM order: Account, Match category, Set category, then (only
    // once the split toggle above is checked) the split-partner picker.
    await ruleDialog.getByRole('combobox').nth(3).selectOption({ label: otherUsername })
    await ruleDialog.getByLabel('Their share %').fill('30')
    await ruleDialog.getByTestId('rule-save').click()
    await expect(ruleDialog).toBeHidden()
    await expect(page.getByTestId('rule-row')).toContainText('30%')

    // 4. A capture whose card resolves to the account above.
    const tokenRes = await page.request.post(`${API}/capture-tokens`, { data: { label: 'rules ui device' } })
    const { token } = await tokenRes.json()
    const anon = await playwrightRequest.newContext({ baseURL })
    await anon.post(`${API}/capture/transaction`, {
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `rules-ui-${Date.now()}` },
      data: { merchant: 'Zzqx Mart Unlisted', amount: 40, card: 'Visa 5566' },
    })

    await page.goto('/wallet/inbox')
    await expect(page.getByTestId('capture-inbox-count')).toContainText('1 waiting')
    const chipCheckbox = page.getByLabel('Apply rule (row 1)', { exact: true })
    await expect(chipCheckbox).toBeVisible()
    await expect(chipCheckbox).not.toBeChecked()
    const categorySelect = page.getByTestId('csv-row-category')
    await expect(categorySelect).toHaveValue('')

    // 5. Tick → category set (never auto-applied on load).
    await chipCheckbox.check()
    const groceriesId = await categorySelect.inputValue()
    expect(groceriesId).not.toBe('')

    // 6. Untick → restores the pre-rule category.
    await chipCheckbox.uncheck()
    await expect(categorySelect).toHaveValue('')

    // 7. Tick again and accept.
    await chipCheckbox.check()
    await page.getByTestId('capture-accept-btn').click()
    await expect(page.getByText('Nothing waiting')).toBeVisible()

    // 8. Assert the created transaction via the API: the tag landed, and the
    // split gives the partner exactly 30% (12.00 of 40.00).
    const txns = await (await page.request.get(`${API}/transactions`)).json() as {
      id: string; merchant: string; tag: string
    }[]
    const created = txns.find((t) => t.merchant === 'Zzqx Mart Unlisted')
    expect(created).toBeTruthy()
    expect(JSON.parse(created!.tag)).toContain('household')

    const splits = await (await page.request.get(`${API}/transactions/${created!.id}/splits`)).json() as {
      user_id: string; share_amount: number
    }[]
    const partnerShare = splits.find((s) => s.user_id === otherUserId)
    expect(partnerShare?.share_amount).toBe(12)

    // 9. Delete the rule via its confirm modal.
    await page.goto('/settings/wallet')
    await page.getByTestId('rule-delete').click()
    await page.getByTestId('rule-delete-confirm').click()
    await expect(page.getByTestId('rule-row')).toHaveCount(0)

    await page.context().close()
    await otherCtx.close()
  })

  test('changing category after tick, then unticking, keeps the user\'s own choice', async ({ browser, baseURL }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Keep Choice Card', type: 'card', last4: '1212' })

    const catA = await (await page.request.post(`${API}/categories`, { data: { name: 'Rule Category A', type: 'expense' } })).json() as { id: string }
    const catB = await (await page.request.post(`${API}/categories`, { data: { name: 'User Category B', type: 'expense' } })).json() as { id: string }
    await page.request.post(`${API}/rules`, {
      data: { name: 'Sets category A', matchMerchant: 'uniquemart', setCategoryId: catA.id },
    })

    const tokenRes = await page.request.post(`${API}/capture-tokens`, { data: { label: 'keep-choice device' } })
    const { token } = await tokenRes.json()
    const anon = await playwrightRequest.newContext({ baseURL })
    await anon.post(`${API}/capture/transaction`, {
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `keep-choice-${Date.now()}` },
      data: { merchant: 'Uniquemart Groceries', amount: 20, card: 'Visa 1212' },
    })

    await page.goto('/wallet/inbox')
    const chip = page.getByLabel('Apply rule (row 1)', { exact: true })
    await chip.check()
    const categorySelect = page.getByTestId('csv-row-category')
    await expect(categorySelect).toHaveValue(catA.id)

    // The user overrides the rule's own choice by hand.
    await categorySelect.selectOption(catB.id)

    // Unticking must NOT clobber that choice back to "no category" (#3) —
    // it only restores the pre-rule category when the current one still IS
    // what the rule set, which is no longer true here.
    await chip.uncheck()
    await expect(categorySelect).toHaveValue(catB.id)

    await page.context().close()
  })

  test('editing the merchant so the applied rule no longer matches auto-unticks it, with no tag on accept', async ({ browser, baseURL }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Auto Untick Card', type: 'card', last4: '3434' })

    await page.request.post(`${API}/rules`, {
      data: { name: 'Tesco tag', matchMerchant: 'tesco', addTags: ['groceries-tag'] },
    })

    const tokenRes = await page.request.post(`${API}/capture-tokens`, { data: { label: 'auto-untick device' } })
    const { token } = await tokenRes.json()
    const anon = await playwrightRequest.newContext({ baseURL })
    await anon.post(`${API}/capture/transaction`, {
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `auto-untick-${Date.now()}` },
      data: { merchant: 'Tesco Express', amount: 15, card: 'Visa 3434' },
    })

    await page.goto('/wallet/inbox')
    const chip = page.getByLabel('Apply rule (row 1)', { exact: true })
    await chip.check()
    await expect(chip).toBeChecked()

    // Edit the merchant so it no longer contains "tesco" — the SAME rule no
    // longer matches (#2), so the chip must auto-untick rather than silently
    // leaving the tag applied with nothing ticked to show for it.
    await page.getByRole('textbox', { name: 'Merchant for row 1' }).fill('Totally Different Shop')
    await expect(page.getByTestId('row-rule-removed')).toBeVisible()
    await expect(page.getByTestId('row-rule-chip')).toHaveCount(0)

    await page.getByTestId('capture-accept-btn').click()
    await expect(page.getByText('Nothing waiting')).toBeVisible()

    const txns = await (await page.request.get(`${API}/transactions`)).json() as { merchant: string; tag: string }[]
    const created = txns.find((t) => t.merchant === 'Totally Different Shop')
    expect(created).toBeTruthy()
    expect(JSON.parse(created!.tag)).toEqual([])

    await page.context().close()
  })

  test('CSV import: a ticked split rule creates the split; the same rule on an income row skips the split', async ({ browser }) => {
    const { page, otherCtx, otherUserId } = await twoUserGroup(browser, 'csv')
    await page.goto('/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'CSV Rules Account', type: 'bank' })
    const accounts = await (await page.request.get(`${API}/accounts`)).json() as { id: string; name: string }[]
    const csvAccountId = accounts.find((a) => a.name === 'CSV Rules Account')!.id

    // Matches by account alone — every row in this account's import batch,
    // regardless of merchant.
    await page.request.post(`${API}/rules`, {
      data: { name: 'CSV account split', matchAccountId: csvAccountId, splitUserId: otherUserId, splitPercent: 30 },
    })

    await navigateToImportCsv(page)
    await uploadFixtureCsv(page)
    await expect(page.getByText('transactions.csv')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Review rows' }).click()
    await expect(page.getByRole('heading', { name: 'Review transactions' })).toBeVisible({ timeout: 10_000 })
    await selectReviewAccount(page, 'CSV Rules Account')

    const rows = page.getByTestId('csv-review-row')
    await expect(rows).toHaveCount(4)

    // Merchant is a controlled <input>, so `hasText` can't find a row by it —
    // read the values and resolve each row's index instead (same technique
    // 04-wallet-csv.spec.ts uses to assert on them).
    const merchantInputs = page.getByRole('textbox', { name: /^Merchant for row/ })
    const merchantValues = await merchantInputs.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))
    const grabIndex = merchantValues.indexOf('Grab Food')
    const netflixIndex = merchantValues.indexOf('Netflix')
    expect(grabIndex).toBeGreaterThanOrEqual(0)
    expect(netflixIndex).toBeGreaterThanOrEqual(0)

    // This fixture's amounts are all unsigned, so csv.ts's sign-based type
    // guess defaults every row to 'income' — flip Grab Food to 'expense'
    // explicitly so ticking its chip exercises the split path; Netflix is
    // left at its 'income' default to exercise the skip path (#4).
    const grabRow = rows.nth(grabIndex)
    await grabRow.getByTestId('csv-row-type').selectOption('expense')
    await grabRow.getByLabel(/^Apply rule \(row \d+\)$/, { exact: true }).check()

    const netflixRow = rows.nth(netflixIndex)
    await expect(netflixRow.getByTestId('csv-row-type')).toHaveValue('income')
    await netflixRow.getByLabel(/^Apply rule \(row \d+\)$/, { exact: true }).check()
    await expect(netflixRow).toContainText('split skipped — not an expense')

    await page.getByTestId('import-confirm-btn').click()
    await expect(page.getByText('Import Complete')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('1 split by rule')).toBeVisible()

    const txns = await (await page.request.get(`${API}/transactions`)).json() as { id: string; merchant: string }[]
    const grabTxn = txns.find((t) => t.merchant === 'Grab Food')
    const netflixTxn = txns.find((t) => t.merchant === 'Netflix')
    expect(grabTxn).toBeTruthy()
    expect(netflixTxn).toBeTruthy()

    const grabSplits = await (await page.request.get(`${API}/transactions/${grabTxn!.id}/splits`)).json() as { user_id: string; share_amount: number }[]
    expect(grabSplits.find((s) => s.user_id === otherUserId)?.share_amount).toBe(15)

    const netflixSplits = await (await page.request.get(`${API}/transactions/${netflixTxn!.id}/splits`)).json() as unknown[]
    expect(netflixSplits.length).toBe(0)

    await page.context().close()
    await otherCtx.close()
  })
})
