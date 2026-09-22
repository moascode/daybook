> **Status:** Open · **Filed:** 2026-09-23 · **Epic:** [EP-07](README.md)

# FEAT-058 — Tasks: All tasks page exact design adoption

**What.** Close the two real gaps between `/tasks/all` and
`proposal-v2/tasks-all.html`. Unlike Today (FEAT-054) and Upcoming
(FEAT-057), this page is already close to the design — it has a filter bar
(arguably more capable than the mockup's, with priority/list/assignee
dropdowns the static prototype doesn't show), date-grouped rows via
`TaskListRow` (already BUG-013-fixed), a 12-week completions chart, and an
age-breakdown sentence ("Where tasks go to die"). Comparing the actual
rendered mockup against the live page surfaced exactly two real deltas, not
a rebuild. Page-scoped: **All tasks only.**

**Why now.** Continuation of the FEAT-054/057 design-adoption pass through
the Tasks module, authorized by the owner on 2026-09-23 to proceed
autonomously.

**Reference implementations to copy, not reinvent:**
- Composer: `src/modules/tasks/composer/TaskComposer.tsx` +
  `TaskFormModal.tsx` (FEAT-054), reused as-is — same Task/Habit/Assign
  shortcuts (no Reminder/Checklist), same wiring pattern `TasksUpcomingPage.tsx`
  (FEAT-057) uses for a page whose composer-created tasks should NOT be
  forced onto a specific date (an undated task here should stay undated,
  landing in the existing "No due date" group — same principle as
  Upcoming's composer, the inverse of Today's BUG-009 default).
- Stat card idiom: **correction, 2026-09-23** — this originally said to
  replace `.stat-card` with `.band-stats`/`.band-stat`, claiming `.stat-card`
  "has no sub-line slot." That was wrong on both counts, caught in review:
  the real rendered mockup uses `.stat-card`/`.stat-topline`/`.stat-icon`/
  `.stat-label`/`.stat-value`/**`.stat-foot`** — the sub-line slot already
  exists (`src/styles/data.css` `.stat-foot`, already styled), and
  `.band-stats` doesn't appear anywhere on this mockup page. Keep the
  existing `.stat-card` idiom; add `.stat-foot` under each `.stat-value`.

## Acceptance criteria

**Composer**
- [ ] A composer at the top of the page (below the page head, above the
      stat cards), reusing `TaskComposer`/`TaskFormModal` unchanged. A task
      created with no parsed date stays undated — lands in the existing
      "No due date" group, not forced onto today.

**Stat cards**
- [ ] Keep the four `.stat-card`s; update to the mockup's actual four
      stats and add their real `.stat-foot` sub-lines, all honestly
      derivable from data already loaded
      (`openTasks`/`completedTasks` — no new fetch):
      - **Overdue** (existing `overdueCount`) — sub-line: "oldest is N days
        old" (reuse the same days-late computation `TaskRow.tsx`'s
        `daysLate` already has, adapted to find the max across overdue
        tasks — same pattern FEAT-057 built for Upcoming's "oldest is N
        days" band-stat, don't reinvent it a third time, extract if a
        shared helper is trivial).
      - **Due this week** (dated tasks within the next 7 days, inclusive of
        today — NOT the current "Due today" stat, which undercounts vs the
        mockup's weekly framing) — sub-line: "N of them today" (today's
        subset of that count).
      - **No due date** (existing `noDueDateCount`) — sub-line: "N sitting
        in {list name}" for whichever single list holds the most of them,
        if any meaningfully dominate; omit the sub-line if no list clearly
        dominates rather than forcing a misleading one.
      - **Done this week** — count of `completedTasks` completed in the
        last 7 days. Do NOT add the mockup's "+N vs usual" comparison — it
        needs a historical weekly average this page has no data to compute
        (same category FEAT-054 and FEAT-057 both already declined to
        fabricate).
- [ ] Drop the current "Open" stat card — it's not one of the mockup's
      four and its count is already visible as the page's own filtered
      row count.

**Out of scope.** Everything else on this page (filter bar, filter chips,
date-grouped rows, the completions chart, the age-breakdown sentence) is
already at or past design parity and is explicitly NOT touched by this
item. Assigned to me / Completed / Habits / List detail pages (separate
future items, same pattern).

**Still needed?** Yes — the two deltas above are real and visible; everything
else on this page was confirmed already shipped against the design.
