/**
 * FEAT-027 — Tasks: Assigned to me and the delegation ledger
 * (docs/backlog/EP-07-tasks-depth/FEAT-027-tasks-assigned-to-me.md).
 *
 * Covers: a task assigned to a second household member shows up in that
 * member's "Waiting on you" section grouped by owner username, an
 * owner's undated assignment to someone else shows the "gone quiet" flag
 * in their "handed out" rail, the inline assignee picker persists an
 * assignment via PATCH, and the turnaround-per-person average both
 * computes correctly and excludes pre-migration rows with a null
 * `assignedAt`.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { businessDatePlus } from './helpers'

const API = '/api'

/**
 * Two users in the same household group — every scenario here needs an
 * owner + an assignee. Built entirely over the API (POST /groups,
 * POST /groups/:id/invites, GET /invites, POST /invites/:id/accept) rather
 * than driving the Sharing UI (as e2e/35-splits.spec.ts does for its
 * two-user setup) — the UI flow is already covered there, and this spec's
 * subject is the assignment ledger, not group creation.
 */
async function createGroupOfTwo(browser: Browser) {
  const ownerCtx = await browser.newContext()
  const assigneeCtx = await browser.newContext()
  const ownerPage = await ownerCtx.newPage()
  const assigneePage = await assigneeCtx.newPage()

  const ownerName = `owner_asn_${Date.now()}`
  const assigneeName = `asnee_asn_${Date.now()}`

  await ownerPage.request.post(`${API}/auth/signup`, { data: { username: ownerName, password: 'test-password' } })
  await assigneePage.request.post(`${API}/auth/signup`, { data: { username: assigneeName, password: 'test-password' } })

  const groupRes = await ownerPage.request.post(`${API}/groups`, { data: { name: 'Assignment Test Household' } })
  const group = await groupRes.json()

  await ownerPage.request.post(`${API}/groups/${group.id}/invites`, { data: { username: assigneeName } })

  const invitesRes = await assigneePage.request.get(`${API}/invites`)
  const invites = await invitesRes.json()
  const invite = invites.find((i: { group_id: string }) => i.group_id === group.id)
  await assigneePage.request.post(`${API}/invites/${invite.id}/accept`)

  await ownerPage.goto('/tasks')
  await assigneePage.goto('/tasks')

  return { ownerPage, assigneePage, ownerName, assigneeName, ownerCtx, assigneeCtx }
}

async function currentUserId(page: Page): Promise<string> {
  const res = await page.request.get(`${API}/auth/me`)
  const { user } = await res.json()
  return user.id
}

