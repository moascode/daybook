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

  test('Balance the week card shows candidates and a single Move applies just that task', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const monday = businessWeekMonday()
    const tuesday = addDaysIso(monday, 1)
    const friday = addDaysIso(monday, 4)

    // Three tasks on Tuesday; one each on every other day except Friday, so
    // Friday is the SOLE quietest day — the board's tie-break for "quietest"
    // keeps the first zero-count day in week order, so leaving more than one
    // day at zero would make the target ambiguous and this assertion flaky
    // by construction, not by the app's behaviour.
    let firstTuesdayTaskId = ''
    for (const content of ['Tue task 1', 'Tue task 2', 'Tue task 3']) {
      const res = await page.request.post(`${API}/tasks`, { data: { content, dueDate: tuesday } })
      const task = await res.json()
      if (!firstTuesdayTaskId) firstTuesdayTaskId = task.id
    }
    for (const [label, offset] of [['Mon', 0], ['Wed', 2], ['Thu', 3], ['Sat', 5], ['Sun', 6]] as const) {
      await page.request.post(`${API}/tasks`, {
        data: { content: `${label} filler`, dueDate: addDaysIso(monday, offset) },
      })
    }

    await page.goto('/tasks/upcoming')
    await expect(page.getByTestId(`upcoming-day-count-${tuesday}`)).toHaveText('3')
    await expect(page.getByTestId(`upcoming-day-count-${friday}`)).toHaveText('0')

    // FEAT-057: the card shows itself automatically (gap >= 2, no button
    // click needed) with one candidate row per task (floor(gap/2) of them),
    // each independently movable — not a single confirm/cancel batch.
    const card = page.getByTestId('upcoming-balance-card')
    await expect(card).toBeVisible()
    await expect(card).toContainText('Tuesday')
    await expect(card).toContainText('Friday')

    const moveBtn = page.getByTestId(`upcoming-balance-move-${firstTuesdayTaskId}`)
    await expect(moveBtn).toBeVisible()
    await moveBtn.click()

    await expect(page.getByTestId(`upcoming-day-count-${tuesday}`)).toHaveText('2')
    await expect(page.getByTestId(`upcoming-day-count-${friday}`)).toHaveText('1')

    // Same persistence check as the DatePicker-schedule test above: confirm
    // the balance move survives a reload, not just the optimistic local state.
    await page.reload()
    await expect(page.getByTestId(`upcoming-day-count-${tuesday}`)).toHaveText('2')
    await expect(page.getByTestId(`upcoming-day-count-${friday}`)).toHaveText('1')

    // Week is now within 1 of itself everywhere plausible for this seed
    // (gap between the new max and min may still be >= 2 depending on the
    // filler counts) — rather than asserting a specific hide/show state here
    // (fragile against the exact seed shape), the card's continued presence
    // or absence is exactly `canBalance`, already covered structurally by
    // the initial appearance assertion above; a dedicated hide-when-balanced
    // case is covered by the next test.
  })

  test('Balance the week card is absent when the week is already even', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const monday = businessWeekMonday()

    // One task per day — gap is 0, well under the canBalance >= 2 threshold.
    for (const offset of [0, 1, 2, 3, 4, 5, 6]) {
      await page.request.post(`${API}/tasks`, {
        data: { content: `Day ${offset} task`, dueDate: addDaysIso(monday, offset) },
      })
    }

    await page.goto('/tasks/upcoming')
    await expect(page.getByTestId('upcoming-day-count-' + monday)).toHaveText('1')
    await expect(page.getByTestId('upcoming-balance-card')).not.toBeVisible()
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

  test('FEAT-057: composer task with no date word lands in Waiting for a date, not a day column', async ({
    browser,
  }) => {
    // Deliberate INVERSE of Today's BUG-009 default-to-today — this page's
    // composer must NOT force an undated task into any day. Zero test
    // coverage existed for this before, so a future "make Upcoming
    // consistent with Today" refactor could silently break it.
    const page = await newAppPage(browser, '/tasks')
    await page.goto('/tasks/upcoming')

    const composer = page.getByRole('textbox', { name: 'Add a task', exact: true })
    await composer.fill('Read the quarterly report')
    await composer.press('Enter')
    await expect(composer).toHaveValue('')

    const waiting = page.getByTestId('upcoming-waiting-section')
    await expect(waiting).toContainText('Read the quarterly report')

    const monday = businessWeekMonday()
    for (let i = 0; i < 7; i++) {
      await expect(page.getByTestId(`upcoming-day-column-${addDaysIso(monday, i)}`)).not.toContainText(
        'Read the quarterly report',
      )
    }
  })

  test('FEAT-057: composer task with a parsed date lands in the correct day column', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    await page.goto('/tasks/upcoming')

    const composer = page.getByRole('textbox', { name: 'Add a task', exact: true })
    await composer.fill('Call the plumber tomorrow')
    await composer.press('Enter')
    await expect(composer).toHaveValue('')

    const tomorrow = addDaysIso(businessToday(), 1)
    await expect(page.getByTestId(`upcoming-day-column-${tomorrow}`)).toContainText('Call the plumber')
  })

  test('FEAT-057: summary line shows correct scheduled/waiting counts', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const monday = businessWeekMonday()
    const tuesday = addDaysIso(monday, 1)
    const wednesday = addDaysIso(monday, 2)

    for (const content of ['Dated task A', 'Dated task B']) {
      await page.request.post(`${API}/tasks`, { data: { content, dueDate: tuesday } })
    }
    await page.request.post(`${API}/tasks`, { data: { content: 'Dated task C', dueDate: wednesday } })
    for (const content of ['Undated task A', 'Undated task B', 'Undated task C']) {
      await page.request.post(`${API}/tasks`, { data: { content } })
    }

    await page.goto('/tasks/upcoming')

    await expect(page.getByTestId('upcoming-summary-line')).toHaveText('3 scheduled, 3 waiting for a date')
  })

  test('FEAT-057: Hard deadlines and Recurring band-stat cards show correct counts', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const monday = businessWeekMonday()
    const tuesday = addDaysIso(monday, 1)
    const wednesday = addDaysIso(monday, 2)

    await page.request.post(`${API}/tasks`, { data: { content: 'Pay the insurance', dueDate: tuesday } })
    await page.request.post(`${API}/tasks`, {
      data: { content: 'Take out the trash', dueDate: wednesday, recurrence: 'weekly' },
    })

    await page.goto('/tasks/upcoming')

    const hardDeadlines = page.getByTestId('upcoming-stat-hard-deadlines')
    await expect(hardDeadlines).toContainText('1')
    await expect(hardDeadlines).toContainText('Pay the insurance')

    const recurring = page.getByTestId('upcoming-stat-recurring')
    await expect(recurring).toContainText('1')
    await expect(recurring).toContainText('Take out the trash')
  })

  test('FEAT-057: band-stats card hides on a genuinely empty week', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    await page.goto('/tasks/upcoming')

    await expect(page.getByTestId('upcoming-band-stats')).not.toBeVisible()
  })

  test('BUG-013: a Waiting-for-a-date row keeps its date input usable at a narrow viewport', async ({ browser }) => {
    // WaitingRow (this page) shares the `.task` CSS grid with
    // TaskListRow.tsx, but renders 3 bare children (no `.task-name`/
    // `.task-meta` wrappers) — same shared-class risk as TaskRow.tsx on the
    // Today page (see e2e/69-tasks-today.spec.ts's BUG-013 test). The
    // ≤900px rule tasks.css added for TaskListRow is scoped to
    // `.task:has(.task-meta)` so it can't catch this row too; without that
    // scoping the native date input (the 3rd child) would auto-place into
    // the checkbox's own 20px track instead of getting its own row.
    const page = await newAppPage(browser, '/tasks')
    await page.request.post(`${API}/tasks`, { data: { content: 'A reasonably long waiting-for-a-date task name' } })
    await page.goto('/tasks/upcoming')

    const waiting = page.getByTestId('upcoming-waiting-section')
    await expect(waiting).toContainText('A reasonably long waiting-for-a-date task name')
    const row = waiting.locator('.task').filter({ hasText: 'A reasonably long waiting-for-a-date task name' })

    // Both a mid-width (700px, matches e2e/92's BUG-013 case) and a real
    // phone width (375px) — the overflow this guards was only measured at
    // narrower row content-box widths, which 700px alone doesn't reach.
    for (const width of [700, 375]) {
      await page.setViewportSize({ width, height: 900 })
      const rowBox = await row.boundingBox()
      const titleBox = await row.locator('.task-title').boundingBox()
      const dateInputBox = await row.locator('input[type="date"]').boundingBox()
      expect(rowBox).not.toBeNull()
      expect(titleBox).not.toBeNull()
      expect(dateInputBox).not.toBeNull()
      // A usable native date input needs meaningfully more than the 20px
      // checkbox track it would be squeezed into if the grid mis-placed it.
      expect(titleBox!.width).toBeGreaterThan(80)
      expect(dateInputBox!.width).toBeGreaterThan(60)
      expect(dateInputBox!.x).toBeGreaterThan(titleBox!.x)
      // The regression this most recently caught wasn't a squeeze but an
      // overflow — the date input rendering past the row's own right edge
      // instead of being constrained by it.
      expect(dateInputBox!.x + dateInputBox!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width + 1)
    }
  })
})
