/**
 * Backend hardening pass on Tasks + Habits (worker/routes/tasks.ts,
 * worker/routes/habits.ts). Covers, through the API:
 *
 *  1. An undated, unassigned subtask does not leak into the flat views
 *     (today/upcoming/all/list/completed/assigned) as a standalone row.
 *  2. POST /tasks/reschedule honours the same owner/assignee/shared-list-
 *     writer access as complete/delete, not owner-only.
 *  3. PATCH /tasks/:id honours that same access, not owner-only.
 *  4. GET /tasks?view=completed orders by completed_at DESC.
 *  5. recurrence: 'custom' with an empty weekdays array is rejected (400)
 *     on both POST and PATCH.
 *  6. A habit never scores a day before its own created_at as missed.
 *  7. POST /habits/:id/toggle never 500s on a same-(habit_id,date) race.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, businessToday, businessDatePlus } from './helpers'

const API = '/api'

/**
 * Two users in the same household group, mirroring e2e/92-tasks-assigned.spec.ts's
 * createGroupOfTwo — built entirely over the API since the Sharing UI flow
 * itself is already covered there.
 */
async function createGroupOfTwo(browser: Browser) {
  const ownerCtx = await browser.newContext()
  const otherCtx = await browser.newContext()
  const ownerPage = await ownerCtx.newPage()
  const otherPage = await otherCtx.newPage()

  const ownerName = `owner_bh_${Date.now()}`
  const otherName = `other_bh_${Date.now()}`

  await ownerPage.request.post(`${API}/auth/signup`, { data: { username: ownerName, password: 'test-password' } })
  await otherPage.request.post(`${API}/auth/signup`, { data: { username: otherName, password: 'test-password' } })

  const groupRes = await ownerPage.request.post(`${API}/groups`, { data: { name: 'Backend Hardening Household' } })
  const group = await groupRes.json()

  await ownerPage.request.post(`${API}/groups/${group.id}/invites`, { data: { username: otherName } })

  const invitesRes = await otherPage.request.get(`${API}/invites`)
  const invites = await invitesRes.json()
  const invite = invites.find((i: { group_id: string }) => i.group_id === group.id)
  await otherPage.request.post(`${API}/invites/${invite.id}/accept`)

  return { ownerPage, otherPage, ownerCtx, otherCtx }
}

async function currentUserId(page: Page): Promise<string> {
  const res = await page.request.get(`${API}/auth/me`)
  const { user } = await res.json()
  return user.id
}

