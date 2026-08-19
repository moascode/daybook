# Tasks — data model (R4)

Purpose: make the designed task row renderable. This is **adoption cost, not
feature scope** — R5 cannot draw `tasks.html` without it.

Blocking decisions: **D-3** (outliner), **D-15** (sharing).

---

## 1. What the designed row needs

From `tasks.html`, one row carries:

```
[✓ priority-coloured checkbox]  Send Jordan the utilities receipt
                                ● Household   ⟨Wallet · RM60⟩   ⌸ 2 of 4   ↻ weekly
                                                    Yesterday   Sat 16   [MA]   ⋯
```

| Element | Column needed | Have it? |
|---|---|---|
| checkbox border colour | `priority` | ✗ |
| title | `content` | ✓ |
| list chip + colour | `list_id` → `task_lists` | ✗ |
| Wallet chip | `trip_id`/link, or derived | ✗ (R11) |
| subtask progress `2 of 4` | derived from `parent_id` | ✓ (compute server-side) |
| recurrence `Repeats weekly` | `recurrence_*` | ✗ (R10) |
| due time `by 18:00` / `Morning` | `due_time` | ✗ |
| due date `Sat 16`, red when late, amber when tight | `due_date` | ✓ |
| assignee avatar | `assignee_id` + sharing | ✗ (**D-15**) |

Priority shows as **the checkbox's border colour**, not another badge — the
thing you click is the thing that is urgent. Keep that; it is why the rows stay
scannable at nine items.

## 2. Migration `00NN_tasks_v2.sql`

Additive only, in **both** `server/migrations/` and `worker/migrations/`, per
`scripts/schema-diff.mjs`.

```sql
CREATE TABLE IF NOT EXISTS task_lists (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#2F6FEB',
  icon       TEXT DEFAULT 'list',
  sort_order REAL NOT NULL DEFAULT 0,
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

ALTER TABLE tasks ADD COLUMN list_id      TEXT REFERENCES task_lists(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN priority     TEXT NOT NULL DEFAULT 'none';  -- none|low|med|high
ALTER TABLE tasks ADD COLUMN due_time     TEXT DEFAULT NULL;             -- HH:MM, null = all day
ALTER TABLE tasks ADD COLUMN completed_at TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_user_due   ON tasks(user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_list       ON tasks(list_id);
CREATE INDEX IF NOT EXISTS idx_tasks_completed  ON tasks(user_id, completed_at);
```

**If D-15 is approved**, the same migration adds:

```sql
ALTER TABLE tasks ADD COLUMN assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS task_list_shares (
  list_id   TEXT NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
  group_id  TEXT NOT NULL REFERENCES groups(id)     ON DELETE CASCADE,
  can_write INTEGER NOT NULL DEFAULT 0,
  shared_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (list_id, group_id)
);
CREATE INDEX IF NOT EXISTS idx_task_list_shares_group ON task_list_shares(group_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
```

This mirrors `account_shares` exactly, deliberately: ownership stays with
`task_lists.user_id`, the share grants visibility plus optional write, and
`worker/lib/sharing.ts` already has the shape of the helper needed
(`writableAccountIds` → `writableListIds`). Reuse it rather than inventing a
second sharing model.

**Recurrence is R10**, not R4. It is a feature, not a rendering prerequisite —
the row's `Repeats weekly` chip can be absent in R5 without the page lying.

## 3. Backfill

- `completed_at` for already-completed tasks: set to `updated_at`, which is the
  closest honest value available. Note it — the Completed heatmap in R11 will
  show a spike on the migration date for pre-existing rows, and that is better
  than inventing dates.
- Default lists seeded per user on first read, following `seedUserDefaults()`'s
  existing pattern. Proposed seed: **Household**, **Work**, **Errands**,
  **Someday** — matching the proposal's sidebar, and the four map onto real use.
- Existing tasks get `list_id = NULL` and render under an "Unfiled" pseudo-list.
  Do not auto-assign; guessing a user's organisation is worse than showing them
  the pile.

## 4. API (`worker/routes/tasks.ts`, currently 124 lines)

New/changed endpoints:

```
GET    /api/task-lists                       lists + open counts
POST   /api/task-lists
PUT    /api/task-lists/:id
DELETE /api/task-lists/:id                   tasks survive, list_id → NULL

GET    /api/tasks?view=today|upcoming|all|list|completed|assigned
         &list=&priority=&assignee=&from=&to=&q=
POST   /api/tasks/:id/complete               sets is_completed + completed_at
POST   /api/tasks/reschedule                 { ids[], dueDate }  — bulk, for the
                                             overdue header's one-click action
```

Three things the API must do rather than leaving to the client:

1. **Serve subtask progress with the row.** `2 of 4` computed in SQL. The client
   does not have the children of a row it is showing flat.
2. **Serve the derived due-state** (`late` / `soon` / `ok`), computed against
   the business timezone, not the client's. This is CLAUDE.md §16 trap 1 in a
   new place: the eight hours a day when UTC and Asia/Kuala_Lumpur disagree are
   exactly when "overdue" is wrong.
3. **Scope every query by `user_id`** — and, if D-15 lands, by list membership.
   One user must never read another's tasks except through a shared list.

**D1 note:** the Today view wants several aggregates at once (open, overdue,
done-this-week, per-day load for seven days). `SQLITE_MAX_COMPOUND_SELECT` is
low — use scalar subqueries, not an 18-term `UNION ALL`. This is a documented
trap in CLAUDE.md that this exact query shape will hit.

## 5. Done when

- Migration applied in both trees, `schema-diff` green.
- API returns every field the designed row needs.
- **`01-tasks.spec.ts` passes unchanged.** That is the proof the outliner is
  untouched, and it is the acceptance test for this release.
- A new `66-tasks-api.spec.ts` covers list CRUD, the view filters, bulk
  reschedule, and (if D-15) that a non-member gets 404 on a shared list's tasks.
