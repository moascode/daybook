> **Status:** Needs decision · **Filed:** 2026-09-16 · **Roadmap:** R12–R14

# EP-08 — Trips module

**What.** A whole module. Trips currently exists as a designed first-run state
(R6) with no data model behind it: schema, `trip_id` threading, the trip page
and burn-down, itinerary, prep, bookings, packing, trip mode, and multi-currency.

**Spec:** [trips/03-feature-waves.md](../../roadmap/design-adoption/trips/03-feature-waves.md).

---

## The decision this epic is waiting on

This is the largest unbuilt body of work in the project — the release plan sizes
R12–R14 as **XL combined** — and unlike EP-06 and EP-07 it is not finishing
something already started. Two questions the owner should answer before it is
scheduled:

1. **How often do you actually travel?** A module that earns its keep twice a
   year is a different proposition from Wallet.
2. **Does [FEAT-040](../items/FEAT-040-trips-multi-currency.md) have to be in
   scope?** Multi-currency is approved (D-5) but is **a one-way door** that
   touches every money surface in the app. Trips without it is most of the
   value at a fraction of the risk.

**A cheaper alternative exists and should be considered first:** trips as a tag
plus a saved filter over Wallet and Tasks. That gets the burn-down and the trip
thread without a module, a schema or a currency decision. If that turns out to
be enough, most of this epic can be dropped.

**Recommendation.** Build [FEAT-033](../items/FEAT-033-trips-schema.md),
[FEAT-034](../items/FEAT-034-trip-chips.md) and
[FEAT-035](../items/FEAT-035-trips-burndown.md) — the thread and the burn-down —
then stop and use it on one real trip before committing to the rest.

## Items

| ID | Title | Still needed? |
|---|---|---|
| [FEAT-033](../items/FEAT-033-trips-schema.md) | Schema and `trip_id` threading | Yes — the foundation |
| [FEAT-034](../items/FEAT-034-trip-chips.md) | Trip chips in Wallet, Tasks, Day | Yes |
| [FEAT-035](../items/FEAT-035-trips-burndown.md) | Trips list, trip page, burn-down | Yes |
| [FEAT-036](../items/FEAT-036-trips-itinerary.md) | Itinerary | Decide after one real trip |
| [FEAT-037](../items/FEAT-037-trips-prep.md) | Phase-aware prep readiness | Decide after one real trip |
| [FEAT-038](../items/FEAT-038-trips-bookings-packing.md) | Bookings, wishlist, packing | Decide after one real trip |
| [FEAT-039](../items/FEAT-039-trips-trip-mode.md) | Trip mode | Decide after one real trip |
| [FEAT-040](../items/FEAT-040-trips-multi-currency.md) | Multi-currency | ⚠️ **One-way door** — split before starting |