test.describe('100 — Tasks + Habits backend hardening', () => {
  // ── 1. Undated subtasks don't leak into flat views ──────────────────

  test('an undated, unassigned subtask is excluded from all/upcoming/completed views', async ({ browser }) => {
    const page = await newAppPage(browser)
    const tomorrow = businessDatePlus(1)

    const parentRes = await page.request.post(`${API}/tasks`, {
      data: { content: 'Draft the Q3 handover doc' },
    })
    const parent = await parentRes.json()

    const subtaskRes = await page.request.post(`${API}/tasks`, {
      data: { content: 'Outline', parentId: parent.id },
    })
    const subtask = await subtaskRes.json()

    // Dated subtasks are real scheduled work and must stay visible.
    const datedSubtaskRes = await page.request.post(`${API}/tasks`, {
      data: { content: 'Send draft for review', parentId: parent.id, dueDate: tomorrow },
    })
    const datedSubtask = await datedSubtaskRes.json()

    const allRes = await page.request.get(`${API}/tasks?view=all`)
    const allIds = (await allRes.json()).map((t: { id: string }) => t.id)
    expect(allIds).not.toContain(subtask.id)
    expect(allIds).toContain(parent.id)

    const upcomingRes = await page.request.get(`${API}/tasks?view=upcoming`)
    const upcomingIds = (await upcomingRes.json()).map((t: { id: string }) => t.id)
    expect(upcomingIds).not.toContain(subtask.id)
    expect(upcomingIds).toContain(datedSubtask.id)

    // Completing it then checking view=completed exercises that view's
    // exclusion too.
    await page.request.post(`${API}/tasks/${subtask.id}/complete`, {})
    const completedRes = await page.request.get(`${API}/tasks?view=completed`)
    const completedIds = (await completedRes.json()).map((t: { id: string }) => t.id)
    expect(completedIds).not.toContain(subtask.id)

    // The unfiltered outliner fetch (no `view`) must stay untouched — the
    // subtask is still a real row there.
    const outlinerRes = await page.request.get(`${API}/tasks`)
    const outlinerIds = (await outlinerRes.json()).map((t: { id: string }) => t.id)
    expect(outlinerIds).toContain(subtask.id)
  })

  // ── 2. POST /tasks/reschedule — widened access ───────────────────────

  test('reschedule moves a task assigned to the caller, not just tasks they own', async ({ browser }) => {
    const { ownerPage, otherPage, ownerCtx, otherCtx } = await createGroupOfTwo(browser)
    const otherId = await currentUserId(otherPage)
    const newDate = businessDatePlus(5)

    const taskRes = await ownerPage.request.post(`${API}/tasks`, {
      data: { content: 'Assigned reschedule target', dueDate: businessDatePlus(1) },
    })
    const task = await taskRes.json()
    await ownerPage.request.patch(`${API}/tasks/${task.id}`, { data: { assigneeId: otherId } })

    // The assignee (not the owner) calls reschedule — this previously was
    // silently skipped because the route was `WHERE user_id = ?` only.
    const rescheduleRes = await otherPage.request.post(`${API}/tasks/reschedule`, {
      data: { ids: [task.id], dueDate: newDate },
    })
    expect(rescheduleRes.ok()).toBe(true)
    const moved = await rescheduleRes.json()
    expect(moved.map((t: { id: string }) => t.id)).toContain(task.id)

    const refetch = await ownerPage.request.get(`${API}/tasks`)
    const refetched = (await refetch.json()).find((t: { id: string }) => t.id === task.id)
    expect(refetched.due_date).toBe(newDate)

    await ownerCtx.close()
    await otherCtx.close()
  })

  test('reschedule silently skips an id the caller has no access to, rather than moving it', async ({ browser }) => {
    const { ownerPage, otherPage, ownerCtx, otherCtx } = await createGroupOfTwo(browser)
    const newDate = businessDatePlus(5)

    const taskRes = await ownerPage.request.post(`${API}/tasks`, {
      data: { content: 'Owner-only task', dueDate: businessDatePlus(1) },
    })
    const task = await taskRes.json()

    // The other user is in the same group but this task is neither assigned
    // to them nor in a shared list — reschedule must not move it.
    const rescheduleRes = await otherPage.request.post(`${API}/tasks/reschedule`, {
      data: { ids: [task.id], dueDate: newDate },
    })
    expect(rescheduleRes.ok()).toBe(true)
    const moved = await rescheduleRes.json()
    expect(moved.map((t: { id: string }) => t.id)).not.toContain(task.id)

    await ownerCtx.close()
    await otherCtx.close()
  })

  // ── 3. PATCH /tasks/:id — widened access ─────────────────────────────

  test('an assignee can PATCH a task that is not theirs by ownership', async ({ browser }) => {
    const { ownerPage, otherPage, ownerCtx, otherCtx } = await createGroupOfTwo(browser)
    const otherId = await currentUserId(otherPage)

    const taskRes = await ownerPage.request.post(`${API}/tasks`, { data: { content: 'Original content' } })
    const task = await taskRes.json()
    await ownerPage.request.patch(`${API}/tasks/${task.id}`, { data: { assigneeId: otherId } })

    // Previously 404'd: updateRow() scoped the UPDATE to `WHERE id = ? AND
    // user_id = ?`, owner-only, even though complete/delete already allowed
    // an assignee.
    const patchRes = await otherPage.request.patch(`${API}/tasks/${task.id}`, {
      data: { content: 'Edited by assignee' },
    })
    expect(patchRes.ok()).toBe(true)
    const patched = await patchRes.json()
    expect(patched.content).toBe('Edited by assignee')

    await ownerCtx.close()
    await otherCtx.close()
  })

  test('PATCH 404s for a task the caller has no access to', async ({ browser }) => {
    const { ownerPage, otherPage, ownerCtx, otherCtx } = await createGroupOfTwo(browser)

    const taskRes = await ownerPage.request.post(`${API}/tasks`, { data: { content: 'Not shared' } })
    const task = await taskRes.json()

    const patchRes = await otherPage.request.patch(`${API}/tasks/${task.id}`, { data: { content: 'Hijack' } })
    expect(patchRes.status()).toBe(404)

    await ownerCtx.close()
    await otherCtx.close()
  })

  // ── 4. view=completed ordering ────────────────────────────────────────

  test('view=completed orders by completed_at DESC (most recently finished first)', async ({ browser }) => {
    const page = await newAppPage(browser)

    const firstRes = await page.request.post(`${API}/tasks`, { data: { content: 'Finished first' } })
    const first = await firstRes.json()
    const secondRes = await page.request.post(`${API}/tasks`, { data: { content: 'Finished second' } })
    const second = await secondRes.json()

    await page.request.post(`${API}/tasks/${first.id}/complete`, {})
    await page.request.post(`${API}/tasks/${second.id}/complete`, {})

    const completedRes = await page.request.get(`${API}/tasks?view=completed`)
    const completed = await completedRes.json()
    const ids = completed.map((t: { id: string }) => t.id)
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id))
  })

  // ── 5. custom recurrence requires a non-empty weekdays array ──────────

  test('recurrence: custom with empty weekdays is rejected on POST and PATCH', async ({ browser }) => {
    const page = await newAppPage(browser)
    const today = businessToday()

    const postRes = await page.request.post(`${API}/tasks`, {
      data: { content: 'Bad recurrence', dueDate: today, recurrence: 'custom', recurrenceData: { weekdays: [] } },
    })
    expect(postRes.status()).toBe(400)

    const taskRes = await page.request.post(`${API}/tasks`, { data: { content: 'Will patch', dueDate: today } })
    const task = await taskRes.json()
    const patchRes = await page.request.patch(`${API}/tasks/${task.id}`, {
      data: { recurrence: 'custom', recurrenceData: { weekdays: [] } },
    })
    expect(patchRes.status()).toBe(400)

    // A non-empty weekdays array is accepted.
    const okRes = await page.request.patch(`${API}/tasks/${task.id}`, {
      data: { recurrence: 'custom', recurrenceData: { weekdays: [1, 3, 5] } },
    })
    expect(okRes.ok()).toBe(true)
  })

  // ── 6. habits: created_at bounds what counts as "due" ─────────────────

  test('a habit created today does not score days before creation as missed', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/habits')
    const yesterday = businessDatePlus(-1)
    const today = businessToday()

    const createRes = await page.request.post(`${API}/habits`, { data: { name: 'Fresh habit' } })
    const habit = await createRes.json()
    const entries = habit.stats.entries as { date: string; done: boolean; due: boolean }[]

    const yesterdayEntry = entries.find((e) => e.date === yesterday)
    const todayEntry = entries.find((e) => e.date === today)
    expect(yesterdayEntry?.due).toBe(false)
    expect(todayEntry?.due).toBe(true)

    // A broken joint streak was the symptom: with yesterday wrongly "due and
    // missed", currentStreak could never start. Toggling today on must give
    // a clean 1-day streak, not 0.
    await page.request.post(`${API}/habits/${habit.id}/toggle`, { data: { date: today } })
    const refetch = await page.request.get(`${API}/habits`)
    const refetched = (await refetch.json()).find((h: { id: string }) => h.id === habit.id)
    expect(refetched.stats.currentStreak).toBe(1)
  })

  // ── 7. habits toggle is race-safe ─────────────────────────────────────

  test('two concurrent toggles on the same day never 500', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/habits')
    const today = businessToday()

    const createRes = await page.request.post(`${API}/habits`, { data: { name: 'Race habit' } })
    const habit = await createRes.json()

    const [r1, r2] = await Promise.all([
      page.request.post(`${API}/habits/${habit.id}/toggle`, { data: { date: today } }),
      page.request.post(`${API}/habits/${habit.id}/toggle`, { data: { date: today } }),
    ])
    expect(r1.status()).toBeLessThan(500)
    expect(r2.status()).toBeLessThan(500)
  })
})
