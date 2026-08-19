# Trips — feature waves (R12–R14)

---

## R12 · `v3.6.0` — the trip, the burn-down, the thread

**Schema**: `trips` + `trip_id` on `transactions` and `tasks`
([01-data-model.md](01-data-model.md)).

### `trips.html` — the full page

Travel as a category (shipped R6), then **the active trip as a full-width band
rather than one card in a grid** — you are *inside* it, not choosing it. Then
upcoming / past / idea as peer cards. Then the findings only a ledger can
produce:

- your food estimates miss by 34% and 61% while transport and attractions land
  within 6%
- shopping has never once appeared in a plan
- two thirds of a trip is spent **before it starts**, which is why August looked
  expensive and September will not

Those three need R13's `trip_items` to be real. In R12 the page ships with the
first one only, computed from category variance, and the section grows.

### `trip.html` — the burn-down

The module's core screen:

- **Burn-down**, not a budget bar. `vector-effect: non-scaling-stroke` so a
  stretched `preserveAspectRatio="none"` chart keeps honest 1.75px strokes.
- Estimate/actual reconciliation for today.
- Four figures that **separate the overrun into its causes**: over on the
  finished days, how much of that was one afternoon, how much was the exchange
  rate (R14), and what is needed to finish the plan.
- A **countdown**, because the trip ends.

### The thread

`.tchip` rendered on any Wallet, Tasks or Day row carrying a `trip_id`. Click it
and you are in the trip. This is the entire visible surface Trips adds to the
other three modules — keep it that way.

**Ship the deletion spec in this release**: deleting a trip nulls `trip_id` and
destroys nothing. It is the module's central promise.

---

## R13 · `v3.7.0` — the plan

### `trip-itinerary.html` — the differentiator

The page that makes the module worth building.

- **Hollow = an estimate, solid = a settled amount** — Day's v14 grammar
  extended from time to money. Each row carries both figures and the delta.
- Settled days show deltas; the current day straddles the `now` rule; future days
  are all estimates; distant days collapse.
- Two callouts do the real work:
  - *two entries had no estimate at all and are 64% of Tuesday* — which is why
    `estimate` must be nullable and distinguishable from zero
  - *RM122.28 of Thursday is one dinner; ¥9,000 instead of ¥18,000 closes 15% of
    the gap* — a specific, actionable lever

### `trip-prep.html`

**Readiness as one figure made of four lists, one of which is not due yet.** The
meter is **phase-aware**: before departure it is prep, mid-trip it is what today
needs, on the last day it becomes going home.

The rail states the ownership rule out loud — 48 tasks, 42 transactions, 9
bookings — and lands the consequence in plain words. Use that copy; it is the
best explanation of the module's architecture anyone will read.

### Bookings, wishlist, packing

- **Bookings** — flights, stays, tickets; held / confirmed / cancelled; linked to
  the transaction that paid for them.
- **Wishlist** — the holding area between an idea and a plan, and one of the two
  things that justify a fourth module at all. Promoting a wishlist item creates
  a trip.
- **Packing** — a Tasks subtree seeded from `task_templates`, not a new table.

---

## R14 · `v3.8.0` — trip mode and multi-currency

**Blocked on D-5.** Split this release further before starting; it is the only
one in the plan that is not cleanly reversible.

### Trip mode (`day-trip.html`)

When today falls inside an active trip, the app **changes state rather than
asking you to navigate**:

- A `.tripband` under the page title.
- The composer pre-scoped with a **removable** `.scope-pill`.
- Amounts defaulting to the local currency.
- A **Turn off** button, always.

This is what "worry-free vacation" actually means: on holiday you should not
have to tag anything. The rules that keep it safe: the band is **visible and
reversible, never silent**, and trip mode **changes what you add, not what you
can see** — the home task still appears on the timeline, without a chip, because
it is still yours.

Ships the rail card **Home, while you're away**: rent leaves on the 25th and is
funded, someone has the plants, nothing is overdue.

### Multi-currency

Per [01-data-model.md](01-data-model.md) §R14. The rules again, because each one
is a place this can go quietly wrong:

- every trip amount is a pair; **local leads in Trips, home leads in Wallet**
- never two currencies in one column
- the rate is captured per transaction and **shown, never back-filled**
- the rate card separates **the overrun the rate caused from the overrun you
  chose**
- one segment in the page head flips which line leads, everywhere at once

Audit every existing money surface before merging: `formatMYR` call sites,
`countableAmount`, the dashboard's pure module, CSV export, settlements. A
settlement between two people in two currencies is out of scope for v2 — say so
in the UI rather than computing something plausible.

---

## Still open in the design

Named by `REVIEW.md` v15 as undrawn; decide whether they are in scope when the
release starts:

- **The recap.** A finished trip needs its own page — Close-the-day at a trip's
  scale, answering *what would you budget differently next time* with numbers.
  `trips.html` currently promises one that does not exist.
- **The planning state.** Every Trips mockup is mid-trip. The 86-days-out state
  is a different page: no actuals, no burn-down, readiness dominating.
- **The map.** Deliberately deferred — it needs geocoding and tiles Daybook does
  not have, and it is the one competitor feature that is not a differentiator.
- **Trip templates.** "Same again, new dates" is obvious and unbuilt.
