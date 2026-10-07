import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { newAppPage, businessToday } from './helpers'

const API = '/api'

test.describe.configure({ mode: 'serial' })

/**
 * FEAT-067 (EP-06) — the funding-rate/ETA/status/trajectory/milestone math
 * absorbed from FEAT-019 (docs/archive/ep-06-wallet-depth/FEAT-067-goals-design-adoption.md,
 * src/modules/wallet/goals/projection.ts). e2e/16 covers basic goal CRUD and
 * the ⋯ menu; this file exercises the rate computation end to end through
 * seeded transaction history.
 *
 * Fixture design — all amounts picked so the rule outcome (On track / Behind
 * / Paused / undated) is unambiguous regardless of which day of the month
 * the suite runs, since `fundingRate`/`isPaused`/`goalStatus` only ever
 * compare WHOLE calendar months (never a day-of-month), and all target
 * dates below are expressed as a MONTH offset from the current month, not a
 * fixed day:
 *
 *   Trek Fund (On track)   — account "Trek Vault". RM1,000 income in each of
 *     the last 3 COMPLETE months → rate = RM1,000/mo, saved = RM3,000.
 *     Target RM10,000, target date = today + 7 months (same month as the
 *     natural ETA: ceil((10000-3000)/1000) = 7). needed = (10000-3000)/7 =
 *     1000 = rate ⇒ On track, not Ahead (monthsEarly = 0).
 *   Boat Fund (Behind)     — account "Boat Vault". Same RM1,000/mo rate and
 *     RM3,000 saved, but target RM9,000 due in only 3 months. needed =
 *     (9000-3000)/3 = 2000 > rate ⇒ Behind. shortfall = 2000-1000 = 1000.
 *   Lens Fund (Paused)     — account "Lens Vault". RM800 income 4 months
 *     ago only (outside the 3-complete-month window and not this month) ⇒
 *     Paused.
 *   Camera Fund (undated, finishes soon) — account "Camera Vault". RM900
 *     income in each of the last 3 months → rate = RM900/mo, saved =
 *     RM2,700. Target RM3,500, no target date ⇒ undated status, "full by".
 *     Remaining 800 / 900 ⇒ ETA = today + 1 month ⇒ finishes within the
 *     knock-on's 12-month window, freeing RM900/mo. Against Boat Fund's
 *     RM1,000 shortfall, 900 < 1000 ⇒ "partialHelp" knock-on, pct =
 *     round(900/1000*100) = 90%.
 *
 * All seeding is via API (income transactions directly into each goal's
 * linked account — no transfer leg needed to produce net inflow), per
 * e2e/88-90's established pattern. Dates come from `monthKeyOffset`, built
 * on `businessToday()` (never `toISOString()` — CLAUDE.md §3 "one clock" trap).
 */
