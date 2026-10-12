/**
 * Tasks: Habits production-parity pass, on top of e2e/94 (core
 * streak/toggle/archive behaviour) and e2e/100 (FEAT-061 design-adoption
 * cards). Covers: editing a habit through the pre-filled create modal,
 * delete going through ConfirmDeleteModal rather than deleting immediately,
 * archive/restore round-tripping through the lazily-loaded "Archived"
 * section, today's due-but-undecided dot getting its own non-`.miss` state,
 * and the dot grid's a11y attributes.
 */

import { test, expect } from '@playwright/test'
import { newAppPage, businessToday } from './helpers'

const API = '/api'

async function createHabit(page: import('@playwright/test').Page, name: string, data: Record<string, unknown> = {}) {
  const res = await page.request.post(`${API}/habits`, { data: { name, ...data } })
  return res.json()
}

test.describe('111 — Tasks habits parity', () => {
  test('editing a habit pre-fills the modal and saves through PATCH', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/habits')
    await createHabit(page, 'Stretch', { targetPerWeek: 5, schedule: [1, 2, 3, 4, 5] })
    await page.reload()

    const card = page.getByTestId('habit-card').filter({ hasText: 'Stretch' })
    await card.getByRole('button', { name: 'Habit options' }).click()
    await card.getByRole('menuitem', { name: 'Edit' }).click()

    await expect(page.getByRole('heading', { name: 'Edit habit' })).toBeVisible()
    await expect(page.getByTestId('habit-name-input')).toHaveValue('Stretch')
    // Mon..Fri were the saved schedule — those five day buttons are pressed,
    // Sat/Sun are not.
    await expect(page.getByTestId('habit-schedule-day-1')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('habit-schedule-day-0')).toHaveAttribute('aria-pressed', 'false')

    await page.getByTestId('habit-name-input').fill('Stretch daily')
    await page.getByTestId('habit-create-save-btn').click()

    await expect(page.getByRole('heading', { name: 'Edit habit' })).not.toBeVisible()
    await expect(page.getByTestId('habit-card').filter({ hasText: 'Stretch daily' })).toBeVisible()

    // Persisted server-side, not just in local state.
    const res = await page.request.get(`${API}/habits`)
    const [habit] = await res.json()
    expect(habit.name).toBe('Stretch daily')
  })

  test('deleting a habit requires confirmation through ConfirmDeleteModal', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/habits')
    await createHabit(page, 'Temporary habit')
    await page.reload()

    const card = page.getByTestId('habit-card').filter({ hasText: 'Temporary habit' })
    await card.getByRole('button', { name: 'Habit options' }).click()
    await card.getByRole('menuitem', { name: 'Delete' }).click()

    const dialog = page.getByRole('heading', { name: 'Delete habit?' })
    await expect(dialog).toBeVisible()

    // Cancel leaves the habit untouched.
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).not.toBeVisible()
    await expect(card).toBeVisible()

    // Confirming deletes it.
    await card.getByRole('button', { name: 'Habit options' }).click()
    await card.getByRole('menuitem', { name: 'Delete' }).click()
    await page.getByTestId('habit-delete-confirm-btn').click()
    await expect(card).not.toBeVisible()
  })

  test('archiving moves a habit into the lazily-loaded Archived section, and Restore brings it back', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, '/tasks/habits')
    await createHabit(page, 'Archive me')
    await page.reload()

    const archivedToggle = page.getByTestId('habits-archived-toggle')
    // Collapsed by default, no count shown until expanded (the default
    // GET /habits call excludes archived habits, so there is no count to
    // show honestly before that fetch happens).
    await expect(archivedToggle).toHaveText('Archived')

    const card = page.getByTestId('habit-card').filter({ hasText: 'Archive me' })
    await card.getByRole('button', { name: 'Habit options' }).click()
    await card.getByRole('menuitem', { name: 'Archive' }).click()
    await expect(card).not.toBeVisible()

    await archivedToggle.click()
    await expect(archivedToggle).toHaveText('Archived (1)')
    const archivedRow = page.getByTestId('habit-archived-row').filter({ hasText: 'Archive me' })
    await expect(archivedRow).toBeVisible()

    await archivedRow.getByRole('button', { name: 'Restore Archive me' }).click()
    await expect(archivedRow).not.toBeVisible()
    await expect(page.getByTestId('habit-card').filter({ hasText: 'Archive me' })).toBeVisible()
  })

  test("today's due-but-not-yet-kept dot is its own state, not a miss", async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/habits')
    await createHabit(page, 'Undecided today')
    await page.reload()
    const today = businessToday()

    const dot = page.getByTestId('habit-card').filter({ hasText: 'Undecided today' }).getByTestId(`habit-grid-day-${today}`)
    await expect(dot).not.toHaveClass(/\bmiss\b/)
    await expect(dot).toHaveClass(/today-pending/)
    await expect(dot).toHaveAttribute('aria-pressed', 'false')

    // Ticking it moves it out of the pending state entirely.
    await dot.click()
    await expect(dot).toHaveClass(/\bon\b/)
    await expect(dot).not.toHaveClass(/today-pending/)
    await expect(dot).toHaveAttribute('aria-pressed', 'true')
  })

  test('the dot grid carries aria-pressed and a weekday+date aria-label', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/habits')
    await createHabit(page, 'Labelled habit')
    await page.reload()
    const today = businessToday()

    const dot = page.getByTestId('habit-card').filter({ hasText: 'Labelled habit' }).getByTestId(`habit-grid-day-${today}`)
    await expect(dot).toHaveAttribute('role', 'button')
    await expect(dot).toHaveAttribute('aria-pressed', 'false')
    const label = await dot.getAttribute('aria-label')
    expect(label).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Za-z]{3} — /)
  })

  test('the create/edit modal\'s colour swatches and schedule days carry aria-pressed and descriptive labels', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, '/tasks/habits')
    await page.getByTestId('habit-new-btn').click()

    const monday = page.getByTestId('habit-schedule-day-1')
    await expect(monday).toHaveAttribute('aria-label', 'Monday')
    await expect(monday).toHaveAttribute('aria-pressed', 'true')
    await monday.click()
    await expect(monday).toHaveAttribute('aria-pressed', 'false')

    const firstSwatch = page.getByRole('button', { name: 'Colour #10b981' })
    await expect(firstSwatch).toHaveAttribute('aria-pressed', 'true')
  })
})
