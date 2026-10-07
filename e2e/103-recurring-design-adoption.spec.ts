import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { newAppPage, businessToday, businessDatePlus } from './helpers'

const API = '/api'

test.describe.configure({ mode: 'serial' })

/**
 * FEAT-068 (EP-06) — exact mock parity for the Recurring page: the "Locked in
 * every month" band, "Worth a look" (price rises / collision / nudge), the
 * month calendar, the "All recurring" table (with its "⋯" menu), pause/resume,
 * and "Detect from history". docs/archive/ep-06-wallet-depth/FEAT-068-recurring-design-adoption.md
 * "Stated rules" has the exact arithmetic this fixture is built against.
 *
 * Fixture design — every rule's `nextDueDate` is set one month AFTER a
 * chosen "display date" that is guaranteed to be on or before today, never a
 * day in the current or past-but-not-yet-created-rule's-lifetime. Two things
 * fall out of that:
 *   - no rule is ever due during this run, so the boot-time catch-up sweep
 *     never fires and silently advances a schedule out from under an
 *     assertion (the trap CLAUDE.md §3 calls out for `32-wallet-error-toasts`);
 *   - `occurrencesInMonth` projects BACKWARDS from `nextDueDate` too
 *     (recurring/insights.ts), but ONLY keeps a backward occurrence that is
 *     <= today and >= the rule's `createdAt` date — so each of these rules
 *     has its `created_at` backdated (via `/test/backdate-recurring`) to
 *     before its display date, or the "occurrence already posted" condition
 *     never holds and the calendar/collision dots silently vanish (exactly
 *     the bug BLOCKER #1 fixes). Display dates are small, DISTINCT
 *     offsets-before-today (`businessDatePlus(-n)`), not fixed day-of-month
 *     literals, so the fixture works no matter what day of the month the
 *     suite runs on — except the rare case where today is in the first few
 *     days of the month, when an offset can spill into the previous month;
 *     that residual risk is accepted, same as the original fixture's own
 *     "every D ≤ 25" month-end note.
 *
 * Rules (all on one account, 'Recurring Co'):
 *   Gymflex    (8 days ago,  RM50  expense, Health)       — price rise source (a)
 *   Broadband  (6 days ago,  RM80→RM100 expense, Bills)    — price rise source (b), via PATCH
 *   Streambox  (4 days ago,  RM60  expense, Entertainment) — same-day collision w/ Cloudify
 *   Cloudify   (4 days ago,  RM70  expense, Entertainment) —   "        "
 *   Netversary (10 days ago, RM200 expense, Shopping)      — costliest nudge (createdAt backdated 200d)
 *   PauseMe    (next month, no display-date check needed)  — pause/resume + band exclusion
 *   SilentBill (OVERDUE, RM15 expense, no category)        — paused-rule process-sweep exclusion
 *
 * lockedIn at rest (before any mutation) = 50+100+60+70+200+40 = 520 (SilentBill
 * excluded — it's paused by the time assertions start).
 *
 * Income baseline: RM4,000 of income in each of the last 3 COMPLETE months →
 * incomeBaseline = 4000. committed % = 520/4000 = 13% (chip-pos, < 25%).
 */
