> **Status:** Open · **Filed:** 2026-09-23 · **Epic:** [EP-07](README.md)

# FEAT-057 — Tasks: Upcoming page exact design adoption

**What.** Bring `/tasks/upcoming` to full visual and behavioural parity with
`proposal-v2/tasks-upcoming.html`, the same treatment FEAT-054 gave Today.
FEAT-026 already shipped the functional core — the seven-column drag-and-drop
week board, per-day inline add, "Waiting for a date" section, and a working
"Balance the week" action — so this is a wiring/finishing pass on top of a
real feature, not a rebuild. Page-scoped: **Upcoming only.**

**Why now.** FEAT-054 proved the pattern (compare the actual rendered mockup,
not just its raw HTML, against the live page) and the owner asked to continue
it through the rest of the Tasks module while working autonomously overnight,
confirmed in session on 2026-09-23.

**Reference implementations to copy, not reinvent:**
- Composer shell: `src/modules/tasks/composer/TaskComposer.tsx` +
  `TaskFormModal.tsx` (FEAT-054) — the mockup shows the same shared composer
  at the top of Upcoming as on Today (Task/Habit/Assign shortcuts; Reminder
  and Checklist stay excluded per FEAT-055/FEAT-056, same as Today).
- Card/row chip idioms: `TaskRow.tsx` (FEAT-054) for list-colour left edges,
  chip styling, and the two-column due-label pattern where relevant.

## Acceptance criteria

**Page head**
- [ ] A composer at the top of the page, reusing `TaskComposer`/`TaskFormModal`
      as-is (no new component) — tasks created here without an explicit date
      land wherever the parser/form puts them (`Waiting for a date` if none
      given), not forced onto a specific day.
- [ ] A summary line under the title: "N scheduled, M waiting for a date"
      (both counts already derivable from the page's loaded task set).

**Band / stats**
- [ ] A headline callout when one day is genuinely heavier than the rest
      (mockup: "Wednesday is doing too much") — reuse the same
      max-vs-rest-of-week comparison FEAT-054 built for Today's "Heaviest day
      this week" chip; do not duplicate the logic, extract if needed.
- [ ] Two band-stat cards: **Hard deadlines** (count of dated tasks with no
      recurrence and no wallet link — the mockup's definition of "hard") and
      **Recurring** (count with `recurrence` set) — each with the mockup's
      short descriptive sub-line style (e.g. "insurance, rent, review" — the
      actual task names, truncated to fit, not a fabricated stat). The
      mockup's third stat, **"Your usual week … this week is 41% heavier,"**
      is a comparison against a historical weekly average this page has no
      data to compute (same category as Today's "best week since June",
      which FEAT-054 also skipped) — do not fabricate it or implement a
      "usual" that's actually just this week's own count relabelled.

**Balance the week**
- [ ] Becomes a dedicated card (not just a header button) when the week is
      unbalanced, showing each proposed move as its own row: task name,
      one-line reason ("No deadline, and Saturday is nearly empty"), and a
      `Move` action — matching the mockup's shape, built on the existing
      `canBalance`/`handleOpenBalance`/`handleConfirmBalance` logic already in
      `TasksUpcomingPage.tsx` (extend it to surface *why* each candidate was
      picked, not just move it).
- [ ] Card hides entirely when the week is already balanced (existing
      `canBalance` gate), consistent with FEAT-054's Worth-knowing card
      pattern of hiding when there's nothing real to say.

**Responsive/PWA**
- [ ] Verify at 1440 / 768 / 390 in both themes in the Browser pane — the
      seven-column board is the one place in the app where the layout is
      genuinely a canvas, not a list; confirm it degrades sanely at narrow
      widths rather than just squeezing.

**Tests**
- [ ] Extend the existing Upcoming e2e spec (`e2e/91-tasks-upcoming.spec.ts`)
      with coverage for: composer creates a task correctly from this page,
      the summary line's counts, the Hard-deadlines/Recurring/Your-usual-week
      stats, and the Balance-the-week card's per-move rows and hide-when-
      balanced behaviour.

**Out of scope.** All tasks / Assigned to me / Completed / Habits / List
detail pages (separate future items, same pattern). Any AI/Claude-backed
suggestion generation (CLAUDE.md rule 12 — none needed here, everything above
is derivable from already-loaded data).

**Still needed?** Yes — continuation of FEAT-054's design-adoption pass,
authorized by the owner on 2026-09-23 to proceed autonomously through the
rest of the Tasks module.
