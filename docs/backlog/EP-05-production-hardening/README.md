> **Status:** Open · **Filed:** 2026-09-16

# EP-05 — Production hardening

**What.** Operational risk on a live, publicly reachable deployment, and the
cleanup left behind by the migration to it.

**Is this epic still worth doing?** The two items differ sharply and should be
judged separately — which is the point of splitting them out rather than leaving
them in a status-section list.

- **BUG-001 is the oldest open risk on the project** and the only one that
  concerns an attacker rather than a mistake. Mitigated in part by signup being
  disabled and `requireAuth` guarding the whole `/api` surface, so what remains
  exposed is mainly login itself.
- **BUG-004 is cleanup on a retired machine.** It is a reasonable candidate for
  `Dropped`.

## Items

| ID | Title | Still needed? |
|---|---|---|
| [BUG-001](BUG-001-no-rate-limiting.md) | No rate limiting on the public URL | **Yes** — highest-severity item in the backlog |
| [BUG-004](BUG-004-e2e-account-residue.md) | `e2e_*` account residue on the retired Mac | Consider dropping — the live D1 database is clean |
