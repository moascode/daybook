> **Status:** Open · **Filed:** 2026-09-16

# EP-04 — Money-figure correctness

**What.** Defects where a figure Daybook shows is, or may be, wrong.

**Is this epic still worth doing?** It is the one epic where the answer can only
be yes. Daybook is a money app used by two real people; a number that is quietly
wrong is worse than a feature that is missing, because nothing signals it.

Both items are cheap. Neither has a UI component. Both are the kind of defect
that survives indefinitely because no one is looking.

## Items

| ID | Title | Still needed? |
|---|---|---|
| [BUG-002](BUG-002-impossible-calendar-dates.md) | ISO validation accepts Feb 30 / Apr 31 | **Yes** — silently relocates a transaction to another day |
| [BUG-003](BUG-003-day-header-split-totals.md) | Day headers may double-count splits | **Yes** — and the first step is confirming whether it's real |

> Both are also listed in the design-adoption plan as things a public `v4.0.0`
> should not ship without ([EP-10](../EP-10-cross-cutting/README.md)). They are tracked
> here, not there — a bug is a bug regardless of which release notices it.
