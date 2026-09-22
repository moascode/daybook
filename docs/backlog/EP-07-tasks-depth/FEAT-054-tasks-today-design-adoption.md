> **Status:** Open · **Filed:** 2026-09-22 · **Epic:** [EP-07](README.md)

# FEAT-054 — Tasks: Today page exact design adoption

**What.** Bring `/tasks` (Today) to full visual and behavioural parity with
`proposal-v2/tasks.html`, the same treatment already given to Wallet's
equivalent pages. Nothing here is a new capability — every field involved
already exists on `Task` (`listId`, `priority`, `dueTime`, `assigneeId`,
`subtaskTotal`/`subtaskDone`, `recurrence`, `walletRef`) and every CSS class
needed already exists in `src/styles/tasks.css` / `src/styles/shell.css`,
dormant. This is a wiring pass, page-scoped: **Today only.** Upcoming / All
tasks / Assigned to me / Completed / Habits / List detail get their own
design-adoption items later, filed separately once this one ships and the
pattern is proven.

**Why now.** Side-by-side comparison against the proposal surfaced a long list
of gaps the current page never closed from R5. Filed as one comprehensive item
(with two smaller sibling items split out, below) rather than implemented
immediately, so a future session can execute this without re-deriving the
analysis.

**Reference implementations to copy, not reinvent:**
- Composer shape: `src/modules/wallet/composer/Composer.tsx` +
  `parseComposerInput.ts` — avatar, `.composer-field` input with an `N`-hotkey
  `.kbd` hint, `.composer-send` button, `.composer-acts` shortcut row, rules-parser
  pattern.
- Row metadata (list chip, subtask/recurrence chips, click-to-edit title):
  `src/modules/tasks/TaskListRow.tsx` (the All-tasks row).
