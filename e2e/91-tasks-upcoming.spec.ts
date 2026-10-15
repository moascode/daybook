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
import { format, parseISO } from 'date-fns'
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

    const task = await (await page.request.post(`${API}/tasks`, { data: { content: 'Someday task' } })).json()
    await page.goto('/tasks/upcoming')

    const waiting = page.getByTestId('upcoming-waiting-section')
    await expect(waiting).toContainText('Someday task')

    // The relative column is a "Schedule" trigger (FEAT-057 mockup) that
    // reveals the inline date input, rather than an always-visible picker.
    await page.getByTestId(`upcoming-schedule-trigger-${task.id}`).click()
    const dateInput = page.getByTestId(`upcoming-schedule-${task.id}`)
    await dateInput.fill(thursday)
    await dateInput.press('Enter')

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
    const today = businessToday()

    // Balancing only ever considers today-or-later days (TasksUpcomingPage.tsx's
    // `openDays` filter — a day that's already gone can't take a task, so it's
    // never the busiest OR the quietest candidate). Fixed Tuesday/Friday
    // offsets only produced a meaningful scenario when "today" fell on or
    // before Tuesday; pick the busiest/quietest pair from the days that are
    // actually still open THIS week instead of hardcoding them.
    let todayOffset = 0
    for (let i = 0; i < 7; i++) {
      if (addDaysIso(monday, i) === today) {
        todayOffset = i
        break
      }
    }
    const openOffsets = [0, 1, 2, 3, 4, 5, 6].filter((i) => i >= todayOffset)
    // Needs the busiest day, the quietest day, AND at least one filler day in
    // between so the quietest is unambiguous (every other open day nonzero) —
    // fewer than 3 open days this week (today is Fri/Sat/Sun) can't build that
    // without ambiguity, so skip rather than assert something flaky by
    // construction, not by the app's behaviour.
    test.skip(openOffsets.length < 3, 'Needs at least 3 open (today-or-later) days this week')

    const busiestOffset = openOffsets[0]
    const quietestOffset = openOffsets[openOffsets.length - 1]
    const fillerOffsets = openOffsets.slice(1, -1)
    const busiest = addDaysIso(monday, busiestOffset)
    const quietest = addDaysIso(monday, quietestOffset)

    // Three tasks on the busiest day; one each on every OTHER open day except
    // the quietest, so the quietest is the SOLE zero-count day — the board's
    // tie-break for "quietest" keeps the first zero-count day in week order,
    // so leaving more than one day at zero would make the target ambiguous.
    let firstBusiestTaskId = ''
    for (const content of ['Busy task 1', 'Busy task 2', 'Busy task 3']) {
      const res = await page.request.post(`${API}/tasks`, { data: { content, dueDate: busiest } })
      const task = await res.json()
      if (!firstBusiestTaskId) firstBusiestTaskId = task.id
    }
    for (const offset of fillerOffsets) {
      await page.request.post(`${API}/tasks`, {
        data: { content: `Filler ${offset}`, dueDate: addDaysIso(monday, offset) },
      })
    }

    await page.goto('/tasks/upcoming')
    await expect(page.getByTestId(`upcoming-day-count-${busiest}`)).toHaveText('3')
    await expect(page.getByTestId(`upcoming-day-count-${quietest}`)).toHaveText('0')

    // FEAT-057: the card shows itself automatically (gap >= 2, no button
    // click needed) with one candidate row per task (floor(gap/2) of them),
    // each independently movable — not a single confirm/cancel batch.
    const card = page.getByTestId('upcoming-balance-card')
    await expect(card).toBeVisible()
    const busiestName = format(parseISO(busiest), 'EEEE')
    const quietestName = format(parseISO(quietest), 'EEEE')
    await expect(card).toContainText(busiestName)
    await expect(card).toContainText(quietestName)

    const moveBtn = page.getByTestId(`upcoming-balance-move-${firstBusiestTaskId}`)
    await expect(moveBtn).toBeVisible()
    await moveBtn.click()

    await expect(page.getByTestId(`upcoming-day-count-${busiest}`)).toHaveText('2')
    await expect(page.getByTestId(`upcoming-day-count-${quietest}`)).toHaveText('1')

    // Same persistence check as the DatePicker-schedule test above: confirm
    // the balance move survives a reload, not just the optimistic local state.
    await page.reload()
    await expect(page.getByTestId(`upcoming-day-count-${busiest}`)).toHaveText('2')
    await expect(page.getByTestId(`upcoming-day-count-${quietest}`)).toHaveText('1')

    // Week is now within 1 of itself everywhere plausible for this seed
    // (gap between the new max and min may still be >= 2 depending on the
    // filler counts) — rather than asserting a specific hide/show state here
    // (fragile against the exact seed shape), the card's continued presence
    // or absence is exactly `canBalance`, already covered structurally by
    // the initial appearance assertion above; a dedicated hide-when-balanced
    // case is covered by the next test.
  })

  test('Balance the week card shows a calm message when the week is already even', async ({ browser }) => {
    // The card is now always present (FEAT-057 mockup) — it no longer hides
    // outright when there's nothing to move, it shows a calm state instead.
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
    await expect(page.getByTestId('upcoming-balance-card')).toBeVisible()
    await expect(page.getByTestId('upcoming-balance-calm')).toHaveText('This week is balanced.')
    await expect(page.getByTestId('upcoming-balance-card')).not.toContainText('Move')
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

  test('a Waiting for a date task can be dragged onto a day', async ({ browser }) => {
    // The waiting list used to sit outside the board's DndContext, so an
    // undated task could only be dated through its picker.
    const page = await newAppPage(browser, '/tasks')
    const wednesday = addDaysIso(businessWeekMonday(), 2)

    const task = await (await page.request.post(`${API}/tasks`, { data: { content: 'Dragged from waiting' } })).json()
    await page.goto('/tasks/upcoming')

    const row = page.getByTestId(`upcoming-waiting-row-${task.id}`)
    await expect(row).toBeVisible()
    await expect(page.getByTestId(`upcoming-day-count-${wednesday}`)).toHaveText('0')

    const column = page.getByTestId(`upcoming-day-column-${wednesday}`)
    const from = await row.boundingBox()
    const to = await column.boundingBox()
    if (!from || !to) throw new Error('Expected the row and the column to have a layout box')

    // A nudge past the 8px activation distance, released over the waiting
    // list itself, must not schedule it onto whichever day is nearest.
    await page.mouse.move(from.x + 40, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + 60, from.y + from.height / 2, { steps: 5 })
    await page.mouse.up()
    await expect(row).toBeVisible()
    await expect(page.getByTestId(`upcoming-day-count-${wednesday}`)).toHaveText('0')

    // The real drag. `page.mouse.*` drives Chrome's native OS-level input
    // pipeline, and in this headless environment that consistently lost a
    // race to the browser's own native text-selection gesture instead of
    // ever engaging dnd-kit's PointerSensor — confirmed with an isolated
    // repro outside this suite: a mousedown-then-steps-interpolated-move
    // over the row never set dnd-kit's `isDragging` state, `getSelection()`
    // showed an active selection instead, and no amount of pacing (manual
    // per-step pauses, a bigger step count, a small lead-in move before the
    // jump, waiting on the target's hover ring before releasing) closed that
    // race — every variant above was tried and still lost it. Dispatching
    // the same pointerdown/pointermove/pointerup sequence a real drag
    // produces, but as DOM events (bypassing Chrome's native mouse pipeline
    // entirely), exercises the exact same dnd-kit listeners a real user's
    // drag does without competing against the browser's own selection
    // handling — and is what the isolated repro confirmed actually works,
    // once the final move is given a real animation-frame tick to let
    // dnd-kit's (React-state-driven, rAF-gated) collision detection register
    // the drop target before release — same root cause `page.mouse`'s lack
    // of inter-event yield ran into.
    await page.evaluate(
      ({ fromX, fromY, toX, toY }) => {
        function fire(type: string, el: Element | Document, x: number, y: number, buttons: number) {
          const ev = new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: x,
            clientY: y,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
            button: 0,
            buttons,
          })
          el.dispatchEvent(ev)
        }
        const row = document.querySelector<HTMLElement>('[data-testid^="upcoming-waiting-row-"]')
        if (!row) throw new Error('waiting row not found')
        fire('pointermove', row, fromX, fromY, 0)
        fire('pointerdown', row, fromX, fromY, 1)
        const steps = 15
        for (let i = 1; i <= steps; i++) {
          const x = fromX + ((toX - fromX) * i) / steps
          const y = fromY + ((toY - fromY) * i) / steps
          fire('pointermove', document, x, y, 1)
        }
        return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      },
      { fromX: from.x + 40, fromY: from.y + from.height / 2, toX: to.x + to.width / 2, toY: to.y + to.height / 2 },
    )
    // The column's own hover-state ring class is the real signal that the
    // drop target registered — proof the drag actually engaged, not just
    // that the pointer passed over it.
    await expect(column).toHaveClass(/ring-2/)
    await page.evaluate(({ toX, toY }) => {
      document.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: toX,
          clientY: toY,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          buttons: 0,
        }),
      )
    }, { toX: to.x + to.width / 2, toY: to.y + to.height / 2 })

    await expect(page.getByTestId(`upcoming-day-count-${wednesday}`)).toHaveText('1')
    await expect(page.getByTestId(`upcoming-card-${task.id}`)).toContainText('Dragged from waiting')
    await expect(row).toHaveCount(0)

    await page.reload()
    await expect(page.getByTestId(`upcoming-card-${task.id}`)).toBeVisible()
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
    // Deliberately uses "today", not "tomorrow": the board is the CURRENT
    // Mon→Sun week (by design, see TasksUpcomingPage.tsx's header comment),
    // so "tomorrow" only lands in a visible column on six days out of seven
    // — on a Sunday it resolves to next Monday, outside this week's board
    // entirely, which made this test fail every Sunday (not a flake: it
    // reproduced locally on 2026-10-11, a Sunday). "today" always falls
    // inside the displayed week by construction, and the date-word parser
    // itself (including "tomorrow"'s +1-day arithmetic) is already pinned
    // deterministically in parseTaskComposerInput.test.ts — this e2e test's
    // job is only to prove the parsed date lands in the matching day
    // column, which "today" exercises just as well.
    const page = await newAppPage(browser, '/tasks')
    await page.goto('/tasks/upcoming')

    const composer = page.getByRole('textbox', { name: 'Add a task', exact: true })
    await composer.fill('Call the plumber today')
    await composer.press('Enter')
    await expect(composer).toHaveValue('')

    const today = businessToday()
    await expect(page.getByTestId(`upcoming-day-column-${today}`)).toContainText('Call the plumber')
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
    // Hard deadline = a specific time OR high priority (owner-approved
    // definition) — a bare dated task with neither doesn't count, so this
    // seeds one of each to prove the stat isn't just "has a due date".
    const page = await newAppPage(browser, '/tasks')
    const monday = businessWeekMonday()
    const tuesday = addDaysIso(monday, 1)
    const wednesday = addDaysIso(monday, 2)
    const thursday = addDaysIso(monday, 3)

    await page.request.post(`${API}/tasks`, {
      data: { content: 'Pay the insurance', dueDate: tuesday, dueTime: '09:00' },
    })
    await page.request.post(`${API}/tasks`, {
      data: { content: 'Review the lease', dueDate: thursday, priority: 'high' },
    })
    await page.request.post(`${API}/tasks`, { data: { content: 'Water the plants', dueDate: wednesday } })
    await page.request.post(`${API}/tasks`, {
      data: { content: 'Take out the trash', dueDate: wednesday, recurrence: 'weekly' },
    })

    await page.goto('/tasks/upcoming')

    const hardDeadlines = page.getByTestId('upcoming-stat-hard-deadlines')
    await expect(hardDeadlines).toContainText('2')
    await expect(hardDeadlines).toContainText('Pay the insurance')
    await expect(hardDeadlines).toContainText('Review the lease')
    await expect(hardDeadlines).not.toContainText('Water the plants')

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
    // WaitingRow now shares AllTasksRow.tsx's `.task.task--cols` fixed-column
    // grid (chore/tasks-row-base) rather than the bare 3-track `.task` grid
    // this test originally guarded — the task-when-edit span (grid-column
    // 3/6) is the same proven mechanism AllTasksRow already relies on. The
    // date input itself is now revealed by the "Schedule" trigger rather
    // than always mounted.
    const page = await newAppPage(browser, '/tasks')
    const task = await (
      await page.request.post(`${API}/tasks`, { data: { content: 'A reasonably long waiting-for-a-date task name' } })
    ).json()
    await page.goto('/tasks/upcoming')

    const waiting = page.getByTestId('upcoming-waiting-section')
    await expect(waiting).toContainText('A reasonably long waiting-for-a-date task name')
    const row = page.getByTestId(`upcoming-waiting-row-${task.id}`)
    await page.getByTestId(`upcoming-schedule-trigger-${task.id}`).click()

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

  test('FEAT-057: week navigation shifts Monday ±7 days and "This week" returns to it', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const monday = businessWeekMonday()
    const nextMonday = addDaysIso(monday, 7)

    await page.goto('/tasks/upcoming')
    await expect(page.getByTestId(`upcoming-day-column-${monday}`)).toBeVisible()
    await expect(page.getByTestId('upcoming-week-this')).toBeDisabled()

    await page.getByTestId('upcoming-week-next').click()
    await expect(page.getByTestId(`upcoming-day-column-${nextMonday}`)).toBeVisible()
    await expect(page.getByTestId(`upcoming-day-column-${monday}`)).not.toBeVisible()
    await expect(page.getByTestId('upcoming-week-this')).toBeEnabled()

    await page.getByTestId('upcoming-week-prev').click()
    await expect(page.getByTestId(`upcoming-day-column-${monday}`)).toBeVisible()
    await expect(page.getByTestId('upcoming-week-this')).toBeDisabled()

    await page.getByTestId('upcoming-week-prev').click()
    const prevMonday = addDaysIso(monday, -7)
    await expect(page.getByTestId(`upcoming-day-column-${prevMonday}`)).toBeVisible()
    await expect(page.getByTestId('upcoming-week-this')).toBeEnabled()

    await page.getByTestId('upcoming-week-this').click()
    await expect(page.getByTestId(`upcoming-day-column-${monday}`)).toBeVisible()
    await expect(page.getByTestId('upcoming-week-this')).toBeDisabled()
  })

  test('FEAT-057: a timed board card shows "HH:MM · List" meta', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const monday = businessWeekMonday()
    const wednesday = addDaysIso(monday, 2)

    const task = await (
      await page.request.post(`${API}/tasks`, {
        data: { content: 'Confirm rent cleared', dueDate: wednesday, dueTime: '09:00' },
      })
    ).json()

    await page.goto('/tasks/upcoming')
    await expect(page.getByTestId(`upcoming-card-${task.id}`)).toContainText('09:00 · Unsorted')
  })

  test('FEAT-057: a waiting row can be completed directly', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const task = await (await page.request.post(`${API}/tasks`, { data: { content: 'Take out the recycling' } })).json()
    await page.goto('/tasks/upcoming')

    const row = page.getByTestId(`upcoming-waiting-row-${task.id}`)
    await expect(row).toBeVisible()
    await row.getByLabel('Mark complete').click()
    await expect(row).toHaveCount(0)
    await expect(page.getByTestId('upcoming-waiting-section')).not.toContainText('Take out the recycling')
  })

  test('FEAT-057: Auto-schedule into the gaps places every undated task on a day this week or later', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, '/tasks')
    for (const content of ['Research standing desks', 'Plan the Japan itinerary', 'Sort the loft']) {
      await page.request.post(`${API}/tasks`, { data: { content } })
    }

    await page.goto('/tasks/upcoming')
    await expect(page.getByTestId('upcoming-waiting-section')).toContainText('3 tasks with nowhere to go')

    await page.getByTestId('upcoming-auto-schedule').click()

    await expect(page.getByTestId('toast')).toContainText(/Scheduled 3 tasks/)
    await expect(page.getByTestId('upcoming-waiting-section')).toContainText('Nothing is waiting on a date.')

    // Persists — not just the optimistic local state.
    await page.reload()
    await expect(page.getByTestId('upcoming-waiting-section')).toContainText('Nothing is waiting on a date.')
  })

  test('FEAT-057: "Waiting for a date" pages at 8 with a "Show all" button', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    for (let i = 1; i <= 9; i++) {
      await page.request.post(`${API}/tasks`, { data: { content: `Undated task ${i}` } })
    }

    await page.goto('/tasks/upcoming')
    await expect(page.getByTestId('upcoming-waiting-showing')).toHaveText('Showing 8 of 9')

    const showAll = page.getByTestId('upcoming-waiting-show-all')
    await expect(showAll).toBeVisible()
    await showAll.click()

    await expect(page.getByTestId('upcoming-waiting-showing')).toHaveText('Showing 9 of 9')
    await expect(page.getByTestId('upcoming-waiting-show-all')).toHaveCount(0)
  })
})
