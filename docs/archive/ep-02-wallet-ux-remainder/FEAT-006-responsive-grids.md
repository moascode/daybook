> **Status:** Archived · **Last verified:** 2026-09-18

Dropped 2026-09-16, archived 2026-09-18 with the rest of [EP-02](README.md).

# FEAT-006 — Responsive grid breakpoints (B7)

**Dropped 2026-09-16.** Superseded by other work: Wallet's Dashboard/Reports
grids moved off Tailwind `grid-cols-N` entirely onto a custom responsive CSS
grid system (`src/styles/layout.css`), which already has its own breakpoints.
The card/summary/chart grids this item was filed against no longer exist in
that form. Two small leftover form grids (`TransactionForm.tsx:305`,
`WalletPage.tsx:1055`) are tracked as part of
[FEAT-007](FEAT-007-touch-targets.md) instead of kept open here — see
[design.md](design.md).

**What.** Wallet's card grids get `sm:`/`md:` column breakpoints so they reflow
on a phone instead of rendering at a fixed column count.

**Why now.** This was deferred when Daybook was a desktop-first home-network
app. It now installs to the iPhone home screen and runs full-screen (v3 P1–P5),
so phone layout is a primary case, not an edge one.

**Out of scope.** Any restyle beyond breakpoints — the design system already
landed in R1–R3.

**Notes.** Verified 2026-09-16: no `sm:grid-cols-*` breakpoints present.

**Still needed?** Yes — it is a phone app now
