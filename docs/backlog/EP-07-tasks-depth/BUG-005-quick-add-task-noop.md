> **Status:** Open · **Filed:** 2026-09-20 · **Epic:** [EP-07](README.md)

# BUG-005 — Quick-add "Task" does nothing

**Expected.** Clicking "Task" in the global `+` quick-add menu (desktop app
bar and the phone FAB — `src/components/layout/QuickAddMenu.tsx`) gives the
user a fast path to actually create a task, the way Expense/Income/Transfer
open a pre-filled Wallet form via one-shot navigation state.

**Actual.** The "Task" action (`QuickAddMenu.tsx:66`) only calls
`navigate('/tasks')` with no state and closes the menu. If the user is
anywhere other than `/tasks`, this just changes the route with no composer
opened. If the user is already on `/tasks` (or any `/tasks/*` page), the
navigation is a no-op — the menu closes and literally nothing happens on
screen, which is what the owner reported as "doesn't work."

**Repro.**
1. From any Tasks page (e.g. `/tasks`, `/tasks/all`), click the `+` quick-add
   button.
2. Click "Task".
3. Menu closes; no composer opens, no input is focused, nothing changes.

**Where I think it lives.** `src/components/layout/QuickAddMenu.tsx:66` — the
`task` action's `go` callback, confirmed by reading the code. Owner confirmed
this matches what they saw. Not yet confirmed: what the *fixed* behaviour
should focus/open — the outliner has no existing "open composer with focus"
entry point analogous to Wallet's `quickAddType` state, so the fix likely
needs a small addition there too (e.g. a `focusNewTask` nav state that
`TasksTodayPage`/`TasksPage` reads to auto-focus a new bullet row).

**Money, data loss, or cosmetic?** Cosmetic/functional gap — no data at risk,
but it's a dead affordance in a shipped, advertised control.

**Still needed?** Yes.
