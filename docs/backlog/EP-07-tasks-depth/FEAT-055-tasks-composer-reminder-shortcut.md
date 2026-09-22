> **Status:** Open · **Filed:** 2026-09-22 · **Epic:** [EP-07](README.md)

# FEAT-055 — Tasks: composer "Reminder" shortcut

**What.** A `Reminder` composer shortcut, as shown in `proposal-v2/tasks.html`'s
`.composer-acts` row, that lets the user add a time-based nudge distinct from a
due-dated task — e.g. "check on the roast at 6pm" without it counting as an
overdue task if missed.

**Why now.** Split out of FEAT-054 (Today page design adoption) — there is no
`reminder` entity anywhere in the data model (`src/types/tasks.types.ts`,
`worker/routes/tasks.ts`), and shipping a composer button with no backing
behaviour would violate CLAUDE.md rule 10 ("a click that changes nothing on
screen and explains nothing is the worst outcome a handler can produce"). This
needs its own design decision (is a reminder just a task with `priority: none`
and a `dueTime` but no "late" styling? a separate table? does it need push
notification wiring — see the parked P4 push-notification secrets in
CLAUDE.md §8?) before any UI references it.

**Out of scope.** Any UI work — FEAT-054 ships Today's composer without this
shortcut. Push-notification delivery for reminders (P4 already needs its own
two secrets set per `docs/guides/push-setup.md` before it does anything at
all).

**Still needed?** Question it — depends on whether "a task with no
consequence for missing it" is a real enough distinction from a task to
justify a new concept, or whether a `!none`-priority, no-due-date-badge task
already covers the case. Worth a short product conversation before scoping
this further.
