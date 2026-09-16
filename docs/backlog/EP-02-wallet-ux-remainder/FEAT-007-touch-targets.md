> **Status:** Open · **Filed:** 2026-09-16 · **Epic:** [EP-02](README.md)

# FEAT-007 — 40px minimum touch targets (B11)

**What.** Interactive controls get an enforced minimum hit area (`min-h`/`min-w`)
so they are reliably tappable.

**Why now.** Same as FEAT-006 — the app is installed on phones. Small targets on
a money app mean mis-taps on destructive controls.

**Out of scope.** Visual size changes where padding alone can grow the hit area.

**Notes.** Verified 2026-09-16: no minimum enforced anywhere. Check against the
design system's own spacing scale rather than hardcoding 40px in components.

**Still needed?** Yes — same reason
