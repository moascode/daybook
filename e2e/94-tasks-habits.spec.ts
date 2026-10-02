/**
 * FEAT-029 — Tasks: Habits (`/tasks/habits`,
 * docs/backlog/EP-07-tasks-depth/FEAT-029-tasks-habits.md). Markup updated
 * for FEAT-061's design adoption (rings/dots replacing the old square grid,
 * the "Habit options" popover replacing the two separate inline icon
 * buttons) — see e2e/100-tasks-habits-design.spec.ts for coverage of the
 * new cards themselves.
 *
 * Covers: creating a manually-tracked habit, toggling a grid day to build a
 * streak, archiving removing it from the default list, and the Wallet-linked
 * "no spend day" habit deriving `done` from transactions rather than an
 * explicit entry (and rejecting a manual toggle on it).
 */

import { test, expect } from '@playwright/test'
import { newAppPage, businessToday, businessDatePlus } from './helpers'

const API = '/api'

test.describe('94 — Tasks habits', () => {
  test('creating a habit shows it with a zero streak and an empty grid', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/habits')

    await page.getByTestId('habit-new-btn').click()
    await page.getByTestId('habit-name-input').fill('Stretch')
    await page.getByTestId('habit-create-save-btn').click()

    const card = page.getByTestId('habit-card').filter({ hasText: 'Stretch' })
    await expect(card).toBeVisible()
    await expect(card.getByTestId('habit-current-streak')).toHaveText('0-day streak')
    await expect(card.getByTestId('habit-best-streak')).toHaveText('best 0 days')
  })

  test('toggling today builds a 1-day streak, and toggling again reverts it', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/habits')
    const today = businessToday()

    await page.getByTestId('habit-new-btn').click()
    await page.getByTestId('habit-name-input').fill('Meditate')
    await page.getByTestId('habit-create-save-btn').click()

    const card = page.getByTestId('habit-card').filter({ hasText: 'Meditate' })
    await card.getByTestId(`habit-grid-day-${today}`).click()
    await expect(card.getByTestId('habit-current-streak')).toHaveText('1-day streak')
    await expect(card.getByTestId('habit-best-streak')).toHaveText('best 1 day')

    await card.getByTestId(`habit-grid-day-${today}`).click()
    await expect(card.getByTestId('habit-current-streak')).toHaveText('0-day streak')
  })

  test('a streak built through yesterday still reads correctly before today is toggled', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/habits')
    const yesterday = businessDatePlus(-1)

    const createRes = await page.request.post(`${API}/habits`, { data: { name: 'Journal' } })
    const habit = await createRes.json()
    await page.request.post(`${API}/habits/${habit.id}/toggle`, { data: { date: yesterday } })

    // Reload rather than relying on the create/toggle response — this is
    // GET /habits' own computeStats(), the code path a normal page visit
    // exercises, not just the write endpoints.
    await page.reload()
    const card = page.getByTestId('habit-card').filter({ hasText: 'Journal' })
    // Not yet 0: today is due and not yet done, but the day isn't over, so it
    // must not zero out yesterday's kept day.
    await expect(card.getByTestId('habit-current-streak')).toHaveText('1-day streak')
    await expect(card.getByTestId('habit-best-streak')).toHaveText('best 1 day')
  })

  test('archiving a habit removes it from the default (non-archived) list', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/habits')

    await page.getByTestId('habit-new-btn').click()
    await page.getByTestId('habit-name-input').fill('Journal')
    await page.getByTestId('habit-create-save-btn').click()

    const card = page.getByTestId('habit-card').filter({ hasText: 'Journal' })
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: 'Habit options' }).click()
    await card.getByRole('menuitem', { name: 'Archive' }).click()
    await expect(page.getByTestId('habit-card').filter({ hasText: 'Journal' })).not.toBeVisible()
  })

  test('a Wallet-linked "no spend" habit derives done from transactions, and cannot be toggled by hand', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/habits')
    const today = businessToday()

    // No expense transactions yet — today counts as kept.
    await page.getByTestId('habit-new-btn').click()
    await page.getByTestId('habit-name-input').fill('No spend day')
    await page.getByTestId('habit-link-no-spend-checkbox').check()
    await page.getByTestId('habit-create-save-btn').click()

    const card = page.getByTestId('habit-card').filter({ hasText: 'No spend day' })
    await expect(card).toBeVisible()
    // A linked habit's dot carries no `role="button"` / click handler — it
    // derives `done` automatically and can't be toggled by hand.
    await expect(card.getByTestId(`habit-grid-day-${today}`)).not.toHaveAttribute('role', 'button')
    await expect(card.getByTestId('habit-current-streak')).not.toHaveText('0-day streak')

    // A manual toggle is rejected server-side, not just hidden client-side.
    const habitsRes = await page.request.get(`${API}/habits`)
    const [habit] = await habitsRes.json()
    const toggleRes = await page.request.post(`${API}/habits/${habit.id}/toggle`, { data: {} })
    expect(toggleRes.status()).toBe(400)

    // Seed an expense today and confirm the day flips to missed after reload.
    const accountRes = await page.request.post(`${API}/accounts`, {
      data: { name: 'Main', type: 'bank', openingBalance: 0 },
    })
    const account = await accountRes.json()
    await page.request.post(`${API}/transactions`, {
      data: { accountId: account.id, amount: 12.5, type: 'expense', date: today, merchant: 'Coffee' },
    })
    await page.reload()

    const cardAfter = page.getByTestId('habit-card').filter({ hasText: 'No spend day' })
    await expect(cardAfter.getByTestId('habit-current-streak')).toHaveText('0-day streak')
  })
})
