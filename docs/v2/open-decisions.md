# Open decisions

Numbered `D-NN`, in the v2 namespace. Each says what is being decided, what
happens if it goes either way, and which release is blocked. A decision with a
**Recommendation** can be taken by whoever picks the release up; a decision
marked **Owner sign-off** cannot (CLAUDE.md rule 10 / rule 8).

| # | Decision | Blocks | Status |
|---|---|---|---|
| D-1 | CSS strategy: ported component layer vs Tailwind utilities | R1 | Recommendation below |
| D-2 | `.dark` class vs `[data-theme]` | R1 | Recommendation below |
| D-3 | Does the bullet outliner survive, and where? | R4, R5 | **Owner sign-off** |
| D-4 | Trips as a fourth module vs a lens | R6 | **Owner sign-off** |
| D-5 | Multi-currency — reverses the MYR-only decision | R14 | **Owner sign-off** |
| D-6 | Time of day on a transaction | R6 (interim), R15 (real) | Recommendation below |
| D-7 | Ledger switching (Household / Personal) | R2 | **Owner sign-off** |
| D-8 | Notifications — is there anything to notify about? | R2 (badge), R17 | Recommendation below |
| D-9 | Number formatting: minus sign, cents in summaries | R1 | Recommendation below |
| D-10 | Category colour: per-category or per-type | R7 | Recommendation below |
| D-11 | Composer parsing: rules or Claude | R7 | **Owner sign-off** (Phase 5a) |
| D-12 | Currency in the mockups is `$`; the app is MYR | R1 | Recommendation below |
| D-13 | e2e churn: convert selectors or accept rewrites | R1 | Recommendation below |
| D-14 | Keep `/wallet/canonicalize-merchants` in the new IA? | R3 | Recommendation below |
| D-15 | Task sharing across the household | R4, R10 | **Owner sign-off** |

---

## D-1 · CSS strategy

The proposal is 2,185 lines of hand-written CSS with ~80 named component
classes. The codebase is Tailwind utilities inline.

**Recommendation: hybrid, split by whether the component has structure.**

- **Port the CSS** for anything with real internal structure or its own motion:
  the shell (`.appbar`, `.sidebar`, `.modtab`, `.menu-panel`), the timeline
  (`.tl`, `.ribbon`, `.tl-now`), charts (`.donut`, `.col`, `.burn`), the
  itinerary (`.ir`), heatmaps, rings, `.trow`, `.tday`, `.cmp`. These are where
  a Tailwind translation would silently drift from the design, and the design's
  own review notes several of them were tuned by eye.
- **Use Tailwind utilities**, resolving to the same tokens, for layout, spacing
  and one-off composition inside pages.

Translating the whole sheet into utilities is the option that looks cleaner and
costs the most: it is ~80 hand-translations, each an opportunity to lose a
value, with no test that can catch the loss.

## D-2 · Dark mode selector

The proposal uses `[data-theme="dark"]`; the codebase uses `.dark` with
Tailwind's `darkMode: 'class'`, and `index.html`'s **load-bearing pre-paint
script** (CLAUDE.md §18 rule 5) writes the class.

**Recommendation: emit both.** `gen-theme-tokens.mjs` writes the dark block
under `.dark, [data-theme="dark"]`, and `applyTheme` sets both the class and the
attribute. Ported CSS works unchanged, Tailwind works unchanged, and the
pre-paint script gains one line. Spec 58 (which blocks the JS bundle to prove
the pre-paint works) must be extended to assert the attribute too.

## D-3 · The bullet outliner — **owner sign-off**

`TasksPage.tsx` is 792 lines of Workflowy-style outliner: nested tree, keyboard
shortcuts, zoom-to-bullet, DnD, notes. **The proposal contains no outliner.** Its
Tasks module is grouped flat lists with a subtask count.

Three options:

1. **Keep it as a view mode on the list-detail page** *(recommended)*. `parent_id`
   already exists, so the tree is the storage model and the designed pages are
   flat projections of it. Nothing is lost; the outliner stops being the front
   door.
2. Keep it as its own sidebar item ("Outline"). Cheapest, but leaves two Tasks
   products side by side.
3. Retire it. Fastest to build, and throws away a working feature the app was
   built around (CLAUDE.md §9.1 is entirely about it).

This has to be the owner's call — it is the one place the redesign deletes
shipped functionality rather than adding to it.

## D-4 · Trips: module or lens — **owner sign-off**

`REVIEW.md` v15 argues for a fourth module: a wishlist and bookings are neither
tasks nor transactions and have nowhere to live otherwise. The cost is a fourth
tab that, for most of the year, lists things that are not happening.

The design's mitigation is real (the landing page is *travel as a category of
your life*, not the active trip), but this is a permanent change to the app's
top-level shape. Confirm before R6 builds the tab.

## D-5 · Multi-currency — **owner sign-off**

CLAUDE.md §6 records the app as single-currency: *"the per-account currency
selector was removed; `currency` stays 'MYR'"*. Trips needs a per-transaction
original amount, an original currency and a captured rate, and the rate card is
one of the module's best ideas — it separates the overrun the exchange rate
caused from the overrun you chose.

