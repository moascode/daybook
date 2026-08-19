# Tasks — design adoption (R5)

Four pages on the R4 schema, sharing the Wallet's shell, tokens, motion and grid.
Upcoming / Assigned to me / Habits ship **disabled with a stated reason** and
land in R10–R11.

---

## Today (`tasks.html`) — the module's landing page

`/tasks` redirects here; the outliner moves to list detail (D-3).

**Band** (the `c12` summary pattern from Wallet): `3 of 9 done` with a progress
bar, then overdue / assigned / finished-this-week, then a **seven-day load
strip** that makes today's problem visible — Sunday is 9 tasks and Saturday is 1.

**Composer** directly above the list (R7 ships the Wallet one first; reuse it
here with the Tasks syntax): `Add a task — try "pay rent tomorrow 9am #household !high"`,
shortcuts Task · Reminder · Habit · Assign · Checklist. Parsing per D-11.

**List**, grouped: **Overdue** / **Today** / **Done today**.
- The overdue header offers to **reschedule all of them in one click** — the
  bulk endpoint from R4 exists for exactly this.
- Done-today is collapsible.

**Rows** carry list colour, subtask progress, recurrence (R10), assignee (D-15),
and a due column that turns **red when late and amber when tight**. Priority is
the checkbox's border colour.

**Right rail** — `Up next`, which in R5 shows tasks only. The Wallet mixing
("Rent leaves the account · tomorrow · from Wallet") is R11, and the rail should
not pretend to be cross-module before it is.

---

## All tasks (`tasks-all.html`) — mirrors the Transactions page

Deliberately, so the two modules teach each other:

- Four stat cards.
- A **filter field visibly distinct from global search**, same rule as Wallet.
- Removable filter chips.
- Date-grouped rows, including a **`No due date` group** with a "Schedule these"
  action — the design's version has 18 in it, and surfacing that pile is the
  point of the group.
- Twelve weeks of completions and an **age breakdown** that says the
  uncomfortable thing out loud: N open tasks are older than three months.

---

## List detail (`tasks-list.html`) — and the outliner's new home

The template for any list view: progress, recurring count, Wallet linkage and
members in the band; tasks grouped (Bills & admin / Chores / Done this week); a
rail with the list's settings, its activity feed, and a 90-day split of who
completes things.

**This page carries the outliner as a view mode** (D-3, recommended option 1).
A `List / Outline` toggle in the page header; Outline renders today's
`BulletTree` scoped to the list. Nothing about the outliner changes — same
keyboard shortcuts, same DnD, same notes, same `01-tasks.spec.ts`.

Members strip and the who-completes-what split require D-15. Without it, the
page is the same minus those two.

---

## Completed (`tasks-completed.html`) — list only in R5

Recent completions grouped by day, from `completed_at`. The **year heatmap**,
**by-list breakdown** and **time-to-finish** analysis are R11 — they need more
history than the backfill provides to be worth reading.

---

## Sidebar

```
Today (badge: due + overdue) · Upcoming · All tasks · Assigned to me (badge)
LISTS    ● Household 12   ● Work 8   ● Errands 5   ● Someday
REVIEW   Completed · Habits
```

Lists come from `task_lists` with live open counts. Colour dots use each list's
own colour (per-category colour, D-10).

---

## Done when

- `/tasks` lands on Today; the outliner is reachable from list detail and
  behaves identically.
- Four pages render on real data, both themes, 1440 / 768 / 390.
- `01-tasks.spec.ts` green **unchanged**; new specs for Today, All tasks, list
  detail and Completed.
- Upcoming / Assigned / Habits are visibly disabled with a reason, not 404s.
