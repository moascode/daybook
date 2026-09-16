> **Status:** Open · **Filed:** 2026-09-16 · **Roadmap:** R17 (remainder)

# EP-10 — Cross-cutting

**What.** What is left of R17 after the parts that shipped early. Global search,
quick add and the notifications panel went out in `v3.12.0` outside the playbook
at the owner's direct request; these four did not.

**Spec:** [cross-cutting/README.md](../../roadmap/design-adoption/cross-cutting/README.md).

**Is this epic still worth doing?** Partly, and the items differ a lot:

- [FEAT-047](../items/FEAT-047-command-palette.md) **is the most visible
  unfinished thing in the app.** ⌘K has been drawn in the app bar since v2 and
  does nothing when pressed. A control that is visible and inert is worse than
  one that is absent.
- [FEAT-048](../items/FEAT-048-page-states.md) is rule 10 made concrete, which
  makes it non-optional rather than a nice-to-have.
- [FEAT-049](../items/FEAT-049-density-toggle.md) is the weakest item in the
  whole backlog — designed, never requested.
- [FEAT-050](../items/FEAT-050-number-formatting-rules.md) is blocked on D-9.

> **R17 also gated `v4.0.0` on rate limiting and the calendar-date bug.** Those
> are [BUG-001](../items/BUG-001-no-rate-limiting.md) and
> [BUG-002](../items/BUG-002-impossible-calendar-dates.md), tracked under
> [EP-05](EP-05-production-hardening.md) and [EP-04](EP-04-money-figure-correctness.md).
> Not duplicated here — but a `v4.0.0` that ships without them contradicts its
> own plan.

## Items

| ID | Title | Still needed? |
|---|---|---|
| [FEAT-047](../items/FEAT-047-command-palette.md) | Command palette (⌘K) | **Yes — highest visibility** |
| [FEAT-048](../items/FEAT-048-page-states.md) | Empty, loading and error states | **Yes — rule 10** |
| [FEAT-049](../items/FEAT-049-density-toggle.md) | Density toggle | Question it — consider `Dropped` |
| [FEAT-050](../items/FEAT-050-number-formatting-rules.md) | Number-formatting rules | Yes — resolve D-9 first |
