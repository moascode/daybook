# Cross-cutting (R17 · `v4.0.0`)

Things no single module owns. Most are drawn in the proposal and inert in it —
the command palette has been in the top bar since v2 and does nothing.

---

## 1. Global search results

The bar's search field has existed as a shell since R2. R17 gives it a results
panel.

- **Grouped by module** — Transactions / Tasks / Accounts / Trips / Notes.
- **Scope lives in the results dropdown, not in the resting field.** v3 put an
  "All modules" chip inside the field and v6 removed it because it rendered as a
  pill inside a pill.
- **Day's timeline entry row is the obvious component** for rendering a mixed
  result list — the design says so explicitly, and it is already built by then.

Backend: a new `GET /api/search?q=&scope=`. No search infrastructure exists;
SQLite `LIKE` over the indexed columns is enough at this data size, and FTS5 is
available in D1 if it is not.

## 2. Command palette (⌘K)

CLAUDE.md §9.1 already reserves `Cmd/Ctrl+K`. `REVIEW.md` calls it *"the cheapest
big win"* for a keyboard-driven app. Actions: navigate anywhere, run any
composer shortcut, switch module, toggle theme, jump to a date.

## 3. Notifications

Per D-8, the bell should already be backed by real counts from R2 — invites,
unresolved split claims, bills due. R17 turns it into a panel with a read state.
A general notification store is only worth building if a fourth source appears.

## 4. Empty, loading and error states

`.skel` and `.empty` are in the sheet and **no page demonstrates them**. The
design's own worth-doing-next list puts this second, and it is right:
*first-run with zero accounts is the most important screen not yet designed.*

Two rules, and the second is CLAUDE.md rule 13:

- Every page gets a first-run state that tells a new user what to do, not just
  that there is nothing here.
- **Every failure says something actionable.** A card that renders blank because
  its query threw is exactly the bug rule 13 exists to prevent — a broken service
  and a service with nothing to return render identically, and the user is given
  no reason to retry. The insight cards in R7–R11 compute a lot; each one needs a
  visible failure state.

## 5. Density toggle

Comfortable / compact row heights. The design's first worth-doing-next item:
*power users with 500 transactions a month will want compact.* A single token
swap on row padding and font size, applied at the shell.

## 6. Number formatting rules

Per D-9, and worth a shared module rather than scattered `formatMYR` calls:
true minus sign (U+2212), cents always in a row amount, cents dropped in
summaries ≥ RM1,000, tabular figures everywhere.

## 7. Two standing risks a v4.0 should not ship without

From CLAUDE.md §13, both open since before this redesign:

1. **No rate limiting on the public URL.** The one paid endpoint has a per-user
   hourly cap; the URL itself is public and this is the oldest open risk on a
   live money app.
2. **ISO date validation accepts impossible calendar dates.** `Date.parse` rolls
   Feb 30 over instead of returning `NaN`, so both `transactionInputError` and
   `isoDateError` pass them. Present in **both** backends. Day and Trips are
   date-addressed modules; shipping them on a validator that accepts 31 February
   is asking for it.

Neither is design work. Both belong in the release that calls itself v4.0.