- Wallet-linked chip text: `src/hooks/useWalletRefChips.ts` (already used in
  `BulletNode.tsx`, not yet on Today's rows).
- The "…" kebab menu for secondary row actions: `src/modules/wallet/TransactionList.tsx`'s
  `.trow-actions` — a Radix `DropdownMenu` behind a single `MoreHorizontal`
  icon button (`aria-label="Transaction options"`), replacing what would
  otherwise be several always-visible icon buttons. Tasks' version needs the
  same one-entry-point shape (contents: at minimum Edit details / Reschedule /
  Delete — decide the exact set when implementing, matching what the row
  already supports elsewhere).

## Acceptance criteria

**Page head**
- [ ] A `page-sub` date subtitle next to the "Today" title, the real current
      date (e.g. "Sunday 17 August"), not a mock.
- [ ] A `.segment` Mine/Everyone toggle, default "Mine". Filters the *existing*
      household-visible task set in place — `GET /tasks` already returns own +
      assigned + shared-list tasks (`worker/routes/tasks.ts` ~line 104) — so
      "Everyone" just removes the `ownerId/assigneeId === currentUser` filter
      client-side. No new endpoint, no page reload.
- [ ] A "Plan week" button that navigates to `/tasks/upcoming` (already
      shipped).

**Composer**
- [ ] Replace the current bare `.qadd` bar with the real `.composer` shell:
      avatar circle (user initial), `.composer-field` input with an `N`
      `.kbd` hint, `.composer-send` button, `.composer-acts` shortcut row.
- [ ] Shortcuts: **Task** (focuses the composer), **Habit** (deep-links to
      `/tasks/habits` and opens its existing create-habit modal via a
      nav-state flag — mirror the `focusComposer` nav-state pattern
      `TasksTodayPage.tsx` already uses for itself), **Assign** (inserts `@`
      at the cursor and focuses, hinting the syntax). No dead buttons —
      **Reminder and Checklist shortcuts are explicitly OUT of scope here**,
      see FEAT-055/FEAT-056 below.
- [ ] A rules-only parser (`parseTaskComposerInput`, pure/unit-testable) —
      **no AI/Claude call**: any new Anthropic API touchpoint needs its own
      explicit per-item sign-off per CLAUDE.md rule 12, and none has been
      given for this item. Support, mirroring the D-11 example syntax
      (`docs/reference/open-decisions.md` D-11) `"pay rent tomorrow 9am
      #household !high"`:
      - `#list` — matched case-insensitively against the caller's real task
        lists; unmatched `#token`s are left as literal text.
      - `!high` / `!med` / `!low` — priority.
      - `@username` — matched against household co-members
        (`GET /groups/members`, same source `TasksAssignedPage.tsx` already
        uses).
      - `today` / `tomorrow` / weekday names — due date.
      - A trailing clock time (`9am`, `9:30pm`, `14:00`) — due time.
      - Unmatched leftover text is simply the task's plain content. The
        parser never throws; a completely unparseable string still creates a
        task with just that content, same as today.
- [ ] `src/hooks/useTasks.ts` gains `updateTaskDueTime`, mirroring
      `updateTaskDueDate`'s guard-free direct-PATCH shape (server already
      accepts `dueTime` in the same PATCH body — `worker/routes/tasks.ts`
      `TASK_COLS` has `due_time`). Task creation from the composer does one
      PATCH with every parsed field (`listId`/`dueDate`/`dueTime`/`priority`/
      `assigneeId`) after `addTask`, optimistically merged into local state —
      extends the pattern `TasksTodayPage.tsx` already uses for
      `listId`/`dueDate` (BUG-009's fix).

**Band card**
- [ ] `.card-head` with a title (today's date) and a summary line: "N due
      today · M of them are already late".
- [ ] Conditional `.chip.chip-warn` "Heaviest day this week", shown only when
      today's count is the max of the existing 7-day load strip.
- [ ] A `.divider` between the band stats and the load strip (currently just
      a margin gap).

**Task rows** (Today's `TaskRow.tsx` specifically — read the large comment
block above `.task` in `src/styles/tasks.css` first; it documents *why*
`TaskRow.tsx` was deliberately kept as a bare 3-child row and how BUG-013's
≤900px collapse rule is scoped to `.task:has(.task-meta)` so it doesn't also
catch this row — that scoping needs to be **revisited to include Today's rows
once they gain a `.task-meta` wrapper, not broken**):
- [ ] List colour chip + name (`.lchip`).
- [ ] Subtask progress (`.sub-count`, "2 of 4") when `subtaskTotal > 0`.
- [ ] Recurrence chip ("Repeats weekly") when `task.recurrence` is set.
- [ ] Wallet-linked chip via `useWalletRefChips`.
- [ ] Due column: daypart label ("Morning"/"Afternoon"/"Evening") for today's
      items with a `dueTime` set, an exact time for the one urgent case, "N
      days late"/"Yesterday" for overdue, weekday+date for future — red when
      late, amber when due today (existing `.task-when.late`/`.soon` classes).
- [ ] Assignee avatar (initials, coloured) — not rendered on Today at all
      today.
- [ ] `.trow-actions` "…" kebab menu, same pattern as
      `TransactionList.tsx` (see reference above).
- [ ] Click-to-edit on the title itself (`TaskListRow.tsx` already has this
      pattern; `TaskRow.tsx` doesn't).

**Group headers**
- [ ] Overdue's reschedule button reads "Reschedule both to today" when there
      are exactly 2, and generalizes correctly for other counts (currently a
      flat "Reschedule all").
- [ ] Done-today's collapse control is a `Hide`/`Show`-style button
      (`btn btn-quiet btn-sm`), not a bare row-toggle chevron.

**Right rail**
- [ ] "Up next" card gains a "Week →" header link to `/tasks/upcoming`
      (currently just a bare card title).
- [ ] New "Lists" card: per-list progress bar, `done/total` across all
      open+completed tasks in that list (`.lrow-list`/`.track`, CSS already
      exists).
- [ ] New "Worth knowing" card — see the note on FEAT-031 below. Scope to only
      what's honestly computable from data already on the page: load
      imbalance across the 7-day strip (action → `/tasks/upcoming`), count of
      tasks with no due date (action → `/tasks/all`), and an evening-heavy-today
      count. Explicitly **not** the mockup's fabricated "moved 4 times" stat —
      no such tracking exists in the data model. Card renders nothing (hides)
      when there's nothing real to say.

**Responsive/PWA**
- [ ] Verify at 1440 / 768 / 390 in both themes in the Browser pane before
      calling this done — `hide-mobile`, `col-hide-md`, `col-mobile-hide`, the
      ≤900px `.task:has(.task-meta)` two-row collapse, and the ≤680px
      composer/`qadd` size-downs in `tasks.css`/`shell.css` all need checking
      against the *rendered* page, not just `tsc` (CLAUDE.md: "neither `tsc`
      nor a diff reviewer catches a design miss").

**Tests**
- [ ] `e2e/69-tasks-today.spec.ts` needs real rewrites, not just additions —
      its last test currently hard-asserts `TaskRow` has **no** `.task-meta`
      wrapper, which this item reverses on purpose. That test becomes an
      equivalent invariant check against the new two-row-at-narrow-width
      layout, not a deletion. New coverage: composer parsing creates a task
      with the right list/priority/assignee/date/time; Mine/Everyone
      filtering; Plan week navigation; Lists card renders real progress;
      Worth knowing card renders a real finding or hides; kebab menu opens
      and its actions work.

**Out of scope.** Upcoming / All tasks / Assigned to me / Completed / Habits /
List detail pages (separate future items). Reminder and Checklist composer
shortcuts (FEAT-055, FEAT-056). Any AI/Claude-backed parsing fallback (would
need its own explicit sign-off per CLAUDE.md rule 12).

**Still needed?** Yes — the owner asked for this explicitly and confirmed the
full gap list in session on 2026-09-22.
