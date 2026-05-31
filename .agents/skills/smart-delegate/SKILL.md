---
name: smart-delegate
description: >
  Model routing decision guide — pick the right model + effort for every action.
  Haiku for tests, git, lookups, and final verification. Sonnet (scaled effort)
  for planning and development. Cuts token cost 40-70% on typical dev sessions.
  Always active: the routing table below governs every Agent spawn and every
  inline action. Trigger: "smart-delegate", "model routing", "use haiku for tests",
  or auto-active on any session start in this project.
---

# Smart Delegate — Model Routing Rules

This is an **always-active** routing guide. Every time you decide between doing
work inline vs spawning an Agent, and every time you pick which model to use,
consult this table first.

---

## Routing table

| Work type | Where | Model | Effort |
|-----------|-------|-------|--------|
| Run tests, get failures, parse output | Agent | **haiku** | — |
| TypeScript typecheck / build | Agent | **haiku** | — |
| Git: status, diff, log, add, commit, push | Agent | **haiku** | — |
| Read one known file / grep a symbol | Inline Bash/Read | — | — |
| Explore unknown codebase region | Agent (Explore) | **haiku** | — |
| Verify a specific assertion ("does X show?") | Agent | **haiku** | — |
| Single-file bug fix, cause already known | Inline Edit | — | low |
| Update e2e test for already-built feature | Agent | **haiku** | — |
| Small multi-file change (≤2 files, clear scope) | Agent | **haiku** | — |
| New feature, 3–6 files | Inline (main thread) | sonnet | medium |
| Complex debugging, cause unclear | Inline (main thread) | sonnet | medium |
| Cross-cutting refactor, 6+ files | Agent | **sonnet** | medium |
| Architecture / planning pass | Inline (main thread) | sonnet | high |
| Security review / adversarial audit | Agent | **sonnet** | high |
| Final verification after delivery | Agent | **haiku** | — |

---

## The three-phase workflow

Every feature or fix follows this structure:

```
Phase 1 — PLAN  (sonnet, main thread, high effort)
  Understand the task. Read relevant files. Design the solution.
  Output: precise implementation plan with file paths + line numbers.

Phase 2 — BUILD  (sonnet, main thread, medium effort)
  Execute the plan. Write the code. One concern per step.
  Spawn haiku agents for any sub-task that is purely mechanical
  (running existing code, reading known paths, git ops).

Phase 3 — VERIFY  (haiku agent)
  Spawn a haiku Agent to:
    1. Run typecheck: `npx tsc --noEmit`
    2. Run e2e tests for affected spec files
    3. Report: pass count, fail count, any new failures vs baseline
  If haiku reports new failures → re-enter Phase 2 (sonnet) to fix.
```

---

## Agent spawn templates

### Haiku — run tests
```
Agent({
  description: "Run tests and report failures",
  model: "haiku",
  prompt: "Run: npx playwright test e2e/NN-spec.spec.ts --reporter=line
  Report: total passed, total failed, each failure as 'test name — error message (file:line)'.
  If all pass, say 'All N passed.'",
})
```

### Haiku — git commit
```
Agent({
  description: "Commit staged changes",
  model: "haiku",
  prompt: "Run git status and git diff --staged.
  Write a conventional-commit message (≤50 chars subject, body only if 'why' non-obvious).
  Stage: [list files]. Commit with Co-Authored-By line.",
})
```

### Haiku — verify build
```
Agent({
  description: "Typecheck and build check",
  model: "haiku",
  prompt: "Run npx tsc --noEmit. Report: 'Clean' or list each error as 'file:line — message'.
  Then run npm run build 2>&1 | tail -5. Report exit code.",
})
```

### Haiku — exploration
```
Agent({
  description: "Locate X in codebase",
  subagent_type: "Explore",
  model: "haiku",
  prompt: "Find where [X] is defined and which files use it. Return file:line list only.",
})
```

### Sonnet — feature build
```
Agent({
  description: "Implement [feature]",
  model: "sonnet",
  prompt: "[full self-contained brief with file paths, what to change, why, constraints]",
})
```

---

## Cost intuition

| Action | Inline Sonnet | Haiku Agent |
|--------|--------------|-------------|
| Run test suite + parse output | ~2k tokens | ~300 tokens |
| Git status + commit | ~800 tokens | ~150 tokens |
| Final verification (build + tests) | ~3k tokens | ~500 tokens |
| **Typical session savings** | baseline | **~40-70% fewer tokens** |

Haiku result is injected back into main context. Keep haiku prompts specific so
the returned text is short — a long haiku response still costs main-context budget.

---

## Rules

1. **Never run tests in the main thread** — always spawn haiku.
2. **Never do git in the main thread** — always spawn haiku (unless there's a merge conflict that needs reasoning).
3. **Always end a feature session with a haiku verification agent** before reporting done.
4. **Sonnet for anything that requires judgment** — ambiguous bugs, architecture choices, code that interacts across many files.
5. **Prompt haiku agents tightly** — give exact commands, exact file paths. Haiku doesn't explore well on open-ended prompts.
6. **Parallel haiku** — independent verifications (typecheck + tests) can be spawned in the same message.
