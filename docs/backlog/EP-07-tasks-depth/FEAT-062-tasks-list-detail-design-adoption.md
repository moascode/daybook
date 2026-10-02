> **Status:** Open · **Filed:** 2026-10-03 · **Epic:** [EP-07](README.md)

# FEAT-062 — Tasks: List detail page exact design adoption

**What.** Close the real gaps between `/tasks/lists/:listId`
(`src/modules/tasks/TasksListDetailPage.tsx`) and
`docs/reference/proposal-v2/tasks-list.html`. The page already shipped a
band (progress), a List/Outline toggle, and a rename/recolour rail (an
earlier item, referenced in the page's own docstring as "R5 PR-3"). That
docstring explicitly scoped out "Recurring-count, Wallet-linkage, an
activity feed and a 90-day per-person completion split" as having "no
backing data model in this codebase" — but two of those four are **no
longer true**: `task.recurrence` (FEAT-028) and `task.walletRef` (FEAT-032)
both shipped data for exactly this, after this page was first built. This
item re-examines that list with current data and builds what's genuinely
real; the other two (activity feed, per-person split) are still fabricated
and stay out. Page-scoped: **List detail only.**

**Why now.** Continuation of the FEAT-054/057/058/059/060/061
design-adoption pass, authorized by the owner to proceed autonomously.

**Confirmed against the real rendered mockup DOM**
(`document.querySelector('.content').outerHTML` at
`http://localhost:4873/tasks-list.html` — served via the repo's own
`design-mockup` launch.json entry added in PR #242 — not assumed):
```html
<!-- page-head -->
<span class="cat-dot" style="background:rgb(var(--info));width:12px;height:12px"></span>
<h1 class="page-title">Household</h1>
<span class="page-sub hide-mobile">12 open · shared with Priya and Jordan</span>
<div class="page-actions"><button class="btn btn-secondary">⚙ List settings</button></div>

<!-- composer (ABSENT from the real app's List view today — only Outline mode has one) -->
<section class="composer"> … "Add a task" input, Task/Reminder/Habit/Assign/Checklist shortcuts … </section>

<!-- band (c12) -->
<div class="band-fig"><span class="v">7 <span>of 19 done</span></span></div>
<div class="track" style="max-width:280px"><i style="width:37%"></i></div>
<div class="band-stats">
  Recurring / 6 / "of the 12 still open"
  Linked to Wallet / 4 / "$1,907 of bills"
  Members / 3 / "you, Priya, Jordan"
</div>

<!-- task rows (c8) — grouped by an ad-hoc SUB-CATEGORY ("Bills & admin", "Chores")
     not present anywhere in the data model (tasks have one flat listId, no
     sub-grouping field) -->
<div class="task">
  <button class="tcheck pri-high">✓</button>
  <div class="task-title">Renew home insurance before the 26th</div>
  <div class="task-sub"><span class="chip chip-mute">2 of 4 subtasks</span></div>
  <div class="task-when">3 days late</div>
  <div class="avatar">MA</div>
  <div class="trow-actions"><button class="icon-btn" aria-label="More">⋮</button></div>
</div>
<!-- other rows show chip chip-mute "Wallet · $1,800 due tomorrow" / "Repeats every 3 days" / chip chip-pos "Could save ~$18/mo" -->

<!-- rail (c4 stack) -->
<section class="card card-pad"><div class="card-head">List settings <button>Edit</button></div>
  <div class="kv">Shared with / Priya, Jordan</div>
  <div class="kv">Default assignee / Whoever adds it</div>
  <div class="kv">Default split / Equal · 3 ways</div>
  <div class="kv">New tasks notify / Everyone</div>
  <div class="kv">Colour / <span class="lchip">● Blue</span></div>
</section>
<section class="card card-pad"><div class="card-head">Activity</div>
  <div class="prow">… "Jordan finished …" / "Priya added …" / "You linked … to the Wallet bill" …</div>
</section>
<section class="card card-pad"><div class="card-head">Who does what <span class="card-sub">Completed in this list, 90 days</span></div>
  <div class="blist"> … per-person % bars (You 41%, Jordan 36%, Priya 23%) … </div>
</section>
```

## What this item does NOT build (scoped out, with reasoning)

- **"Shared with Priya and Jordan" / household membership on a list.** This
  app's `task_lists` table has no sharing/membership columns — a list
  belongs to its creator, full stop (`src/hooks/useTaskLists.ts`'s
  `TaskList` has no members field). Daybook's real household model is two
  users sharing Wallet accounts/groups, not per-list sharing settings. The
  page-sub drops "shared with X and Y" entirely; see below for what it
  keeps.
- **Default assignee / default split / "New tasks notify" rail fields.**
  None of these exist on `task_lists` — inventing a UI for settings with no
  backing column would be a dead-end form (CLAUDE.md §2 rule 10). The rail
  keeps its existing, real rename/recolour form.
- **"Activity" feed.** No activity/audit-log table exists anywhere in this
  app for tasks or lists. Fabricating "Jordan finished X" entries would be
  fiction. Not built.
- **"Who does what" 90-day per-person completion split.** This WOULD be
  honestly derivable (`completedInList` already carries `assigneeId` and
  `completedAt`) for a real two-person household, unlike the activity feed
  — but it's a materially bigger feature (a new aggregation + chart card)
  than this wiring pass's remaining scope after the composer/band/row work
  below, and the page already has three real cards. Flagged here explicitly
  rather than built partially; a good candidate for its own future item if
  the owner wants it.
- **Ad-hoc task sub-grouping by category ("Bills & admin" vs "Chores")
  within one list.** Tasks have exactly one `listId` — no sub-category or
  tag field splits them further within a list. The real "Open" / "Done
  this week" grouping (already shipped) stays; no second grouping axis is
  invented.
- **"$1,907 of bills" as a Wallet-linked dollar total.** `useWalletRefChips`
  (already shipped, FEAT-032) resolves a `recurring:<id>` ref to a real MYR
  amount, but only per-task — summing requires deciding how to combine
  `recurring` refs (a real bill amount) with `goal` refs (a % funded, no
  "amount still owed" concept) into one figure, which isn't an honest single
  number. The band's "Linked to Wallet" stat is a **count**, not a sum, and
  uses MYR formatting (`formatMYR`) wherever an individual amount IS shown
  (on a row's chip) — never a bare "$" sign, which this single-currency
  MYR app never uses (CLAUDE.md §1).
- **Reminder / Checklist composer shortcuts.** `TaskComposer`'s existing
  shortcut set is Task / Habit / Assign only (`TaskComposer.tsx` props) —
  Reminder and Checklist are tracked separately (FEAT-055/056, both still
  "Open," blocked on their own product questions). Reusing `TaskComposer`
  here inherits exactly its current shortcut set; none is added.

## Acceptance criteria

**Composer (new — List view currently has none at all; only Outline mode does)**
- [ ] `TaskComposer` (the same component `TasksTodayPage.tsx` already uses)
      is rendered above the task list in **List view only** (Outline mode
      already gets a composer via `TasksPage`, unchanged), with its
      `onCreateTask` pre-setting `listId` to the current list (or `null`
      for Unsorted) — same `lists`/`coMembers` wiring already available on
      this page or trivially derivable the same way `TasksAssignedPage.tsx`
      does (`GET /groups/members`).
- [ ] A task created through it appears immediately in the "Open" group
      without a full reload (same optimistic-append pattern this page
      already uses for other mutations).

**Band stats (replacing the single progress bar with the real subset of the mockup's three stats)**
- [ ] **Recurring** — count of `openTasks` with `recurrence !== null`, sub-line
      "of the N still open" (N = `openTasks.length`).
- [ ] **Linked to Wallet** — count of `openTasks` with `walletRef !== null`,
      sub-line "of the N still open" — count only, no fabricated dollar sum
      (see scope note above).
- [ ] **No "Members" stat** — dropped (no list-membership data model).
- [ ] Band continues to show today's real `band-fig`/`track` (completed/total,
      % bar) unchanged — only the `band-stats` column changes.

**Task rows — wallet chip + assignee avatar in List view (both real data, currently only wired in the outliner)**
- [ ] Each `TaskListRow` with a non-null `walletRef` shows the same resolved
      chip text `useWalletRefChips().resolveChip()` already produces for
      `BulletNode.tsx` ("Wallet · RM X.XX due in N days" / "Wallet goal ·
      N% funded") — reusing that hook, not a second implementation.
- [ ] `TaskListRow`'s existing `coMembers` prop (already built for
      `TasksAssignedPage.tsx`, currently unused here) is wired on this page
      too, resolving the real household's members via `GET /groups/members`
      — giving each row a real assignee control/avatar instead of nothing.

**Row actions — "More" menu (new, real: wraps the existing `deleteTask`)**
- [ ] An `icon-btn` "More" button per row (List view only) opens a small
      popover (reusing the same scoped popover pattern FEAT-061 just built
      for Habits' "Habit options" menu — not `AccountMenu`'s page-level
      panel) with a single real action: **Delete**, calling the existing
      `deleteTask` (already has its own undo-snapshot semantics per
      `useTasks.ts`) — matching this app's undo-toast policy for a single,
      low-consequence delete (CLAUDE.md §6 "Delete confirmation policy").

**Page head**
- [ ] `page-sub` becomes "`N open`" (N = `openTasks.length`), dropping the
      static "A single list, viewed either as a flat checklist or the full
      outliner." description and the fabricated "shared with" clause —
      honest, data-driven, matching the mockup's real half ("12 open"), not
      its fabricated half.

**Out of scope.** List membership/sharing settings, default assignee/split,
new-task notification settings, an Activity feed, the "Who does what"
per-person split card (flagged as a possible future item), ad-hoc
sub-category grouping within a list, a dollar-sum Wallet-linked total,
Reminder/Checklist composer shortcuts.

**Still needed?** Open.
