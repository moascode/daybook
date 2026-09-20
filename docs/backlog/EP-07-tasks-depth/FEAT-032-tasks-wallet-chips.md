> **Status:** Shipped · **Filed:** 2026-09-16 · **Epic:** [EP-07](README.md)

# FEAT-032 — Tasks: Wallet chips on task rows

**What.** Show related spend on a task row where the two are linked.

**Why now.** Small, and the cross-module link is what makes Daybook one app rather than two.

**Design.** [design.md](design.md) — the design work is already done; this item tracks *whether* to build it, not how.

**Still needed?** Shipped — a nullable `tasks.wallet_ref` (`kind:id`,
`recurring:<id>` or `goal:<id>`), set from the outliner's "Link to Wallet…"
dialog and rendered as a chip (`Wallet · RM89.90 due tomorrow` /
`Wallet goal · 88% funded`) resolved client-side from data every Wallet page
already fetches. Scoped down from the full design: no wallet chip yet on
list-style rows outside the outliner (only `BulletNode.tsx`), and "Up next"
mixing modules in the Today rail was left for a future pass — both are small,
separable follow-ups if wanted, not needed to call this item done.
