# Tasks — module plan

**Schema: R4 (`v2.13.0`). Adoption: R5 (`v2.14.0`). Completion: R10–R11 (`v3.4`–`v3.5`).**

Tasks is the inverse of Wallet. Wallet has eight pages that map 1:1 and needs no
schema change; Tasks has **one page today and seven in the proposal**, and every
attribute the designed row carries — list, priority, due time, assignee, subtask
count, recurrence — is missing from the table.

| Doc | What it covers |
|---|---|
| [01-data-model.md](01-data-model.md) | R4 — the migration and API that make R5 renderable |
| [02-design-adoption.md](02-design-adoption.md) | R5 — Today, All tasks, List detail, Completed |
| [03-feature-waves.md](03-feature-waves.md) | R10–R11 — Upcoming, Assigned, Habits, insights |

---

## Two decisions dominate this module

**D-3 — does the outliner survive?** `TasksPage.tsx` is 792 lines of
Workflowy-style outliner and it is the current Tasks product. The proposal
contains no outliner at all. The recommendation is to keep it as a **view mode
on the list-detail page**: `parent_id` already exists, so the tree stays the
storage model and every designed page is a flat projection of it. But this is
the one place the redesign removes shipped functionality, so it is the owner's
call.

**D-15 — are tasks shared?** The designed module is household-shared throughout:
assignees, "Assigned to me", per-person turnaround times, a 90-day split of who
completes what. **Tasks today are strictly `user_id`-scoped with no sharing
whatsoever.** Approving this means tasks get roughly what accounts got in Phase
5b. Declining it costs R4 one column, R5 one avatar column, and R10 one whole
page — the rest of the module is unaffected.

Answer both before R4 starts.

---

## Page inventory

| Proposal | Release | Depends on |
|---|---|---|
| `tasks.html` — Today | R5 | lists, priority, due time, assignee |
| `tasks-all.html` — All tasks | R5 | the same, plus age buckets |
| `tasks-list.html` — a list | R5 | lists; sharing for the members strip (D-15) |
| `tasks-completed.html` — Completed | R5 (list) / R11 (heatmap) | `completed_at` |
| `tasks-upcoming.html` — week board | R10 | scheduling |
| `tasks-assigned.html` — Assigned to me | R10 | **sharing (D-15)** |
| `tasks-habits.html` — Habits | R11 | habits tables |
| — outliner (`TasksPage.tsx`) | R5, preserved | D-3 |

---

## What makes this module worth building

The proposal's argument for Tasks living in the same app as Wallet is the
cross-module thread, and it is concrete:

- A task row carries a Wallet chip — `Wallet · RM1,800 due tomorrow`,
  `Saves RM59.99/mo` on the cancelled subscription, `Wallet goal · 88% funded`
  on planning the trip.
- **Up next** in the right rail mixes tasks with Wallet events ("Rent leaves the
  account · tomorrow · from Wallet").
- **Worth knowing** is Budgets' Suggestions applied to your own task history:
  mornings finish 78% of the time and evenings 41%; a task moved three or more
  times rarely gets done; Sunday is nine tasks and Saturday is one.

None of that is possible in a standalone task app, and none of it is possible
without R4's schema. Build the schema properly the first time.
