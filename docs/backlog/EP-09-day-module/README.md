> **Status:** Open · **Filed:** 2026-09-16 · **Roadmap:** R15–R16

# EP-09 — Day module

**What.** Day exists as a timeline with a date stepper (R6). This epic gives it
real time-of-day, notes, a composer, and the "Close the day" ritual the module
was designed around.

**Spec:** [day/03-feature-waves.md](../../roadmap/design-adoption/day/03-feature-waves.md).

**Is this epic still worth doing?** Yes, but note what it actually is:
**everything in R15 is scaffolding for one feature** —
[FEAT-044](FEAT-044-day-close-the-day.md), Close the day. If that
ritual is not something you would genuinely use, the rest of the epic loses most
of its point and Day stays a read-only timeline, which is not a bad outcome.

So the honest ordering question is not "which item first" but **"would you close
your day in this app?"** Answer that, then build toward it or drop the epic to
just [FEAT-045](FEAT-045-day-usual-and-on-this-day.md), which is a pure
read over existing data and cheap on its own.

One schema change: [FEAT-041](FEAT-041-day-hour-ribbon.md) needs
time-of-day (decision D-6). Additive.

## Items

| ID | Title | Still needed? |
|---|---|---|
| [FEAT-041](FEAT-041-day-hour-ribbon.md) | Real time-of-day and the hour ribbon | Yes — foundation, needs D-6 |
| [FEAT-042](FEAT-042-day-notes.md) | Notes as timeline entries | Yes |
| [FEAT-043](FEAT-043-day-composer.md) | Composer writing to either module | Yes — reuses R7's composer |
| [FEAT-044](FEAT-044-day-close-the-day.md) | Close the day | **The whole point of the epic** — decide this first |
| [FEAT-045](FEAT-045-day-usual-and-on-this-day.md) | Against your usual, On this day | Yes — cheap, standalone |
| [FEAT-046](FEAT-046-day-month-grid.md) | Month grid, This week, Calendar, Weekly review | Yes |