test.describe('92 — Tasks assigned to me', () => {
  test('a task assigned to the second user appears in their Waiting on you, grouped by owner', async ({ browser }) => {
    const { ownerPage, assigneePage, ownerName, ownerCtx, assigneeCtx } = await createGroupOfTwo(browser)
    const assigneeId = await currentUserId(assigneePage)

    const taskRes = await ownerPage.request.post(`${API}/tasks`, { data: { content: 'Review the budget draft' } })
    const task = await taskRes.json()
    await ownerPage.request.patch(`${API}/tasks/${task.id}`, { data: { assigneeId } })

    await assigneePage.goto('/tasks/assigned')
    await expect(assigneePage.locator('main')).toBeVisible({ timeout: 20_000 })

    const waitingSection = assigneePage.getByTestId('assigned-waiting-section')
    await expect(waitingSection).toContainText(`Waiting on ${ownerName}`)
    await expect(waitingSection).toContainText('Review the budget draft')

    await ownerCtx.close()
    await assigneeCtx.close()
  })

  test('a completed task drops out of Waiting on you instead of staying forever', async ({ browser }) => {
    // Regression check: GET /tasks?view=assigned originally had no
    // is_completed filter (every other open-work view does), so a task the
    // viewer had already finished stayed listed under "waiting on you" with
    // no way to clear it from this page (its checkbox is a documented no-op
    // here — see handleToggleComplete).
    const { ownerPage, assigneePage, assigneeCtx, ownerCtx } = await createGroupOfTwo(browser)
    const assigneeId = await currentUserId(assigneePage)

    const taskRes = await ownerPage.request.post(`${API}/tasks`, { data: { content: 'Already finished' } })
    const task = await taskRes.json()
    await ownerPage.request.patch(`${API}/tasks/${task.id}`, { data: { assigneeId } })
    await assigneePage.request.post(`${API}/tasks/${task.id}/complete`, {})

    await assigneePage.goto('/tasks/assigned')
    await expect(assigneePage.locator('main')).toBeVisible({ timeout: 20_000 })

    const waitingSection = assigneePage.getByTestId('assigned-waiting-section')
    await expect(waitingSection).not.toContainText('Already finished')
    await expect(assigneePage.getByTestId('assigned-waiting-empty')).toBeVisible()

    await ownerCtx.close()
    await assigneeCtx.close()
  })

  test('an undated assignment shows the gone-quiet flag in the owner\'s handed-out rail', async ({ browser }) => {
    const { ownerPage, assigneePage, ownerCtx, assigneeCtx } = await createGroupOfTwo(browser)
    const assigneeId = await currentUserId(assigneePage)

    const taskRes = await ownerPage.request.post(`${API}/tasks`, { data: { content: 'Sort out the storage unit' } })
    const task = await taskRes.json()
    // No dueDate — this is exactly the "gone quiet" condition (assigned
    // without a date), not related to assignedAt.
    await ownerPage.request.patch(`${API}/tasks/${task.id}`, { data: { assigneeId } })

    await ownerPage.goto('/tasks/assigned')
    await expect(ownerPage.locator('main')).toBeVisible({ timeout: 20_000 })

    const handedOut = ownerPage.getByTestId('assigned-handed-out-section')
    await expect(handedOut).toContainText('Sort out the storage unit')
    await expect(ownerPage.getByTestId(`assigned-gone-quiet-${task.id}`)).toBeVisible()
    await expect(ownerPage.getByTestId(`assigned-gone-quiet-${task.id}`)).toContainText('Gone quiet')

    await ownerCtx.close()
    await assigneeCtx.close()
  })

  test('the assignee picker on the assigned page persists via PATCH and survives reload', async ({ browser }) => {
    const { ownerPage, assigneePage, assigneeName, ownerCtx, assigneeCtx } = await createGroupOfTwo(browser)
    const assigneeId = await currentUserId(assigneePage)

    // Seed an unassigned task the owner will assign through the picker's UI
    // (not the API), so this exercises TaskListRow's <select> onChange path.
    const taskRes = await ownerPage.request.post(`${API}/tasks`, { data: { content: 'Book the venue', dueDate: '2026-12-01' } })
    const task = await taskRes.json()
    // Assign it to the co-member up front so it renders in the handed-out
    // rail (where TaskListRow's picker is actually rendered with coMembers),
    // then reassign to Unassigned via the picker to prove the control writes.
    await ownerPage.request.patch(`${API}/tasks/${task.id}`, { data: { assigneeId } })

    await ownerPage.goto('/tasks/assigned')
    await expect(ownerPage.locator('main')).toBeVisible({ timeout: 20_000 })

    const picker = ownerPage.getByTestId(`task-row-assignee-${task.id}`)
    await expect(picker).toBeVisible()
    await expect(picker).toHaveValue(assigneeId)
    await expect(picker.locator('option', { hasText: assigneeName })).toHaveCount(1)

    // Change it to Unassigned through the picker's own UI — the actual
    // control under test, not the seeding API used above.
    const card = ownerPage.getByTestId('assigned-handed-out-section').locator('.card', { hasText: 'Book the venue' })
    await picker.selectOption('')
    await expect(picker).toHaveValue('')

    // Same-page sync check: onAssigneeChange should update this page's own
    // local state immediately, not just the picker's own draft — without it,
    // the card's "Assigned to X" caption would still show the old assignee
    // (or the whole card would linger in the handed-out rail, since it's no
    // longer assigned to anyone) until a reload.
    await expect(card).not.toBeVisible()
    await expect(ownerPage.getByTestId('assigned-handed-out-empty')).toBeVisible()

    // Persistence check (FEAT-026's review convention, applied here too):
    // reload and re-fetch the task directly, not just re-read the DOM.
    await ownerPage.reload()
    const after = await ownerPage.request.get(`${API}/tasks?view=all`)
    const afterRows = await after.json()
    const persisted = afterRows.find((r: { id: string }) => r.id === task.id)
    expect(persisted.assignee_id).toBeNull()

    await ownerCtx.close()
    await assigneeCtx.close()
  })

  test('turnaround per person averages correctly and excludes rows with a null assignedAt', async ({ browser }) => {
    const { ownerPage, assigneePage, assigneeName, ownerCtx, assigneeCtx } = await createGroupOfTwo(browser)
    const assigneeId = await currentUserId(assigneePage)

    // A completed, assigned task WITH a controllable assignedAt/completedAt
    // gap — POST /tasks accepts assignedAt directly (added in Part 1 for the
    // undo/restore path), so it doubles as a seeding hook here. 2 full days
    // apart, chosen so the resulting "2.0 days" average is easy to assert
    // exactly without a fragile fractional comparison.
    // `POST /tasks` accepts `assignedAt` (added in Part 1, for the undo/
    // restore path) but NOT `completedAt` — completed_at is deliberately
    // absent from that INSERT's column list (D-3: it's only ever derived by
    // POST /tasks/:id/complete). The generic PATCH's allowlist DOES include
    // `completedAt`, though (TASK_COLS in worker/routes/tasks.ts), so the
    // seed is create-then-PATCH: create with assigneeId/assignedAt, then
    // PATCH isCompleted + completedAt to land the exact historical gap.
    const assignedAt = '2026-01-01 09:00:00'
    const completedAt = '2026-01-03 09:00:00'
    const seeded = await ownerPage.request.post(`${API}/tasks`, {
      data: { content: 'Turnaround sample', assigneeId, assignedAt },
    })
    const seededTask = await seeded.json()
    expect(seededTask).not.toBeNull()
    await ownerPage.request.patch(`${API}/tasks/${seededTask.id}`, {
      data: { isCompleted: true, completedAt },
    })

    // A pre-migration row: completed, assigned, but assignedAt is null
    // (simulating a task assigned before this column existed). Must be
    // excluded from the average entirely, not treated as an instant/zero
    // turnaround.
    const legacy = await ownerPage.request.post(`${API}/tasks`, {
      data: { content: 'Legacy completed assignment', assigneeId, assignedAt: null },
    })
    const legacyTask = await legacy.json()
    expect(legacyTask).not.toBeNull()
    await ownerPage.request.patch(`${API}/tasks/${legacyTask.id}`, {
      data: { isCompleted: true, completedAt: '2026-01-05 09:00:00' },
    })

    await ownerPage.goto('/tasks/assigned')
    await expect(ownerPage.locator('main')).toBeVisible({ timeout: 20_000 })

    const row = ownerPage.getByTestId(`assigned-turnaround-${assigneeId}`)
    await expect(row).toBeVisible()
    await expect(row).toContainText(assigneeName)
    // If the null-assignedAt row were wrongly counted as a zero-day
    // turnaround, the average across the two rows would be 1.0 days, not
    // 2.0 — this assertion is the one that actually catches that bug.
    await expect(row).toContainText('2.0 days')

    await ownerCtx.close()
    await assigneeCtx.close()
  })

  test('no completed assignments yet shows the explanatory empty state', async ({ browser }) => {
    const { ownerPage, ownerCtx, assigneeCtx } = await createGroupOfTwo(browser)

    await ownerPage.goto('/tasks/assigned')
    await expect(ownerPage.locator('main')).toBeVisible({ timeout: 20_000 })

    await expect(ownerPage.getByTestId('assigned-turnaround-empty')).toContainText(
      'No completed assignments with a recorded assignment time yet',
    )

    await ownerCtx.close()
    await assigneeCtx.close()
  })

  test('BUG-013: a handed-out row with every optional field set renders without squeezing the name or overlapping controls', async ({ browser }) => {
    // The "handed out" rail is the only place a TaskListRow ever gets every
    // optional prop at once (coMembers, availableLists, onOpenDetail — see
    // TasksAssignedPage.tsx's second <TaskListRow>), so it's the only page
    // that can actually reproduce BUG-013: a fixed 6-track CSS grid whose
    // tracks were assigned by DOM order, not by role. The list <select>
    // (FEAT-051) rendered ahead of the title and could claim the grid's only
    // flexible (1fr) track, capping the title at a fixed 128px on every row
    // with a list — and the due-date picker's "Clear" button could overlap
    // the edit-detail button once both were showing.
    const { ownerPage, assigneePage, ownerCtx, assigneeCtx } = await createGroupOfTwo(browser)
    const assigneeId = await currentUserId(assigneePage)

    const listRes = await ownerPage.request.post(`${API}/task-lists`, { data: { name: 'Household errands' } })
    const list = await listRes.json()

    const longContent = 'Renew the household insurance policy before it lapses at month end'
    const taskRes = await ownerPage.request.post(`${API}/tasks`, {
      data: { content: longContent, listId: list.id, dueDate: businessDatePlus(60), recurrence: 'monthly', assigneeId },
    })
    const task = await taskRes.json()
    // A subtask, so the subtask-count chip also renders — the last of
    // TaskListRow's optional children, alongside list/assignee/recurrence/
    // due-date/edit-detail set above.
    await ownerPage.request.post(`${API}/tasks`, { data: { content: 'Sub-step', parentId: task.id } })

    await ownerPage.goto('/tasks/assigned')
    await expect(ownerPage.locator('main')).toBeVisible({ timeout: 20_000 })

    const row = ownerPage.locator(`[data-task-id="${task.id}"]`)
    await expect(row).toBeVisible()

    // Every optional child is present at once.
    await expect(row.getByTestId('all-tasks-row-list-chip')).toBeVisible()
    await expect(row.getByTestId('all-tasks-row-subtasks')).toBeVisible()
    await expect(row.getByTestId(`task-row-assignee-${task.id}`)).toBeVisible()
    await expect(row.getByTestId('all-tasks-row-recurrence')).toBeVisible()
    await expect(row.getByTestId(`task-row-detail-${task.id}`)).toBeVisible()

    // The name column is genuinely flexible, not capped at the old fixed
    // 128px track — 200px is a threshold the pre-fix layout could never
    // reach (128px minus the row's own padding), so this fails under the
    // regression and passes under the fix's `minmax(0, 1fr)` track.
    const titleBox = await row.getByTestId('all-tasks-row-title').boundingBox()
    expect(titleBox).not.toBeNull()
    expect(titleBox!.width).toBeGreaterThan(200)

    // Expand the due-date picker (BUG-011's original overlap: its "Clear"
    // button vs. the edit-detail button) and assert the two no longer share
    // any screen space — proof this is now structurally impossible (both
    // wrap inside one `.task-meta` flex row) rather than avoided by hiding
    // one control while the other is open.
    await row.getByTestId(`all-tasks-row-due-${task.id}`).click()
    const clearButton = row.getByRole('button', { name: 'Clear due date' })
    await expect(clearButton).toBeVisible()
    const editButton = row.getByTestId(`task-row-detail-${task.id}`)
    await expect(editButton).toBeVisible()

    const clearBox = await clearButton.boundingBox()
    const editBox = await editButton.boundingBox()
    expect(clearBox).not.toBeNull()
    expect(editBox).not.toBeNull()
    const overlaps =
      clearBox!.x < editBox!.x + editBox!.width &&
      clearBox!.x + clearBox!.width > editBox!.x &&
      clearBox!.y < editBox!.y + editBox!.height &&
      clearBox!.y + clearBox!.height > editBox!.y
    expect(overlaps).toBe(false)

    // BUG-013 (review round): the first structural fix only checked the
    // default ~1280px viewport, where there's room for the name and meta
    // groups to sit side by side at their natural size regardless of
    // whether the grid math is right. The actual bug — an `auto` track
    // claiming its full max-content width before the `1fr` name track gets
    // anything — only shows up once the row is too narrow to fit both, which
    // happens well above the ≤680px breakpoint (a `.task` nested in this
    // page's card is ~392px wide around a 700px viewport). Re-check at that
    // width, and at a real mobile width, that the name never collapses.
    for (const width of [700, 375]) {
      await ownerPage.setViewportSize({ width, height: 900 })
      const narrowTitleBox = await row.getByTestId('all-tasks-row-title').boundingBox()
      expect(narrowTitleBox).not.toBeNull()
      expect(narrowTitleBox!.width).toBeGreaterThan(80)
    }

    await ownerCtx.close()
    await assigneeCtx.close()
  })
})
