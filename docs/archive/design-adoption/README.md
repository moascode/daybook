> **Status:** Archived · **Last verified:** 2026-09-16

# Design adoption — archive

The redesign programme that ran as releases R1–R18 between 2026-08 and 2026-09.
**Everything here describes work that shipped, or tracking that the backlog has
replaced.** Read it for reasoning, never as instructions.

The design docs for work that is *still unbuilt* are not here — they moved into
the epic that owns them, under [`../../backlog/`](../../backlog/README.md).

## What shipped, and what documents it

| Doc | Release | Now described by |
|---|---|---|
| [01-design-tokens.md](01-design-tokens.md), [02-component-layer.md](02-component-layer.md) | R1 | `scripts/gen-theme-tokens.mjs`, the AA gate in CI |
| [03-app-shell.md](03-app-shell.md) | R2 | `src/components/layout/`, spec 65 |
| [04-e2e-and-migration.md](04-e2e-and-migration.md) | R1 | the suite itself |
| [wallet-design-adoption.md](wallet-design-adoption.md) | R3 | specs 66, 67 and the Wallet pages |
| [tasks-data-model.md](tasks-data-model.md), [tasks-design-adoption.md](tasks-design-adoption.md) | R4, R5 | specs 68–72 |
| [trips-design-adoption.md](trips-design-adoption.md), [day-design-adoption.md](day-design-adoption.md) | R6 | specs 73, 74 |
| [feature-capture-inbox.md](feature-capture-inbox.md) | R18 | specs 77–80 |
| [feature-photo-import.md](feature-photo-import.md) | R7 | spec 76 |
| [duplicate-detection.md](duplicate-detection.md) | — | specs 49–51 |

> **Once something ships, its e2e spec is its specification.** It is executable,
> CI enforces it, and it cannot quietly disagree with the code. A design document
> can — and in this repo repeatedly did.

## Tracking, superseded

| Doc | Replaced by |
|---|---|
| [status-board.md](status-board.md), [release-plan.md](release-plan.md) | [`docs/backlog/`](../../backlog/README.md) — epics EP-06 to EP-10 |
| [execution-playbook.md](execution-playbook.md) | the [`daybook-flow`](../../../.agents/skills/daybook-flow/SKILL.md) skill |
| [gap-analysis.md](gap-analysis.md) | verified 2026-09-16; its conclusions are in the epics |

Still live, because they are *why* rather than *what*:
[`docs/reference/open-decisions.md`](../../reference/open-decisions.md) (D-5, D-6
and D-9 remain open) and [`docs/reference/ai-usage.md`](../../reference/ai-usage.md).
