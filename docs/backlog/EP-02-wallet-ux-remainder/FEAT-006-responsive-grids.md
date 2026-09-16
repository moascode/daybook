> **Status:** Open · **Filed:** 2026-09-16 · **Epic:** [EP-02](README.md)

# FEAT-006 — Responsive grid breakpoints (B7)

**What.** Wallet's card grids get `sm:`/`md:` column breakpoints so they reflow
on a phone instead of rendering at a fixed column count.

**Why now.** This was deferred when Daybook was a desktop-first home-network
app. It now installs to the iPhone home screen and runs full-screen (v3 P1–P5),
so phone layout is a primary case, not an edge one.

**Out of scope.** Any restyle beyond breakpoints — the design system already
landed in R1–R3.

**Notes.** Verified 2026-09-16: no `sm:grid-cols-*` breakpoints present.

**Still needed?** Yes — it is a phone app now
