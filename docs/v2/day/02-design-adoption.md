# Day — design adoption (R6)

R6 makes the first tab real. It ships a working timeline built only from data
that already exists, and is explicit about what is not there yet.

---

## What ships

**`/day`**, the app's landing route (replacing today's `/` → `/tasks` redirect).

**The band** — both figures, real:
- `N of M` tasks done today, from `tasks` + R4's `completed_at`
- today's net, from `transactions` via `countableAmount`
- money in, moved to savings, still to happen

Equal type size, hairline between them. Neither module is the headline.

**The timeline** — completed tasks, tasks due today, and today's transactions,
merged onto one spine. Ordered by `due_time` / `completed_at` / `created_at`
(D-6 interim), with **no clock time displayed on money rows**.

**The solid/hollow grammar and the `now` rule**, which work correctly from day
one because they depend on ordering, not on precise times.

**The date stepper** (prev / today / next) in the page header — Day is addressed
by a date, so this is not optional chrome.

**The sidebar**, including the four **Show on the timeline** toggles. They are
navigation, not settings: Day is a merge, so what it merges must be a visible
control. In R6 the Notes toggle is disabled with a reason.

---

## What explicitly does not ship in R6

Notes, Close the day, Against your usual, On this day, the month grid, the
composer, the hour ribbon, and This week / Calendar / Weekly review. Each is
either R15 or R16.

The sidebar shows those destinations **disabled with a stated reason**, matching
how R2 handles the not-yet-live module tabs. A dead link is worse than an
honest one.

---

## Done when

- `/day` is the landing route and the first app-bar tab.
- The band figures agree with what Wallet and Tasks say for the same day. If
  they disagree, one of the three is wrong — that reconciliation is the best test
  this release has.
- Both themes, 1440 / 768 / 390.
- A spec covering the merge order, the `now` split, and the toggles.

With `/trips`, this completes **v3.0**.
