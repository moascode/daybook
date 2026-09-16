> **Status:** Open · **Filed:** 2026-09-16 · **Epic:** [EP-03](README.md)

# FEAT-013 — Centralise `formatDisplayDate`

**What.** One helper in `src/lib/utils.ts`, replacing the inline
`format(parseISO(d), 'dd MMM yyyy')` calls scattered across the app.

**Why now.** 15+ copies means the display format is one careless edit away from
being inconsistent between two screens, and there is nowhere to change it once.

**Out of scope.** Changing the format itself.

**Notes.** Verified 2026-09-16 as never centralised. `formatMYR` is the pattern
to follow. Watch the timezone trap — the e2e suite runs on a pinned business
clock (CLAUDE.md §3).

**Still needed?** Yes — 15+ inline copies
