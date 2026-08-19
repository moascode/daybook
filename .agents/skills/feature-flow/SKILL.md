---
name: feature-flow
description: Develop a feature or fix a bug end-to-end through a disciplined, phased pipeline with model-tiered subagents, auto/manual approval modes, and aggressive context hygiene. Use this skill whenever the user wants to implement a feature, fix a bug, or ship a code change from start to finish — especially when they mention "end-to-end", "auto mode", "manual mode", "plan then implement", "review my change", or want work delegated across subagents. Trigger even if the user just describes a coding task and asks you to "take it all the way" or "handle the whole thing."
---

# Feature Flow

End-to-end feature/bugfix orchestration. This skill makes Claude act as an **orchestrator** that routes work through phases, delegates each phase to the right model tier via subagents, parallelizes independent work, and keeps context lean by passing compact artifacts between phases instead of raw transcripts.

## Core principles

1. **Right model for the job.** Haiku explores and verifies (cheap, fast). Sonnet writes code (strong, cost-effective). Opus decides and reviews (most capable). Never use Haiku for code generation — escalate to Sonnet subagents. Never read files with Opus when Haiku can map them first.
2. **Context hygiene.** Each phase emits a small structured artifact to `/docs`. The next phase consumes *only that artifact*, never the prior transcript. Drop context that is no longer needed the moment a phase closes.
3. **Reuse over redo.** Before spawning any subagent, check `/docs/.flow-state.json` and existing artifacts. If the work is already done, reuse it. Never duplicate exploration or analysis.
4. **Parallelize the independent, serialize the dependent.** Exploration and independent-file implementation fan out. Planning, clarifying, gates, and same-file writes never parallelize.
5. **Scripts for repetition.** Deterministic, repetitive work (scanning, diff summaries, checks, state I/O) runs through the bundled scripts, not through model reasoning.

## Inputs

- **task** — the feature description or bug report.
- **mode** — `auto` or `manual`. Default `manual`. In `auto`, gates self-approve and every decision is logged to `/docs/.flow-log.md`. In `manual`, gates pause inline in chat and wait for a clear yes.

If `mode` is not given, ask once, then proceed.

## Artifacts & state

All flow artifacts live in the repo under `/docs`:

- `/docs/flow-context-map.md` — Explore output (file paths + one-line purpose + relevant symbols).
- `/docs/flow-plan.md` — Plan output (numbered steps, files touched, per-step parallel/sequential tag, acceptance criteria).
- `/docs/flow-review.md` — Review output (issue list only).
- `/docs/.flow-state.json` — current phase, completed artifacts, task type, mode, loop counters. Managed via `scripts/state.py`.
- `/docs/.flow-log.md` — decision log (auto mode especially).

Read `references/artifact-schemas.md` for the exact schema each artifact must emit. These schemas are what make context hygiene work — keep artifacts to the fields and size caps defined there.

## The pipeline

```
Triage (Haiku)
  ├─ trivial  → Implement (Sonnet 5) → run-checks → done
  └─ standard → Explore (Haiku, parallel)
                → Plan+Clarify+Criteria (Opus 4.8)
                → [GATE]
                → Implement (Sonnet 5, parallel where tagged)
                → Review (Opus 5, parallel by concern)
                → [GATE]
                → done
Checkpoint after every phase. `resume` reloads the last checkpoint.
```

### Phase 0 — Triage (Haiku, 1 call)

Classify the task as **trivial** or **standard**.
- **Trivial**: typo, one-liner, obvious localized fix with no design decision. → Skip to Implement, then run checks, then done. No plan, no review ceremony.
- **Standard**: anything with a design decision, multiple files, or unclear scope. → Full pipeline.

Also detect **bug vs feature** here and record it in state. A bug adds a reproduction step (see Explore).

Write triage result to state and checkpoint.

### Phase 1 — Explore (Haiku, parallelizable)

