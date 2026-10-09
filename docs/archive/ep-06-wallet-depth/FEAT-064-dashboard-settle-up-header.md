> **Status:** Archived · **Last verified:** 2026-10-10 · **Filed:** 2026-10-02 · **Shipped:** 2026-10-09 (PR #252) · **Epic:** [EP-06](../../backlog/EP-06-wallet-depth/README.md)

# FEAT-064 — Dashboard: page-header "Settle up" quick action

**What.** The mockup's Overview page header carries a `Settle up` pill
button, badged with the pending-claims count, next to the Month/Year
toggle — a global, always-visible shortcut to the Shared page, independent
of scrolling down to the Shared card. The real `Dashboard.tsx` header has
only the Month/Year toggle; the only "Settle up" entry point on the page is
the link inside the `SharedSummary` card further down. The underlying data
already exists and is already live on this page: `pendingClaimCount` is
read from `useHouseholdStore` by `SharedSummary.tsx` today (kept current by
the existing app-wide poll in `lib/claim-badge.ts` — the same count the
sidebar's `PendingClaimsBadge` shows), so this is a header button plus a
store read, not a new fetch.

**Why now.** This was an explicit, reviewed design decision, not a draft
detail — `docs/reference/proposal-v2/REVIEW.md` records it across multiple
iterations: *"Actions moved to the page header. `Settle up` and `Add
transaction` sat inside the hero … `Settle up` secondary with its `2`
badge."* (REVIEW.md:267-270), and again at REVIEW.md:179, 209. R3's own
plan (`docs/archive/design-adoption/wallet-design-adoption.md`) says *"No
buttons in the hero — actions live in the page header, where they sit on
every other page"* — the composer became the header's "Add transaction"
answer; this item is the other half of that sentence, "Settle up," which
never shipped.

**Confirmed against the real rendered mockup DOM**
(`http://localhost:4873/dashboard.html`, 2026-10-02):

```html
<div class="page-head">
  <h1>Overview</h1><span class="page-sub">Wallet · 1–17 August</span>
  <div class="segment" role="tablist">
    <button role="tab" aria-selected="true">Month</button>
    <button role="tab" aria-selected="false">Year</button>
  </div>
  <button class="btn btn-secondary"><svg class="icon-sm">…</svg>Settle up<span class="badge">2</span></button>
</div>
```

Dashboard.tsx's real header (confirmed via rendered DOM at `/wallet/dashboard`) has no
equivalent element — only the Month/Year `role="tablist"`.

## Acceptance criteria

- [ ] A `btn btn-secondary` "Settle up" button in `Dashboard.tsx`'s
      `page-head`/`page-actions`, next to the existing Month/Year toggle,
      carrying a badge with `pendingClaimCount` (`useHouseholdStore`).
- [ ] Clicking it navigates to `/wallet/shared` — the same destination
      `SharedSummary`'s own "Settle up →" link and the sidebar's "Shared"
      nav item already use (`dashboard/SharedSummary.tsx:104`). Not a new
      dialog, not a duplicate fetch of settlement data — this mirrors the
      existing navigation pattern rather than re-implementing
      `SettleUpDialog`'s per-group pairing logic on a page that doesn't
      otherwise load it.
- [ ] Hidden (not rendered, not rendered-disabled) when `pendingClaimCount`
      is 0 **and** the user isn't in any group — same "nothing to show for a
      solo user" guard `SharedSummary` already applies to itself. If the
      user is in a group with everything settled, the button may still show
      with no badge (parity with the sidebar's own badge-less state) —
      implementer's call, consistent with whichever the sidebar nav item
      already does.
- [ ] No change to `SharedSummary`'s own in-card "Settle up" link — both
      exist, same as the mockup's header button + the (separate) Shared
      card's own action.
- [ ] No computed figure changes, no schema change.

## Out of scope

Rebuilding `SettleUpDialog` to open inline from the Dashboard — the button
navigates, exactly like every other existing "Settle up" entry point in the
app today.

**Still needed?** No — shipped 2026-10-09 (PR #252).
