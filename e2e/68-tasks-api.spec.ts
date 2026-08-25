import { test, expect } from '@playwright/test'

const API = '/api'

test.describe.configure({ mode: 'serial' })

/**
 * R4 (docs/v2/release-plan.md, docs/v2/tasks/01-data-model.md) — API-only
 * coverage for the Tasks v2 schema: task_lists CRUD, the `view` filters and
 * derived fields on GET /tasks, bulk reschedule, and list sharing (D-15).
 *
 * No UI exists for any of this yet (that's R5) — every check goes straight
 * through the API, following the pattern in 40-transaction-permissions.spec.ts.
 */
test.describe('68 — Tasks v2 API', () => {
  async function signup(browser: import('@playwright/test').Browser, tag: string) {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    const username = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    await page.request.post(`${API}/auth/signup`, { data: { username, password: 'test-password' } })
    return { ctx, page, username }
  }

  // ── Default lists + basic CRUD ──────────────────────

  test('signup seeds four default task lists', async ({ browser }) => {
    const { ctx, page } = await signup(browser, 'lists')
    const lists = await (await page.request.get(`${API}/task-lists`)).json()
    expect(lists.map((l: { name: string }) => l.name).sort()).toEqual(
      ['Errands', 'Household', 'Someday', 'Work'].sort(),
    )
    for (const l of lists) expect(l.open_count).toBe(0)
    await ctx.close()
  })

  test('create, rename, and delete a list; its tasks survive with list_id cleared', async ({ browser }) => {
    const { ctx, page } = await signup(browser, 'crud')

    const list = await (await page.request.post(`${API}/task-lists`, { data: { name: 'Trip planning' } })).json()
    expect(list.name).toBe('Trip planning')

    const renamed = await (await page.request.put(`${API}/task-lists/${list.id}`, { data: { name: 'Travel' } })).json()
    expect(renamed.name).toBe('Travel')

    const task = await (
      await page.request.post(`${API}/tasks`, { data: { content: 'Book flight', listId: list.id } })
    ).json()
    expect(task.list_id).toBe(list.id)

    const del = await page.request.delete(`${API}/task-lists/${list.id}`)
    expect(del.status()).toBe(204)

    const tasks = await (await page.request.get(`${API}/tasks`)).json()
    const survivor = tasks.find((t: { id: string }) => t.id === task.id)
    expect(survivor).toBeTruthy()
    expect(survivor.list_id).toBeNull()

    await ctx.close()
  })

  test('a non-owner cannot rename or delete another user\'s list', async ({ browser }) => {
    const alice = await signup(browser, 'own_a')
    const bob = await signup(browser, 'own_b')

    const list = await (await alice.page.request.post(`${API}/task-lists`, { data: { name: 'Alice only' } })).json()

    const rename = await bob.page.request.put(`${API}/task-lists/${list.id}`, { data: { name: 'Hijacked' } })
    expect(rename.status()).toBe(404)

    const del = await bob.page.request.delete(`${API}/task-lists/${list.id}`)
    expect(del.status()).toBe(404)

    await alice.ctx.close()
    await bob.ctx.close()
  })

  // ── GET /tasks?view= filters + derived fields ───────

  test('view filters: today, upcoming, all, completed', async ({ browser }) => {
    const { ctx, page } = await signup(browser, 'views')

    const mk = async (content: string, extra: Record<string, unknown> = {}) =>
      (await page.request.post(`${API}/tasks`, { data: { content, ...extra } })).json()

    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    const today = new Date().toISOString().slice(0, 10)
    const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)

    const overdue = await mk('Overdue thing', { dueDate: yesterday })
    const dueToday = await mk('Due today thing', { dueDate: today })
    const upcoming = await mk('Future thing', { dueDate: nextWeek })
    const noDate = await mk('No due date thing')

    const todayView = await (await page.request.get(`${API}/tasks?view=today`)).json()
    const todayIds = todayView.map((t: { id: string }) => t.id)
    expect(todayIds).toContain(overdue.id)
    expect(todayIds).toContain(dueToday.id)
    expect(todayIds).not.toContain(upcoming.id)
    expect(todayIds).not.toContain(noDate.id)

    const overdueRow = todayView.find((t: { id: string }) => t.id === overdue.id)
    expect(overdueRow.due_state).toBe('late')
    const dueTodayRow = todayView.find((t: { id: string }) => t.id === dueToday.id)
    expect(dueTodayRow.due_state).toBe('soon')

    const upcomingView = await (await page.request.get(`${API}/tasks?view=upcoming`)).json()
    const upcomingIds = upcomingView.map((t: { id: string }) => t.id)
    expect(upcomingIds).toContain(upcoming.id)
    expect(upcomingIds).not.toContain(overdue.id)
    expect(upcomingIds).not.toContain(dueToday.id)

    const allView = await (await page.request.get(`${API}/tasks?view=all`)).json()
    const allIds = allView.map((t: { id: string }) => t.id)
    for (const t of [overdue, dueToday, upcoming, noDate]) expect(allIds).toContain(t.id)

    await page.request.post(`${API}/tasks/${noDate.id}/complete`)
    const completedView = await (await page.request.get(`${API}/tasks?view=completed`)).json()
    expect(completedView.map((t: { id: string }) => t.id)).toContain(noDate.id)
    expect(allIds.includes(noDate.id)).toBe(true) // captured before completion

    await ctx.close()
  })

  test('subtask progress is served with the row', async ({ browser }) => {
    const { ctx, page } = await signup(browser, 'subtasks')
    const parent = await (await page.request.post(`${API}/tasks`, { data: { content: 'Parent', dueDate: new Date().toISOString().slice(0, 10) } })).json()
    const child1 = await (await page.request.post(`${API}/tasks`, { data: { content: 'Child 1', parentId: parent.id } })).json()
    await page.request.post(`${API}/tasks`, { data: { content: 'Child 2', parentId: parent.id } })
    await page.request.post(`${API}/tasks/${child1.id}/complete`)

    const view = await (await page.request.get(`${API}/tasks?view=today`)).json()
    const row = view.find((t: { id: string }) => t.id === parent.id)
    expect(row.subtask_total).toBe(2)
    expect(row.subtask_done).toBe(1)

    await ctx.close()
  })

  test('view=list requires a visible list and 404s otherwise', async ({ browser }) => {
    const { ctx, page } = await signup(browser, 'viewlist')
    const list = await (await page.request.post(`${API}/task-lists`, { data: { name: 'Scoped' } })).json()
    await page.request.post(`${API}/tasks`, { data: { content: 'In scope', listId: list.id } })

    const scoped = await page.request.get(`${API}/tasks?view=list&list=${list.id}`)
    expect(scoped.status()).toBe(200)
    const rows = await scoped.json()
    expect(rows).toHaveLength(1)

    const missing = await page.request.get(`${API}/tasks?view=list&list=does-not-exist`)
    expect(missing.status()).toBe(404)

    await ctx.close()
  })

  test('plain GET /tasks (no view) stays the unfiltered outliner shape', async ({ browser }) => {
    const { ctx, page } = await signup(browser, 'plain')
    await page.request.post(`${API}/tasks`, { data: { content: 'Bullet one' } })
    await page.request.post(`${API}/tasks`, { data: { content: 'Bullet two', dueDate: '2020-01-01' } })

    const rows = await (await page.request.get(`${API}/tasks`)).json()
    expect(rows).toHaveLength(2)
    // No derived fields on the unfiltered path — same shape the outliner has
    // always received.
    for (const r of rows) {
      expect(r.subtask_total).toBeUndefined()
      expect(r.due_state).toBeUndefined()
    }

    await ctx.close()
  })

  // ── Bulk reschedule ──────────────────────────────────

  test('bulk reschedule moves only the caller\'s own tasks', async ({ browser }) => {
    const alice = await signup(browser, 'resched_a')
    const bob = await signup(browser, 'resched_b')

    const t1 = await (await alice.page.request.post(`${API}/tasks`, { data: { content: 'A1', dueDate: '2026-01-01' } })).json()
    const t2 = await (await alice.page.request.post(`${API}/tasks`, { data: { content: 'A2', dueDate: '2026-01-01' } })).json()
    const bobTask = await (await bob.page.request.post(`${API}/tasks`, { data: { content: 'B1', dueDate: '2026-01-01' } })).json()

    const res = await alice.page.request.post(`${API}/tasks/reschedule`, {
      data: { ids: [t1.id, t2.id, bobTask.id], dueDate: '2026-03-15' },
    })
    expect(res.status()).toBe(200)
    const rows = await res.json()
    expect(rows).toHaveLength(2) // Bob's task is silently excluded, not errored
    for (const r of rows) expect(r.due_date).toBe('2026-03-15')

    const bobRows = await (await bob.page.request.get(`${API}/tasks`)).json()
    expect(bobRows.find((t: { id: string }) => t.id === bobTask.id).due_date).toBe('2026-01-01')

    await alice.ctx.close()
    await bob.ctx.close()
  })

  // ── Sharing (D-15) ───────────────────────────────────

  test('a shared list is visible to group members, writable per can_write, and hidden from non-members', async ({ browser }) => {
    const alice = await signup(browser, 'share_a')
    const bob = await signup(browser, 'share_b')
    const carol = await signup(browser, 'share_c')

    const group = await (await alice.page.request.post(`${API}/groups`, { data: { name: 'Share group' } })).json()
    await alice.page.request.post(`${API}/groups/${group.id}/invites`, { data: { username: bob.username } })
    const invites = await (await bob.page.request.get(`${API}/invites`)).json()
    await bob.page.request.post(`${API}/invites/${invites[0].id}/accept`)

    const list = await (await alice.page.request.post(`${API}/task-lists`, { data: { name: 'Household chores' } })).json()
    const task = await (await alice.page.request.post(`${API}/tasks`, { data: { content: 'Take out trash', listId: list.id } })).json()

    // Not shared yet — Bob (group member) cannot see it.
    const before = await bob.page.request.get(`${API}/tasks?view=list&list=${list.id}`)
    expect(before.status()).toBe(404)

    await alice.page.request.post(`${API}/task-lists/${list.id}/shares`, { data: { groupId: group.id, canWrite: false } })

    const bobView = await (await bob.page.request.get(`${API}/tasks?view=list&list=${list.id}`)).json()
    expect(bobView.map((t: { id: string }) => t.id)).toContain(task.id)

    // Bob can see it but the list is read-only: he isn't the owner, isn't the
    // assignee, and the share carries no write access — complete is refused.
    const bobComplete = await bob.page.request.post(`${API}/tasks/${task.id}/complete`)
    expect(bobComplete.status()).toBe(404)

    // Carol is not in the group at all.
    const carolView = await carol.page.request.get(`${API}/tasks?view=list&list=${list.id}`)
    expect(carolView.status()).toBe(404)

    // Grant write access; now Bob can complete it.
    await alice.page.request.patch(`${API}/task-lists/${list.id}/shares/${group.id}`, { data: { canWrite: true } })
    const bobCompleteNow = await bob.page.request.post(`${API}/tasks/${task.id}/complete`)
    expect(bobCompleteNow.status()).toBe(200)
    const completed = await bobCompleteNow.json()
    expect(completed.is_completed).toBe(1)
    expect(completed.completed_at).toBeTruthy()

    await alice.ctx.close()
    await bob.ctx.close()
    await carol.ctx.close()
  })

  test('an assignee can complete a task they were assigned even without list access', async ({ browser }) => {
    const alice = await signup(browser, 'assignee_a')
    const bob = await signup(browser, 'assignee_b')

    const task = await (await alice.page.request.post(`${API}/tasks`, { data: { content: 'Assigned to Bob' } })).json()
    // assigneeId must be a real user id, not a username — fetch Bob's id via /me.
    const bobMe = await (await bob.page.request.get(`${API}/auth/me`)).json()
    await alice.page.request.patch(`${API}/tasks/${task.id}`, { data: { assigneeId: bobMe.user.id } })

    const res = await bob.page.request.post(`${API}/tasks/${task.id}/complete`)
    expect(res.status()).toBe(200)

    await alice.ctx.close()
    await bob.ctx.close()
  })
})
