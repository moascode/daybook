/**
 * FEAT-026 — Tasks: Upcoming week board (`/tasks/upcoming`).
 *
 * Covers: the 7-column week board renders, a seeded due-date task lands in
 * its day column, an undated task appears in "Waiting for a date" and moves
 * out once scheduled via its inline DatePicker, Balance the week proposes
 * and applies a move between the busiest and quietest day, and the
 * dashed-border Add affordance creates a task on an empty day.
 */

import { test, expect } from '@playwright/test'
import { newAppPage, businessToday } from './helpers'

const API = '/api'

/** Monday of the current week, in the app's business timezone — mirrors the
 *  page's own `startOfWeek(new Date(), { weekStartsOn: 1 })` computation, but
 *  derived from `businessToday()` (a string) so the spec never calls
 *  `toISOString()` or reads the host clock (CLAUDE.md §3 Tests trap 1). */
function businessWeekMonday(): string {
  const today = businessToday()
  const [y, m, d] = today.split('-').map(Number)
  // Date.UTC keeps this a pure calendar computation — no local/UTC skew risk
  // since we only ever read back the calendar fields, never a UTC clock time.
  const asUtc = new Date(Date.UTC(y, m - 1, d))
  const dow = asUtc.getUTCDay() === 0 ? 7 : asUtc.getUTCDay() // Mon=1..Sun=7
  asUtc.setUTCDate(asUtc.getUTCDate() - (dow - 1))
  return asUtc.toISOString().slice(0, 10)
}

function addDaysIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split('-').map(Number)
  const asUtc = new Date(Date.UTC(y, m - 1, d))
  asUtc.setUTCDate(asUtc.getUTCDate() + days)
  return asUtc.toISOString().slice(0, 10)
}

