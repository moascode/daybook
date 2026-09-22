> **Status:** Archived · **Last verified:** 2026-09-22 · **Filed:** 2026-09-21 · **Shipped:** 2026-09-21 (PR #233) · **Epic:** [EP-07](../../backlog/EP-07-tasks-depth/README.md)

# BUG-009 — No way to pick a list or date while creating a task

**Expected.** Creating a task (Today page composer, at minimum) lets the
user choose which list it belongs to and what date it's due, at creation
time — not only as a follow-up edit after the task already exists.

**Actual.** `TasksTodayPage.tsx`'s composer (`handleComposerKeyDown`) is a
single `<input type="text">`; it calls `addTask(content, null)` — `null`
list, always — then unconditionally force-sets `dueDate: today`. There is no
list selector and no date control in the composer UI, and there is no way to
land a Today-created task in any list other than none, or on any date other
than today.

**Repro.**
1. Go to the Today page.
2. Type a task name and press Enter.
3. There was never an opportunity to choose a list or a date — the task is
   created with no list and today's date, unconditionally.

**Where I think it lives.** `src/modules/tasks/TasksTodayPage.tsx`,
`handleComposerKeyDown` and the `.qadd` composer markup. Confirmed by
reading the file — `addTask` is called with a hardcoded `null` list and the
due date is force-overwritten right after.

**Money, data loss, or cosmetic?** Functional gap — every task created from
Today needs a second, separate edit step (blocked today by BUG-007) just to
sort it into a list or move it off today's date.

**Still needed?** Fixed — the Today composer gained a list `<select>` and a
date input next to the text field, both changeable before Enter and reset
to their defaults ("Unsorted" / today) after a successful add. Upcoming's
per-day "+ Add" composer gained the same list picker (its date was already
implied by the day column it's added into).