Scope if approved: `transactions` gains `original_amount`, `original_currency`,
`fx_rate`; every money surface must decide which figure it shows;
`formatMYR` grows a sibling. This touches more of the app than any other item in
this plan, which is why R14 is where it lands and not earlier.

## D-6 · Time of day on a transaction

`transactions.date` is `YYYY-MM-DD`. The Day timeline is ordered by *time*.

**Recommendation: two steps.** R6 orders by `created_at` (already present,
already a full timestamp) and does not show clock times on money rows — the
ribbon and ordering work, nothing lies. R15 adds a nullable
`transactions.occurred_at`, set by the composer and editable in the form, falling
back to `created_at`. CSV imports leave it null and sort to the day's start.

Do **not** display `created_at` as if it were the purchase time — a row imported
at 23:00 for a 09:00 coffee would place the coffee at 23:00, and the whole point
of the timeline is that 09:41 Whole Foods and 09:48 "log the receipt" sit seven
minutes apart.

## D-7 · Ledger switching — **owner sign-off**

The designed account menu switches between a **Household** ledger and a
**Personal** one. Today there is one ledger per user plus `groups` for sharing
individual accounts — related, but not the same thing: a ledger switch changes
what every page shows, whereas a share grants visibility of one account.

If not approved, R2 renders the menu card with the user's groups and no switch,
which is a smaller but coherent version of the same control.

## D-8 · Notifications

The bar carries a `3` badge. Nothing in the app produces notifications, but
three real sources already exist: **pending group invites**, **unresolved split
claims** (both already polled by `Sidebar.tsx` and already badged), and
**upcoming bills**.

**Recommendation:** R2 renders the bell backed by those three counts — real
data, no new system. A general notification store is R17, if ever.

## D-9 · Number formatting

**Recommendation, following the proposal:**
- True minus sign `−` (U+2212), not the hyphen — it aligns in tabular figures.
- Cents always in a row amount; cents dropped in summary figures ≥ RM1,000.
- `font-variant-numeric: tabular-nums` on every money value, non-negotiable.
- Currency prefix `RM`, per `formatMYR`'s existing `ms-MY` locale output.

## D-10 · Category colour

REVIEW's open item: six semantic hues will not cover thirty categories.
Categories already carry a user-set `color` in the schema.

**Recommendation: keep per-category colour** (the data already exists and the
user has already chosen them), and use the six semantic roles only for
*meaning* — positive, negative, warning, info. Charts read category colours;
chips and states read semantics. `chartColors.ts` already does roughly this.

## D-11 · Composer parsing — **owner sign-off**

The composer's whole argument is that `coffee 4.20 cash` beats a form. Two ways
to parse it:

- **Rules.** Deterministic, offline, free, testable — and brittle on anything
  the grammar did not anticipate.
- **Claude.** CLAUDE.md §9.3 already specifies this (*Natural language
  transaction entry, Haiku, 200 tokens*) and the API-key infrastructure shipped
  in PR #112. But §9.3 is otherwise deferred, and rule 10 requires per-item
  sign-off.

**Recommendation if approved:** rules first with a visible parse preview, Claude
as the fallback when the rules do not match — the exact shape the AI bulk
categorisation already uses, and it keeps the composer working with no API key.

## D-12 · `$` in the mockups

Every figure in the proposal is dollars. **Recommendation: mockup artifact, no
change.** The app is MYR and `formatMYR` is the only formatter. Do not port a
`$` into any component.

## D-13 · e2e churn

63 spec files, 1,423 role/text/label lookups against markup that is about to
change, 507 testid lookups that are not.

**Recommendation: pay it down in R1, before any reskin.** Add `data-testid` to
the reskin-target elements and convert their assertions first. Doing it after
means every reskin PR carries a pile of unrelated spec edits, and a genuinely
broken page hides inside them. Detail in
[foundation/04-e2e-and-migration.md](foundation/04-e2e-and-migration.md).

## D-14 · Merchant canonicalisation page

`/wallet/canonicalize-merchants` is in flight on `main` right now and is not in
the proposal. **Recommendation: keep it**, moved into the profile menu's
*Import & export data* group alongside Import CSV — it is data plumbing, which
is exactly what the proposal moved out of the sidebar.

## D-15 · Task sharing — **owner sign-off**

The designed Tasks module is household-shared throughout: assignees, "Assigned
to me", turnaround times per person, a 90-day split of who completes what.
**Tasks today are strictly `user_id`-scoped with no sharing whatsoever.**

Approving this means tasks get roughly what accounts got in Phase 5b: a list can
be shared to a group, membership grants visibility, and a task can be assigned
to a member. That is a real feature, not a rendering change, and it is the
largest hidden cost in the Tasks track.

If not approved, R4 drops `assignee_id`, R5 drops the avatar column, and R10
drops "Assigned to me" entirely — the rest of Tasks is unaffected.