test.describe('91 — Tasks upcoming week board', () => {
  test('page loads with 7 day columns', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    await page.getByTestId('nav-tasks-upcoming').click()
    await expect(page).toHaveURL(/\/tasks\/upcoming$/)

    const monday = businessWeekMonday()
    for (let i = 0; i < 7; i++) {
      await expect(page.getByTestId(`upcoming-day-column-${addDaysIso(monday, i)}`)).toBeVisible()
    }
  })

  test('a task due this week appears in its day column', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const monday = businessWeekMonday()
    const wednesday = addDaysIso(monday, 2)

    const res = await page.request.post(`${API}/tasks`, {
      data: { content: 'Submit report', dueDate: wednesday },
    })
    const task = await res.json()

    await page.goto('/tasks/upcoming')

    await expect(page.getByTestId(`upcoming-day-count-${wednesday}`)).toHaveText('1')
    await expect(page.getByTestId(`upcoming-card-${task.id}`)).toContainText('Submit report')
  })

  test('an undated task appears in Waiting for a date and moves out once scheduled', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const monday = businessWeekMonday()
    const thursday = addDaysIso(monday, 3)

    await page.request.post(`${API}/tasks`, { data: { content: 'Someday task' } })
    await page.goto('/tasks/upcoming')

    const waiting = page.getByTestId('upcoming-waiting-section')
    await expect(waiting).toContainText('Someday task')

    const row = waiting.locator('.task').filter({ hasText: 'Someday task' })
    await row.getByLabel(/Schedule Someday task/).fill(thursday)

    await expect(waiting).not.toContainText('Someday task')
    await expect(page.getByTestId(`upcoming-day-count-${thursday}`)).toHaveText('1')

    // Regression check for the bug where this page's due-date writes went
    // through `updateTask` (a no-op on a cold load, since this page never
    // populates the Zustand store `updateTask` checks) instead of
    // `rescheduleTasks` — the move looked successful from the optimistic
    // local state alone but was never actually persisted. Reloading forces a
    // fresh fetch, so this only passes if the PATCH/POST actually landed.
    await page.reload()
    const waitingAfterReload = page.getByTestId('upcoming-waiting-section')
    await expect(waitingAfterReload).not.toContainText('Someday task')
    await expect(page.getByTestId(`upcoming-day-count-${thursday}`)).toHaveText('1')
  })

  test('Balance the week proposes and applies a move from the busiest to the quietest day', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const monday = businessWeekMonday()
    const tuesday = addDaysIso(monday, 1)
    const friday = addDaysIso(monday, 4)

    // Three tasks on Tuesday; one each on every other day except Friday, so
    // Friday is the SOLE quietest day — the board's tie-break for "quietest"
    // keeps the first zero-count day in week order, so leaving more than one
    // day at zero would make the target ambiguous and this assertion flaky
    // by construction, not by the app's behaviour.
    for (const content of ['Tue task 1', 'Tue task 2', 'Tue task 3']) {
      await page.request.post(`${API}/tasks`, { data: { content, dueDate: tuesday } })
    }
    for (const [label, offset] of [['Mon', 0], ['Wed', 2], ['Thu', 3], ['Sat', 5], ['Sun', 6]] as const) {
      await page.request.post(`${API}/tasks`, {
        data: { content: `${label} filler`, dueDate: addDaysIso(monday, offset) },
      })
    }

    await page.goto('/tasks/upcoming')
    await expect(page.getByTestId(`upcoming-day-count-${tuesday}`)).toHaveText('3')
    await expect(page.getByTestId(`upcoming-day-count-${friday}`)).toHaveText('0')

    const balanceBtn = page.getByTestId('upcoming-balance-week')
    await expect(balanceBtn).toBeEnabled()
    await balanceBtn.click()

    const proposal = page.getByTestId('upcoming-balance-proposal')
    await expect(proposal).toBeVisible()
    await expect(proposal).toContainText('Move')

    await page.getByTestId('upcoming-balance-confirm').click()
    await expect(proposal).not.toBeVisible()

    await expect(page.getByTestId(`upcoming-day-count-${tuesday}`)).toHaveText('2')
    await expect(page.getByTestId(`upcoming-day-count-${friday}`)).toHaveText('1')

    // Same persistence check as the DatePicker-schedule test above: confirm
    // the balance move survives a reload, not just the optimistic local state.
    await page.reload()
    await expect(page.getByTestId(`upcoming-day-count-${tuesday}`)).toHaveText('2')
    await expect(page.getByTestId(`upcoming-day-count-${friday}`)).toHaveText('1')
  })

  test('the dashed Add affordance creates a task on an empty day', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    await page.goto('/tasks/upcoming')

    const monday = businessWeekMonday()
    const saturday = addDaysIso(monday, 5)

    await expect(page.getByTestId(`upcoming-day-count-${saturday}`)).toHaveText('0')

    const addAffordance = page.getByTestId(`upcoming-add-day-${saturday}`)
    await addAffordance.click()

    const input = page.getByTestId(`upcoming-add-day-${saturday}`)
    await input.fill('Weekend errand')
    await input.press('Enter')

    await expect(page.getByTestId(`upcoming-day-column-${saturday}`)).toContainText('Weekend errand')
    await expect(page.getByTestId(`upcoming-day-count-${saturday}`)).toHaveText('1')
  })

  test('keyboard drag-and-drop moves a card to the next day and persists', async ({ browser }) => {
    // dnd-kit's KeyboardSensor is already wired (`useSensor(KeyboardSensor)`),
    // so this drives handleDragEnd without a flaky pointer-drag simulation:
    // focus the card, Space to pick up, ArrowRight to move, Space to drop.
    // dnd-kit's default keyboard coordinate getter steps a fixed 25px per
    // press, but the column pitch is a layout detail (nav width, content
    // max-width, grid gaps) that can change — a hardcoded press count would
    // silently start over- or under-shooting into the wrong column with no
    // warning. Measure the actual pitch between Monday's and Tuesday's
    // columns and derive the press count from it instead.
    const page = await newAppPage(browser, '/tasks')
    const monday = businessWeekMonday()
    const tuesday = addDaysIso(monday, 1)

    const res = await page.request.post(`${API}/tasks`, {
      data: { content: 'Keyboard-dragged task', dueDate: monday },
    })
    const task = await res.json()

    await page.goto('/tasks/upcoming')
    await expect(page.getByTestId(`upcoming-day-count-${monday}`)).toHaveText('1')
    await expect(page.getByTestId(`upcoming-day-count-${tuesday}`)).toHaveText('0')

    const KEYBOARD_STEP_PX = 25
    const mondayBox = await page.getByTestId(`upcoming-day-column-${monday}`).boundingBox()
    const tuesdayBox = await page.getByTestId(`upcoming-day-column-${tuesday}`).boundingBox()
    if (!mondayBox || !tuesdayBox) throw new Error('Expected both day columns to have a layout box')
    const columnPitch = tuesdayBox.x - mondayBox.x
    const presses = Math.round(columnPitch / KEYBOARD_STEP_PX)

    const card = page.getByTestId(`upcoming-card-${task.id}`)
    await card.focus()
    await card.press('Space')
    for (let i = 0; i < presses; i++) {
      await card.press('ArrowRight')
    }
    await card.press('Space')

    await expect(page.getByTestId(`upcoming-day-count-${monday}`)).toHaveText('0')
    await expect(page.getByTestId(`upcoming-day-count-${tuesday}`)).toHaveText('1')
    await expect(page.getByTestId(`upcoming-card-${task.id}`)).toContainText('Keyboard-dragged task')

    // Same persistence check as the other mutation paths above.
    await page.reload()
    await expect(page.getByTestId(`upcoming-day-count-${monday}`)).toHaveText('0')
    await expect(page.getByTestId(`upcoming-day-count-${tuesday}`)).toHaveText('1')
  })
})