test.describe('103 — Recurring: exact mock parity (band, calendar, price rises, pause, detect)', () => {
  function monthKeyOffset(offset: number): string {
    const [y, m] = businessToday().split('-').map(Number)
    const d = new Date(y, m - 1 + offset, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }

  function dateInMonth(offset: number, day: number): string {
    return `${monthKeyOffset(offset)}-${String(day).padStart(2, '0')}`
  }

  /** One month after `dateStr`, with `advanceDate`'s B-10 end-of-month clamping (worker/routes/wallet.ts). */
  function addOneMonthClamped(dateStr: string): string {
    const [y, m, d] = dateStr.split('-').map(Number)
    let ny = y
    let nm = m + 1
    if (nm > 12) { nm = 1; ny += 1 }
    const lastDayThis = new Date(y, m, 0).getDate()
    const lastDayNext = new Date(ny, nm, 0).getDate()
    const nd = d >= lastDayThis ? lastDayNext : Math.min(d, lastDayNext)
    return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`
  }

  /** Day-of-month of a 'YYYY-MM-DD' string, as a number (for calDay() and ordinal text). */
  function dayOf(dateStr: string): number {
    return Number(dateStr.slice(8, 10))
  }

  async function mkAccount(p: Page, name: string) {
    const res = await p.request.post(`${API}/accounts`, {
      data: { name, type: 'bank', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })
    expect(res.ok()).toBeTruthy()
    return res.json() as Promise<{ id: string; name: string }>
  }

  async function mkRule(
    p: Page,
    fields: { accountId: string; amount: number; merchant: string; type: 'expense' | 'income'; categoryId?: string | null; frequency: 'monthly' | 'weekly'; nextDueDate: string },
  ) {
    const res = await p.request.post(`${API}/recurring-transactions`, { data: fields })
    expect(res.status()).toBe(201)
    return res.json() as Promise<{ id: string; merchant: string }>
  }

  async function patchRule(p: Page, id: string, fields: Record<string, unknown>) {
    const res = await p.request.patch(`${API}/recurring-transactions/${id}`, { data: fields })
    expect(res.ok()).toBeTruthy()
    return res.json()
  }

  async function mkTxn(
    p: Page,
    fields: { accountId: string; date: string; merchant: string; amount: number; type: 'expense' | 'income'; categoryId?: string | null },
  ) {
    const res = await p.request.post(`${API}/transactions`, { data: { ...fields, tag: '[]' } })
    expect(res.ok()).toBeTruthy()
    return res.json()
  }

  async function backdateRule(p: Page, id: string, days: number) {
    const res = await p.request.post(`${API}/test/backdate-recurring`, { data: { id, days } })
    expect(res.ok()).toBeTruthy()
  }

  /** The in-month (non-muted) calendar cell whose day number is exactly `day`. */
  function calDay(p: Page, day: number) {
    return p.locator('.cal-day:not(.muted)').filter({ has: p.locator('.cal-n', { hasText: new RegExp(`^${day}$`) }) })
  }

  async function openRowMenu(p: Page, merchant: string) {
    await p.getByTestId('recurring-row').filter({ hasText: merchant })
      .getByRole('button', { name: `More actions for ${merchant}` }).click()
  }

  let page: Page
  let account: { id: string; name: string }
  let categories: { id: string; name: string }[]
  let gymflex: { id: string }
  let broadband: { id: string }
  let netversary: { id: string }
  let silentBill: { id: string }

  // Display dates for the backward-projected occurrences this fixture needs
  // to show THIS month — small, distinct offsets before today (see the
  // fixture-design comment above `describe`), each rule's `createdAt` gets
  // backdated well before its own display date so BLOCKER #1's "<= today
  // AND >= createdAt" condition holds.
  const gymflexDisplayDate = businessDatePlus(-8)
  const broadbandDisplayDate = businessDatePlus(-6)
  const collisionDisplayDate = businessDatePlus(-4)
  const netversaryDisplayDate = businessDatePlus(-10)
  const gymflexDay = dayOf(gymflexDisplayDate)
  const broadbandDay = dayOf(broadbandDisplayDate)
  const collisionDay = dayOf(collisionDisplayDate)
  const netversaryDay = dayOf(netversaryDisplayDate)

  test.beforeAll(async ({ browser }) => {
    page = await newAppPage(browser, '/wallet/recurring')
    account = await mkAccount(page, 'Recurring Co')
    categories = await (await page.request.get(`${API}/categories`)).json()
    const catId = (name: string) => categories.find((c) => c.name === name)!.id

    // ── Income baseline: 3 complete prior months, RM4,000 each ──────────
    for (const offset of [-3, -2, -1]) {
      await mkTxn(page, { accountId: account.id, date: `${monthKeyOffset(offset)}-15`, merchant: 'Payroll', amount: 4000, type: 'income' })
    }

    // ── Price rise source (a): Gymflex RM50 rule + a RM70 matching charge ──
    gymflex = await mkRule(page, {
      accountId: account.id, amount: 50, merchant: 'Gymflex', type: 'expense',
      categoryId: catId('Health'), frequency: 'monthly', nextDueDate: addOneMonthClamped(gymflexDisplayDate),
    })
    await backdateRule(page, gymflex.id, 20)
    await mkTxn(page, { accountId: account.id, date: businessToday(), merchant: 'Gymflex', amount: 70, type: 'expense', categoryId: catId('Health') })

    // ── Price rise source (b): Broadband RM80 → RM100 via a direct PATCH ──
    broadband = await mkRule(page, {
      accountId: account.id, amount: 80, merchant: 'Broadband', type: 'expense',
      categoryId: catId('Bills & Utilities'), frequency: 'monthly', nextDueDate: addOneMonthClamped(broadbandDisplayDate),
    })
    await backdateRule(page, broadband.id, 20)
    await patchRule(page, broadband.id, { amount: 100 })

    // ── Same-day collision: Streambox + Cloudify, both on `collisionDay` ──
    const streambox = await mkRule(page, {
      accountId: account.id, amount: 60, merchant: 'Streambox', type: 'expense',
      categoryId: catId('Entertainment'), frequency: 'monthly', nextDueDate: addOneMonthClamped(collisionDisplayDate),
    })
    await backdateRule(page, streambox.id, 20)
    const cloudify = await mkRule(page, {
      accountId: account.id, amount: 70, merchant: 'Cloudify', type: 'expense',
      categoryId: catId('Entertainment'), frequency: 'monthly', nextDueDate: addOneMonthClamped(collisionDisplayDate),
    })
    await backdateRule(page, cloudify.id, 20)

    // ── Costliest nudge: Netversary, createdAt backdated > 6 months ────
    netversary = await mkRule(page, {
      accountId: account.id, amount: 200, merchant: 'Netversary', type: 'expense',
      categoryId: catId('Shopping'), frequency: 'monthly', nextDueDate: addOneMonthClamped(netversaryDisplayDate),
    })
    await backdateRule(page, netversary.id, 200)

    // ── Pause / resume + band exclusion ─────────────────────────────────
    // No display-date check is ever asserted for PauseMe, so a plain
    // next-month due date (never actually projected backward for an
    // assertion) is fine as-is.
    await mkRule(page, {
      accountId: account.id, amount: 40, merchant: 'PauseMe', type: 'expense',
      categoryId: catId('Food & Drink'), frequency: 'monthly', nextDueDate: dateInMonth(1, 25),
    })

    // ── Paused-rule process-sweep exclusion (deliberately OVERDUE) ──────
    silentBill = await mkRule(page, {
      accountId: account.id, amount: 15, merchant: 'SilentBill', type: 'expense',
      categoryId: null, frequency: 'monthly', nextDueDate: businessDatePlus(-10),
    })
    await patchRule(page, silentBill.id, { paused: true })

    await page.reload()
  })

  test.afterAll(async () => {
    await page.context().close()
  })

  // ── Band: locked-in figure, committed % ────────────────────────────────

  test('the band shows the locked-in total and the committed-% chip', async () => {
    const band = page.getByTestId('recurring-band')
    await expect(band).toBeVisible()
    await expect(page.getByTestId('recurring-locked-in')).toContainText(/520\.00/)
    const chip = page.getByTestId('recurring-committed-chip')
    await expect(chip).toContainText('13% committed')
    await expect(band).toContainText(/4,000\.00 income/)
  })

  test('the band shows the annual cost derived from the locked-in total', async () => {
    await expect(page.getByTestId('recurring-annual-cost')).toContainText(/6,240\.00/)
  })

  // ── Annual column ────────────────────────────────────────────────────────

  test('the table\'s Annual column shows 12× the monthly amount', async () => {
    const row = page.getByTestId('recurring-row').filter({ hasText: 'Netversary' })
    await expect(row).toContainText(/2,400\.00/) // 200 * 12
  })

  // ── Calendar ─────────────────────────────────────────────────────────────

  test('the calendar places each rule\'s amount on the day it lands', async () => {
    await expect(calDay(page, gymflexDay)).toContainText(/50\.00/) // Gymflex
    await expect(calDay(page, broadbandDay)).toContainText(/100\.00/) // Broadband (post-patch amount)
    await expect(calDay(page, netversaryDay)).toContainText(/200\.00/) // Netversary
    await expect(calDay(page, collisionDay)).toContainText(/130\.00/) // Streambox + Cloudify combined
  })

  // ── BLOCKER #1: backward projection never fabricates a future charge ────

  test('a rule created today with its next due next month shows NO dot earlier this month', async () => {
    // `createdAt` defaults to "now" (today) — a backward-projected occurrence
    // earlier than today therefore fails the ">= createdAt" condition and
    // must never appear, even though the SAME day-of-month shows real dots
    // for the backdated fixture rules above.
    const todayDay = Number(businessToday().slice(8, 10))
    const yesterday = businessDatePlus(-1)
    const sameMonth = yesterday.slice(0, 7) === businessToday().slice(0, 7)
    const noDotDay = sameMonth ? dayOf(yesterday) : Math.max(1, todayDay - 1)

    const fresh = await mkRule(page, {
      accountId: account.id, amount: 999, merchant: 'FreshNoBackfill', type: 'expense',
      categoryId: null, frequency: 'monthly', nextDueDate: addOneMonthClamped(`${businessToday().slice(0, 7)}-${String(noDotDay).padStart(2, '0')}`),
    })
    expect(fresh.id).toBeTruthy()

    await page.reload()
    await expect(calDay(page, noDotDay)).not.toContainText('999.00')

    // Remove it — left in place it would inflate every lockedIn/band
    // assertion that follows (this rule's nextDueDate is next month, so it
    // would otherwise count as RM999/mo of real, ongoing locked-in spend).
    await page.request.delete(`${API}/recurring-transactions/${fresh.id}`)
    await page.reload()
  })

  // ── Price rise (a): a matched charge above the rule ─────────────────────

  test('a matched charge above the rule amount shows as a price rise with an Update-rule fix', async () => {
    const tableRow = page.getByTestId('recurring-row').filter({ hasText: 'Gymflex' })
    await expect(tableRow).toContainText(/\+RM\s*20\.00/)

    const lookRow = page.getByTestId('worth-a-look').getByTestId('worth-a-look-row').filter({ hasText: 'Gymflex' })
    await expect(lookRow).toContainText(/charged RM\s*70\.00/)

    // "Update rule" PATCHes the rule's amount to the matched charge (50 → 70).
    // That PATCH itself stamps previous_amount/amount_changed_at (source b),
    // so the row doesn't vanish — it flips from the unacknowledged "charged"
    // phrasing (source a, with the fix-it button) to the informational "went
    // up" phrasing (source b, no button), per FEAT-068's "(a) wins" rule: once
    // the matched-charge condition no longer holds (rule.amount now equals
    // the charge), source (b) is the only one left to apply.
    await lookRow.getByRole('button', { name: 'Update rule' }).click()
    const updatedLookRow = page.getByTestId('worth-a-look').getByTestId('worth-a-look-row').filter({ hasText: 'Gymflex' })
    await expect(updatedLookRow).toContainText(/went up RM\s*20\.00/)
    await expect(updatedLookRow.getByRole('button')).toHaveCount(0)
    await expect(tableRow).toContainText(/70\.00/)
  })

  // ── Price rise (b): an edit that raised the rule's own amount ───────────

  test('an edit that raised the rule\'s amount shows as an informational price rise, with no fix button', async () => {
    const lookRow = page.getByTestId('worth-a-look').getByTestId('worth-a-look-row').filter({ hasText: 'Broadband' })
    await expect(lookRow).toContainText(/went up RM\s*20\.00/)
    await expect(lookRow.getByRole('button')).toHaveCount(0)
  })

  // ── Same-day collision ───────────────────────────────────────────────────

  test('two rules landing on the same day surface as a collision', async () => {
    const suffix = collisionDay >= 11 && collisionDay <= 13 ? 'th'
      : collisionDay % 10 === 1 ? 'st' : collisionDay % 10 === 2 ? 'nd' : collisionDay % 10 === 3 ? 'rd' : 'th'
    const lookRow = page.getByTestId('worth-a-look').getByTestId('worth-a-look-row')
      .filter({ hasText: new RegExp(`charges land on the ${collisionDay}${suffix}`) })
    await expect(lookRow).toBeVisible()
    await expect(lookRow).toContainText(/130\.00/)
  })

  // ── Costliest-subscription nudge ─────────────────────────────────────────

  test('the oldest, costliest rule surfaces as a nudge with a working Review button', async () => {
    const lookRow = page.getByTestId('worth-a-look').getByTestId('worth-a-look-row').filter({ hasText: 'Netversary' })
    await expect(lookRow).toContainText(/costs RM\s*2,400\.00 a year/)

    await lookRow.getByRole('button', { name: 'Review' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel(/Merchant/i)).toHaveValue('Netversary')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  // ── Pause → excluded from the band total and the process sweep ──────────

  test('pausing a rule removes it from the locked-in total and the Active tab', async () => {
    await openRowMenu(page, 'PauseMe')
    await page.getByRole('menuitem', { name: 'Pause PauseMe' }).click()
    // A prior test's toast ("Updated Gymflex to RM 70.00.") can still be
    // visible/animating out — filter to this one rather than assume it's the
    // only toast in the DOM.
    await expect(page.getByTestId('toast').filter({ hasText: 'Paused PauseMe.' })).toBeVisible()

    // 520 (at rest) + 20 (Gymflex's earlier Update-rule bump, 50 → 70) - 40
    // (PauseMe's monthly equivalent, now paused) = 500.
    await expect(page.getByTestId('recurring-locked-in')).toContainText(/500\.00/)
    await expect(page.getByTestId('recurring-row').filter({ hasText: 'PauseMe' })).toHaveCount(0)

    await page.getByRole('tab', { name: 'Paused' }).click()
    const row = page.getByTestId('recurring-row').filter({ hasText: 'PauseMe' })
    await expect(row).toBeVisible()
    await expect(row).toContainText('Paused')
  })

  test('a paused, overdue rule is skipped by the process sweep and refuses Post now (409)', async () => {
    const res = await page.request.post(`${API}/recurring-transactions/process`)
    expect(res.ok()).toBeTruthy()
    const before = await res.json()

    const postRes = await page.request.post(`${API}/recurring-transactions/${silentBill.id}/post`)
    expect(postRes.status()).toBe(409)

    // No SilentBill transaction exists — the paused rule posted nothing.
    const txns = await (await page.request.get(`${API}/transactions?dateFrom=2000-01-01&dateTo=${businessToday()}`)).json()
    expect(txns.some((t: { merchant: string }) => t.merchant === 'SilentBill')).toBe(false)
    expect(before.posted).toBe(0)
  })

  test('resuming the rule lets the next sweep catch up the missed charge', async () => {
    await page.goto('/wallet/recurring')
    await page.getByRole('tab', { name: 'Paused' }).click()
    await openRowMenu(page, 'SilentBill')
    await page.getByRole('menuitem', { name: 'Resume SilentBill' }).click()
    await expect(page.getByTestId('toast').filter({ hasText: /Resumed SilentBill/ })).toContainText(/catch up any missed charges/)

    const res = await page.request.post(`${API}/recurring-transactions/process`)
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.posted).toBeGreaterThan(0)

    const txns = await (await page.request.get(`${API}/transactions?dateFrom=2000-01-01&dateTo=${businessToday()}`)).json()
    expect(txns.some((t: { merchant: string }) => t.merchant === 'SilentBill')).toBe(true)
  })

  // ── Detect from history ──────────────────────────────────────────────────

  test('Detect from history finds a repeating, unregistered charge and lets it be added', async () => {
    for (const offset of [-2, -1]) {
      await mkTxn(page, { accountId: account.id, date: `${monthKeyOffset(offset)}-15`, merchant: 'Gymbox Classes', amount: 45, type: 'expense' })
    }
    await mkTxn(page, { accountId: account.id, date: `${monthKeyOffset(0)}-01`, merchant: 'Gymbox Classes', amount: 45, type: 'expense' })

    await page.goto('/wallet/recurring')
    await page.getByRole('button', { name: 'Detect from history' }).click()
    const modal = page.getByRole('dialog').filter({ hasText: 'Detect from history' })
    await expect(modal).toBeVisible()

    const candidate = modal.getByTestId('detect-candidate-row').filter({ hasText: 'Gymbox Classes' })
    await expect(candidate).toContainText(/seen 3 months running/)

    await candidate.getByRole('button', { name: 'Add as recurring' }).click()
    await expect(modal).toBeHidden()

    const createDialog = page.getByRole('dialog')
    await expect(createDialog).toBeVisible()
    await expect(createDialog.getByLabel(/Merchant/i)).toHaveValue('Gymbox Classes')

    // BLOCKER #2: the suggested next due is rolled forward until it is
    // strictly after today, so accepting the candidate never back-posts a
    // charge that already happened (the most recent seeded charge was on
    // the 1st of this month, which is on or before today).
    const suggestedNextDue = await createDialog.getByLabel(/Next due/i).inputValue()
    expect(suggestedNextDue > businessToday()).toBe(true)

    await createDialog.getByRole('button', { name: 'Create Rule' }).click()
    await expect(createDialog).toBeHidden()

    await expect(page.getByTestId('recurring-row').filter({ hasText: 'Gymbox Classes' })).toBeVisible()

    // The merchant now has a rule, so it drops out of the candidate list.
    await page.getByRole('button', { name: 'Detect from history' }).click()
    await expect(page.getByRole('dialog').filter({ hasText: 'Detect from history' }).getByTestId('detect-candidate-row').filter({ hasText: 'Gymbox Classes' })).toHaveCount(0)
  })
})