Map only what the task needs. Fan out across independent areas of the codebase, but cap concurrency at **4** subagents and cap each returned artifact per the schema (don't let an explorer dump whole files).

Use `scripts/scan.sh` for ripgrep-based file/symbol discovery before spawning explorers — it narrows the search cheaply so explorers read less.

If the task is a **bug**: one explorer's job is to **reproduce it and write a failing test**, confirming the test fails before planning. Record the repro path in the context map.

If any explorer returns low confidence ("couldn't locate X"), escalate that one slice to Sonnet 5 for a single retry rather than planning on bad context.

Emit `/docs/flow-context-map.md`. Checkpoint. Drop raw exploration chatter — keep only the map.

### Phase 2 — Plan + Clarify + Criteria (Opus 4.8)

Opus reads **only** the context map (not exploration transcripts) and:

1. **Clarifies first.** If anything is unclear, ask the user inline. **Never assume.** Do not proceed to planning until ambiguities are resolved.
2. **Writes acceptance criteria** and presents them to the user right after clarification. These become the objective bar Review checks against.
3. **Writes the plan**: numbered steps, the exact file list each step touches, and a `parallel`/`sequential` tag per step. Same-file writes must be `sequential`.

Emit `/docs/flow-plan.md`. Checkpoint.

### Gate 1 (after Plan)

- **manual**: present a one-line preview (N files, M steps, K parallel batches) inline and wait for approval.
- **auto**: log the plan summary to `/docs/.flow-log.md` and proceed.

### Phase 3 — Implement (Sonnet 5, parallel where tagged)

Execute the plan. Steps tagged `parallel` fan out (cap 4 concurrent); `sequential` steps run in order. Never run two subagents that write the same file.

**Scope guard:** the plan's file list is locked. If implementation needs to touch a file *not* in the plan, that is an automatic gate **even in auto mode** — stop and surface it. This is the main thing that keeps auto mode safe.

After implementation, run `scripts/run-checks.sh` (lint + typecheck + tests). It returns a pass/fail summary only.

**On failure: always gate**, in both modes. Never auto-loop on a failed check. Present the failure and wait for direction.

Emit a diff summary via `scripts/diff-summary.sh`. Checkpoint.

### Phase 4 — Review (Opus 5, parallel by concern)

Opus reviews the diff summary **against the acceptance criteria** from the plan — not against vibes. Fan out by concern where useful (correctness, security, tests), cap 4.

If Review finds issues → hand the issue list back to Sonnet 5 to fix → re-review. **Loop cap: 2.** After 2 fix cycles, force a gate regardless of mode.

Emit `/docs/flow-review.md` (issue list only). Checkpoint.

### Gate 2 (after Review)

- **manual**: present review summary inline, wait for approval to call it done.
- **auto**: log and mark done.

## Resume & scheduling

State is checkpointed to `/docs/.flow-state.json` after every phase. Two recovery paths:

- **`resume` command** — reload the last checkpoint and continue from the next phase. Covers ~95% of interruptions (crash, context limit, closed session). This is the primary mechanism; it must always work.
- **Time-based scheduler** — `scripts/scheduler.py` writes periodic checkpoints and a heartbeat so a long-running flow can be picked back up cleanly. This is a convenience layer on top of `resume`, not a replacement for it. If the scheduler is unavailable or misbehaves, fall back to plain `resume` — never block the flow on the scheduler.

See `references/state-and-resume.md` for the state schema, the resume procedure, and scheduler usage.

## Code writing rule (CRITICAL)

**Haiku never writes code.** All code generation — creating files, editing source, writing tests, fixing bugs — must be done by **Sonnet 5 subagents only**. This includes:
- All file writes (Edit, Write tools)
- All test creation
- All implementations of bug fixes or features
- Even small edits or one-liners

Haiku's role is limited to:
- Classification (Triage)
- Exploration (reading, mapping, understanding)
- Verification (running checks, tests, typecheck — reporting results only)

If a task requires code generation, spawn a Sonnet 5 subagent. No exceptions.

## What NOT to parallelize

- Planning, clarifying, and both gates — always sequential.
- Any two writes to the same file — sequential.
- Review-fix loop iterations — sequential (fix depends on prior review).

Exploration and independent-file implementation are the only things that fan out.

## Model routing quick reference

| Phase | Model | Role | What NOT to do |
|-------|-------|------|---|
| Triage | Haiku | Classify task type (bug/feature, trivial/standard) | Never write code |
| Explore | Haiku (→Sonnet 5 on low confidence) | Map files, symbols, read test patterns | Never write code; escalate low-confidence reads to Sonnet 5 |
| Plan + Clarify + Criteria | Opus 4.8 | Design, document, reason about tradeoffs | (N/A — pure reasoning) |
| Implement | **Sonnet 5 only** | Write all code; create/edit files | Haiku never writes code; always use Sonnet 5 subagents |
| Verify | **Haiku only** | Run checks, tests, typecheck, summaries | Never write code; report results only |
| Review | Opus 5 | Audit code against criteria; spot defects | (N/A — pure review) |

## Scripts

Run these instead of reasoning through repetitive work. See each script's `--help`.

- `scripts/scan.sh` — ripgrep file/symbol finder for cheap exploration narrowing.
- `scripts/diff-summary.sh` — condensed diff for review handoff (keeps tokens down).
- `scripts/run-checks.sh` — lint + typecheck + tests, returns pass/fail summary only.
- `scripts/state.py` — read/write `/docs/.flow-state.json` (get/set phase, counters, task type).
- `scripts/scheduler.py` — periodic checkpoint + heartbeat for long flows.

Always prefer enhancing these scripts over hand-doing a repetitive task a second time.