test.describe('102 — Goals trajectory (rate, ETA, status, milestones)', () => {
  function monthKeyOffset(offset: number): string {
    const [y, m] = businessToday().split('-').map(Number)
    const d = new Date(y, m - 1 + offset, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }

  /** A target-date MONTH, offset whole months from the current month — always day 15, never a boundary day. */
  function targetDateOffset(months: number): string {
    return `${monthKeyOffset(months)}-15`
  }

  async function mkAccount(page: Page, name: string) {
    const res = await page.request.post(`${API}/accounts`, {
      data: { name, type: 'bank', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })
    expect(res.ok()).toBeTruthy()
    return res.json()
  }

  async function mkGoal(
    page: Page,
    fields: { name: string; targetAmount: number; accountId: string; targetDate?: string | null; note?: string },
  ) {
    const res = await page.request.post(`${API}/goals`, { data: fields })
    expect(res.ok()).toBeTruthy()
    return res.json()
  }

  // `day` defaults to the 10th (safely past for the -1/-2/-3/-4 PRIOR months
  // this fixture otherwise uses it for), but a current-month seed must never
  // land in the future relative to whatever day the suite happens to run on
  // — callers seeding into the CURRENT month pass day 1.
  async function income(page: Page, accountId: string, month: string, amount: number, day = '10') {
    const res = await page.request.post(`${API}/transactions`, {
      data: { accountId, date: `${month}-${day}`, merchant: 'Deposit', amount, type: 'income', tag: '[]' },
    })
    expect(res.ok()).toBeTruthy()
  }

  let page: Page
  let trekAccount: { id: string; name: string }
  let boatAccount: { id: string; name: string }
  let lensAccount: { id: string; name: string }
  let cameraAccount: { id: string; name: string }
  let checkingAccount: { id: string; name: string }

  test.beforeAll(async ({ browser }) => {
    page = await newAppPage(browser, '/wallet/goals')

    trekAccount = await mkAccount(page, 'Trek Vault')
    boatAccount = await mkAccount(page, 'Boat Vault')
    lensAccount = await mkAccount(page, 'Lens Vault')
    cameraAccount = await mkAccount(page, 'Camera Vault')
    checkingAccount = await mkAccount(page, 'Main Checking')
    // The "from" leg for the Add-money transfer test needs its own funds.
    // Day 1, not the default day 10 — this is the CURRENT month, and day 10
    // would be a future-dated transaction on any run before the 10th.
    await income(page, checkingAccount.id, monthKeyOffset(0), 5000, '01')

    for (const offset of [-3, -2, -1]) {
      await income(page, trekAccount.id, monthKeyOffset(offset), 1000)
      await income(page, boatAccount.id, monthKeyOffset(offset), 1000)
      await income(page, cameraAccount.id, monthKeyOffset(offset), 900)
    }
    await income(page, lensAccount.id, monthKeyOffset(-4), 800)

    // Trek Fund is created FIRST so it is the default "Add money" destination
    // (assumption: "Add money" targets the first non-complete goal — spec's
    // own wording — which this fixture takes to mean creation order).
    await mkGoal(page, {
      name: 'Trek Fund',
      targetAmount: 10000,
      accountId: trekAccount.id,
      targetDate: targetDateOffset(7),
      note: 'Southeast Asia trek',
    })
    await mkGoal(page, { name: 'Boat Fund', targetAmount: 9000, accountId: boatAccount.id, targetDate: targetDateOffset(3) })
    await mkGoal(page, { name: 'Lens Fund', targetAmount: 5000, accountId: lensAccount.id })
    await mkGoal(page, { name: 'Camera Fund', targetAmount: 3500, accountId: cameraAccount.id })

    await page.reload()
  })

  test.afterAll(async () => {
    await page.context().close()
  })

  // ── Status chips ───────────────────────────────────────────────────────

  test('a steadily-funded goal with a distant, matching target date shows "On track"', async () => {
    const card = page.getByTestId('goal-card').filter({ hasText: 'Trek Fund' })
    await expect(card.getByTestId('goal-status')).toHaveText('On track')
    await expect(card.getByTestId('goal-status-sub')).toContainText('/mo')
  })

  test('the same rate against a near target date shows "Behind"', async () => {
    const card = page.getByTestId('goal-card').filter({ hasText: 'Boat Fund' })
    await expect(card.getByTestId('goal-status')).toHaveText('Behind')
    await expect(card.getByTestId('goal-status-sub')).toContainText('needs')
  })

  test('a goal whose account stopped receiving money more than 3 months ago shows "Paused"', async () => {
    const card = page.getByTestId('goal-card').filter({ hasText: 'Lens Fund' })
    await expect(card.getByTestId('goal-status')).toHaveText('Paused')
    await expect(card.getByTestId('goal-status-sub')).toContainText('no contribution')
  })

  test('an undated goal shows no status chip, with a "full by" sub-line instead', async () => {
    const card = page.getByTestId('goal-card').filter({ hasText: 'Camera Fund' })
    await expect(card.getByTestId('goal-status')).toHaveCount(0)
    await expect(card.getByTestId('goal-status-sub')).toContainText('full by')
  })

  // ── Milestones ─────────────────────────────────────────────────────────

  test('a milestone row exists for a funded, non-paused goal', async () => {
    const milestones = page.getByTestId('goals-milestones')
    await expect(milestones).toBeVisible()
    const row = milestones.getByTestId('goal-milestone').filter({ hasText: 'Trek Fund' })
    await expect(row).toBeVisible()
    await expect(row).toContainText('halfway')
  })

  test('the knock-on sentence names the soon-to-finish goal and the goal it helps', async () => {
    const knockOn = page.getByTestId('goals-knock-on')
    await expect(knockOn).toBeVisible()
    await expect(knockOn).toContainText('Camera Fund')
    await expect(knockOn).toContainText('Boat Fund')
  })

  // ── Add money ──────────────────────────────────────────────────────────

  test('"Add money" opens a transfer into a goal account and raises Added this month', async () => {
    const band = page.getByTestId('goals-band')
    await expect(band.getByTestId('goals-added-month')).toContainText(/RM\s*0\.00|0\.00/)

    await page.getByRole('button', { name: 'Add money' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // Pre-filled as a transfer; the source leg needs an account with funds.
    const fromSelect = dialog.locator('#from-account, #account').first()
    if (await fromSelect.count()) {
      await fromSelect.selectOption('Main Checking')
    }
    await dialog.getByLabel('Amount').fill('300')
    await dialog.getByRole('button', { name: /Add Transaction|Save Changes/ }).click()
    await expect(dialog).toBeHidden()

    await expect(band.getByTestId('goals-added-month')).toContainText(/300\.00/)
  })

  // ── Trajectory chart tabs ────────────────────────────────────────────

  test('the trajectory chart offers 1y / 3y / All tabs, defaulting one selected', async () => {
    const chart = page.getByTestId('goals-trajectory')
    await expect(chart).toBeVisible()
    const tablist = chart.getByRole('tablist')
    await expect(tablist).toBeVisible()
    const selected = tablist.getByRole('tab', { selected: true })
    await expect(selected).toHaveCount(1)
  })

  test('switching to 3y and All moves the aria-selected tab', async () => {
    const chart = page.getByTestId('goals-trajectory')
    const tab3y = chart.getByRole('tab', { name: '3y' })
    await tab3y.click()
    await expect(tab3y).toHaveAttribute('aria-selected', 'true')

    const tabAll = chart.getByRole('tab', { name: 'All' })
    await tabAll.click()
    await expect(tabAll).toHaveAttribute('aria-selected', 'true')
    await expect(tab3y).toHaveAttribute('aria-selected', 'false')
  })

  // ── Edit form round-trip: target date + note ────────────────────────

  test('target date and note round-trip through the edit form', async () => {
    const card = page.getByTestId('goal-card').filter({ hasText: 'Boat Fund' })
    await card.getByRole('button', { name: 'More actions for Boat Fund' }).click()
    await page.getByRole('menuitem', { name: 'Edit Boat Fund' }).click()

    const dialog = page.getByRole('dialog')
    const newDate = targetDateOffset(5)
    await dialog.getByLabel('Target date').fill(newDate)
    await dialog.getByLabel('Note').fill('New sailboat')
    await dialog.getByRole('button', { name: 'Save Changes' }).click()
    await expect(dialog).toBeHidden()

    await expect(card.getByTestId('goal-note')).toHaveText('New sailboat')

    await card.getByRole('button', { name: 'More actions for Boat Fund' }).click()
    await page.getByRole('menuitem', { name: 'Edit Boat Fund' }).click()
    await expect(dialog.getByLabel('Target date')).toHaveValue(newDate)
    await expect(dialog.getByLabel('Note')).toHaveValue('New sailboat')
    await dialog.getByRole('button', { name: /Cancel|Close/i }).click().catch(async () => {
      await page.keyboard.press('Escape')
    })
  })
})
