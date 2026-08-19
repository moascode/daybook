# Artifact Schemas

These schemas are the contract that makes context hygiene work. Each phase emits a small, predictable artifact; the next phase consumes only that. Keep to the fields and size caps below — an artifact that balloons defeats the purpose.

## flow-context-map.md (Explore output)

Purpose: tell the planner where things are without making it read files.

```markdown
# Context Map: <task short name>

## Relevant files
- `path/to/file.ts` — one-line purpose. Symbols: fnA, ClassB
- `path/to/other.py` — one-line purpose. Symbols: handler_c

## Entry points / call sites
- `path` → what triggers the relevant code path

## Bug reproduction (bugs only)
- Failing test: `path/to/test` (confirmed failing: yes/no)
- Root-cause hypothesis: one or two lines

## Open questions for planner
- Anything the explorer couldn't resolve (drives the Clarify step)
```

**Caps:** ≤ ~25 file lines. No pasted file bodies. One line per file. If an explorer wants to paste code, it's doing the planner's job — stop it.

## flow-plan.md (Plan output)

```markdown
# Plan: <task short name>

## Acceptance criteria
1. Objective, checkable statement
2. ...

## Locked file list
- `path/a`, `path/b`, `path/c`   ← scope guard reads this

## Steps
1. [sequential] Do X in `path/a` — expected result
2. [parallel]   Do Y in `path/b` — expected result
3. [parallel]   Do Z in `path/c` — expected result
4. [sequential] Wire together in `path/a`

## Checks to run
- lint / typecheck / test command(s)
```

**Rules:** every step tagged `parallel` or `sequential`. Same-file steps must be `sequential`. The locked file list is authoritative for the scope guard.

## diff summary (Implement output)

Produced by `scripts/diff-summary.sh`. Not a full diff — a condensed handoff:

```
Files changed: N
- path/a (+12 -3): short description of change
- path/b (+40 -0): short description of change
Checks: PASS | FAIL (summary line)
```

**Caps:** one line per file plus a checks line. The reviewer reads this, then opens only the files it needs.

## flow-review.md (Review output)

Issue list only — no restated diff, no praise.

```markdown
# Review: <task short name>

## Issues
- [blocker] `path:line` — what's wrong, tied to which acceptance criterion
- [nit]     `path:line` — optional improvement

## Verdict
PASS | NEEDS-FIX (loop N of 2)
```

If verdict is NEEDS-FIX and loop < 2, the issue list goes back to Sonnet 5. At loop 2, force a gate.
