# Trips — module plan

**Shell: R6 (`v3.0.0`). Completion: R12–R14 (`v3.6`–`v3.8`).**

Greenfield. Five designed pages, no code, no schema, and no surviving written
spec — `REVIEW.md` v15 references a `travel-module-plan.md` that **is not in this
repo**, so the mockups plus `REVIEW.md` are the entire specification.
[01-data-model.md](01-data-model.md) reconstructs what they imply.

| Doc | What it covers |
|---|---|
| [01-data-model.md](01-data-model.md) | schema, and the ownership rule |
| [02-design-adoption.md](02-design-adoption.md) | R6 — the tab, the route, the January state |
| [03-feature-waves.md](03-feature-waves.md) | R12–R14 — the real module |

Decisions (both resolved 2026-08-21): **D-4** → module; **D-5** → full multi-currency. See [../open-decisions.md](../open-decisions.md).

---

## The property the module is built on

Day is addressed by a date. Tasks by what must happen. Wallet by money.
**A trip is the only object in Daybook that ends.**

That single property changes what every familiar component has to say:

- A budget bar becomes a **burn-down**: not "you are 68% through the month" but
  "RM1,151.53 is what is left and there is no more coming".
- "Are you on track" stops being extrapolation. Days 4–9 already have an
  itinerary with costs on them, so the honest answer is **addition, not
  forecasting**: what you have written down for the rest of the trip costs
  RM1,550.76 and you have RM1,151.53.
- Every unticked prep task has a real deadline, because the flight is one.

*"Your own plan costs RM399.23 more than you have left"* is the module's single
most valuable sentence, and it is only possible because Daybook owns both the
plan and the ledger. No travel app can produce it; they all guess.

---

## Trips owns almost nothing

The rule that keeps a fourth tab from becoming a silo:

> **Every record visible in Trips also lives in its home module. Trips owns only
> what has no home elsewhere** — the trip itself, the wishlist, and bookings.

- Packing lists are **Tasks** subtrees seeded from `task_templates`.
- Trip spend is **Wallet** transactions with a nullable `trip_id`.
- Splitting with a travel companion is the existing Phase 5b groups / splits /
  settlements feature, unmodified.

`trip-prep.html` states the consequence out loud in its rail: *delete the trip
and none of it disappears — the tasks stay in your lists, the money stays in
your ledger, and only the thread between them is cut.* That is
`ON DELETE SET NULL` written as a promise rather than a migration, and it should
be visible in the delete-confirmation copy.

---

## The five cross-module rules

1. **One chip, both directions.** `.tchip` — a small plane glyph in the trip's
   colour — appears on any row in any module carrying a `trip_id`. It is the
   entire visible surface Trips adds to Tasks, Wallet and Day.
2. **Trip mode.** When today falls inside an active trip the app changes state
   rather than asking you to navigate: a trip band under the page title, the
   composer pre-scoped with a removable pill, amounts defaulting to the local
   currency. **On holiday you should not have to tag anything.** The band is
   always visible and always reversible — never silent.
3. **Trip mode changes what you add, not what you can see.** A home task still
   appears on the timeline on day 3 abroad, without a trip chip, because it is
   still yours. The rail card *Home, while you're away* is the payoff: rent
   leaves on the 25th and is funded, the plants are handled, nothing is overdue.
4. **Estimate and actual extend Day's grammar.** Day v14 set solid = happened,
   hollow = planned. In the itinerary the same grammar reads **hollow = an
   estimate, solid = a settled amount**, with the delta between them on the row.
   No new visual language was invented — one was extended from time to money.
5. **Trips has no colour of its own.** Each *trip* carries a hue through a
   `--trip` custom property and every component reads it without naming it, so
   Tokyo is violet and Bali is teal and **no component changed**. Four palettes
   (`.t-violet .t-teal .t-amber .t-blue`) are the only place a trip hue is
   written down; each has a dark-mode lift so any trip is AA on both canvases.

---

## The cost, stated honestly

The bar becomes four tabs, and for most of the year one of them lists things
that are not happening. Two things soften it, both already designed:

- The tab carries a **live count only when something is actually in flight**.
- The landing page is **not** the active trip — it is `trips.html`, opening with
  *travel as a category of your life*: RM7,848 this year, 11.2% of everything you
  spent, 21 days away. Even with nothing booked, that page has something to say.

R6 ships exactly that page, which is why the fourth tab is defensible from the
day it appears.
