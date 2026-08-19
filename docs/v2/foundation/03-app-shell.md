# App shell (R2)

Source: `REVIEW.md` v5 (the shell decision) and v6 (search focus); markup in the
`<header class="appbar">` block of every proposal page.

Replaces: `AppShell.tsx`, `Sidebar.tsx`, `TopBar.tsx`, `routeTitles.ts`.

---

## 1. What changes and why

Today one sidebar answers two questions at once — *which module am I in* and
*where inside it* — and REVIEW's verdict is that this is "the same control
fighting itself". v2 splits them:

- **The app bar answers "which module".** Permanently, as a fixed set of tabs.
- **The sidebar answers "where inside it".** Module-scoped, nothing else.

A dropdown was tried (v3) and rejected: modules are a fixed set the user cannot
add to, and a dropdown implies otherwise.

## 2. The app bar

Full width, above the sidebar, three zones:

```
LEFT     ☰(mobile)  ·  D logo  ·  [ search pill ]
CENTRE   Day    Tasks(6)    Wallet    Trips(3)          ← icon-only tabs
RIGHT    (+)  (bell·3)  (avatar ▾)
```

- **Module tabs are icon-only**, name on hover as a tooltip, active one gets a
  3px accent underline flush to the bar's bottom edge that wipes in from 20%
  width over 280ms.
- **Badges are live counts, not decoration.** Tasks = tasks due today +
  overdue. Trips = active + upcoming trips (R6+; absent until then). Bell =
  pending invites + unresolved split claims + bills due (D-8) — all three
  already exist and two are already polled in `Sidebar.tsx`.
- **Day and Trips render disabled with a tooltip until R6**, not hidden. The
  shell's final shape should be visible from R2, and a disabled control with a
  stated reason is honest where a dead link is not.
- On mobile the tabs collapse into the drawer and quick-add drops out (the FAB
  covers it), leaving logo · search · bell · avatar.

## 3. Global search field

Shell only in R2 — the results panel is R17.

- Placeholder `Search Daybook…`; `aria-label` "Search across all modules".
- **No scope chip in the resting state.** v3 put an "All modules" chip inside
  the field; v6 removed it because it rendered as a second pill inside the pill.
  Scope belongs in the results dropdown.
- **Focus animation** (280ms, shared easing): grows 268px → 420px, scales ~1.02,
  swaps to a solid surface, lifts onto `--e3`, magnifier tints to accent.
- **Suppress the global `:focus-visible` ring inside `.search`** — the wrapper
  owns the focus affordance. Two rings is the bug v6 fixed.

## 4. Module-scoped sidebar

Header names the module (`Wallet / Household ledger`), then that module's nav
only.

| Module | Nav |
|---|---|
| **Wallet** | Overview · Transactions · Accounts · Shared — Plan: Budgets · Goals · Recurring — Analyse: Reports |
| **Tasks** | Today · Upcoming · All tasks · Assigned to me — Lists: (user's lists, colour dot + count) — Review: Completed · Habits |
| **Day** | Today · This week · Calendar · Notes — **Show on the timeline**: Tasks & habits / Money / Scheduled & bills / Notes — Review: Weekly review · On this day |
| **Trips** | Active trip · Itinerary · Prep · Bookings — All trips · Wishlist |

Day's *Show on the timeline* toggles are navigation, not settings: Day is a
merge, so what it merges has to be a visible control.

**Import CSV leaves the sidebar.** It is module-specific data plumbing sitting
at the same level as primary navigation. It becomes a button on the Transactions
page and *Import & export data* in the profile menu — as does merchant
canonicalisation (D-14).

Keep the `trust-note` footer (`On your hardware`). It is true and it is the
product's position.

## 5. Account menu — two panes

Pane 1 (root):
- A raised card: **you** (avatar, username, "View your profile"), then the
  ledgers you can switch between with the active one ticked, then a full-width
  *See all ledgers*. Ledger switching is **D-7**; if not approved, render the
  user's groups here with no switch.
- Flat list with circular icon bubbles: Settings & privacy › · Help & support › ·
  Display & accessibility › · Report a problem · Log out.
- A legal/version footer.

Pane 2 (`Settings & privacy`, slides across with a back arrow):
- Global first: **Preferences** · **Privacy & data** · **Household**
- Then a `MODULE SETTINGS` group: **Wallet** · **Tasks** · **Day** · **Trips**,
  each with a one-line description.

This is the resolution of the global-vs-per-module settings split the owner
asked for, one level deep, with no extra nav item. It supersedes today's
`/settings` + `/settings/sharing` layout — keep those routes working and point
the menu at them.

## 6. Mobile

- **Bottom tab bar** (Day · Tasks · Wallet · Trips) + **FAB** for the module's
  primary add action. The two things you do on a phone become thumb-reachable;
  today the primary actions are at the top of the page.
- Sidebar becomes an off-canvas drawer.
- Target: the proposal took the same Overview page from 8,400px of scroll to
  ~2,400px. Measure it.

## 7. Implementation notes

- `AppShell.tsx` gains the bar; `Sidebar.tsx` becomes `ModuleSidebar.tsx` taking
  a module descriptor. Put the four descriptors in one file — the bar, the
  sidebar, the mobile tabs and the settings pane all read the same list, and
  they will drift the moment they each own a copy.
- `routeTitles.ts` is absorbed into the module descriptors.
- The existing invite/claim polling in `Sidebar.tsx` moves up to the shell, since
  the bell badge needs it too. Keep `refreshClaimBadge` as the single writer —
  it exists because the poll and the resolving actions used to write different
  numbers to the same field.

## 8. e2e watch-outs

- **`getByLabel()` matches substrings** (CLAUDE.md §16 trap 3). The bar adds
  ~8 labelled controls. Before merging, grep every `getByLabel` string in `e2e/`
  and check none of them now resolves to more than one element. Fix collisions
  by renaming the *app* control, never by patching the spec.
- Both mobile and desktop chrome are in the DOM. Match `visible=true`.
- Sidebar-navigation specs use `window.__test*` hooks — those only exist under
  `TEST_HOOKS_ENABLED`. Re-point them at the new nav in the same PR.
