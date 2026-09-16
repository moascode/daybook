---
name: daybook-flow
description: Take a Daybook change end-to-end — branch, plan, implement, verify, review, PR — with model-tiered subagents and this project's real gate set. Use when the user wants a feature built, a bug fixed, or a change shipped "end to end", "all the way", "properly", or asks to start a numbered roadmap release (R8, R12, …). Covers which model runs which phase, the gates that must pass, and the two approval points.
---

# Daybook flow

End-to-end orchestration for a Daybook change. **The unit of work is a PR**, not
a release: a release decomposes into several PR-sized flows, each of which is one
run of this pipeline.

```
BRANCH → EXPLORE → PLAN ▸gate 1◂ → IMPLEMENT → VERIFY → REVIEW ▸gate 2◂ → PR
```

> **Roadmap releases have their own playbook.** If the task is a numbered
> release in `docs/roadmap/design-adoption/release-plan.md` — including one named
> only by number ("start R8") — read
> [`execution-playbook.md`](../../../docs/roadmap/design-adoption/execution-playbook.md)
> **first, every time**, even if it was used earlier in the same session. It adds
> release-specific gates and a design-review pass this skill does not.

---

## Phases and models

| Phase | Model | Runs as | Job |
|---|---|---|---|
| **Branch** | haiku | subagent | `git checkout -b <type>/<desc>`. Git is always Haiku, always a subagent |
| **Explore** | haiku | up to 4 parallel subagents | Map the files and symbols the change touches; name the e2e specs that will break. **Never paste file bodies** |
| **Plan** | — | **main thread** | Design it, write acceptance criteria, lock the file list. Clarify in chat rather than assuming |
| **Implement** | sonnet | 1–4 subagents | Write the code, the CSS and the tests. Parallel **only across independent files** |
| **Verify** | haiku | parallel subagents | Run the gate set. Report pass/fail. Never "fix" anything |
| **Review** | opus | subagent(s), by concern | Audit the diff against the acceptance criteria |
| **PR** | haiku | subagent | `gh pr create`, return the URL |

**Never generate code with Haiku** — escalate to Sonnet. **Never read files with
Opus when Haiku can map them first.**

---

## The gate set

```bash
bash scripts/flow-checks.sh                      # everything except e2e
bash scripts/flow-checks.sh e2e/03-wallet-*.ts   # plus the specs you changed
```

That runs three typechecks, lint, doc links, backlog consistency, the WCAG-AA
contrast gate, the generated-tokens check, and D1 schema parity.

**Never run the full Playwright suite locally.** Not `test:e2e:parallel`, not a
bare `npx playwright test`, and not from inside a verification subagent. CI
shards it 8×; reproducing it in this sandbox has returned inflated, garbled
numbers and burned real time without adding signal. After pushing, read the PR's
check runs for the authoritative result.

**A Playwright failure is not automatically a real break.** Check it against the
known `wrangler dev` broken-pipe flake (`playwright.config.ts`) first — the
symptom is a shard whose *server* died, after which every retry in that shard
fails on `ECONNREFUSED ::1:5173`.

---

## Where the user is in the loop

Two routine approvals, and four stops that fire regardless of mode:

| | When | What happens |
|---|---|---|
| **Gate 1** | after Plan | Show acceptance criteria + the locked file list. Nothing is written until approved |
| **Gate 2** | after Review | Show the verdict. `merge` means *ready for the owner to merge* — **I don't merge to `main`** |
| **Hard stop** | any Anthropic API call | Always. No AI gets wired without an explicit yes |
| **Hard stop** | an unsettled design decision | Surface options; don't invent behaviour |
| **Hard stop** | a file outside the locked list | The scope guard |
| **Hard stop** | a failed gate | No auto-retry |

Controls the user can type: `approved` / `go`, `change: <what>`, `hold`,
`fix: <what>` (cap 2 cycles), `status`, `stop`.

---

## Rules this flow inherits

- **Never work on `main`.** Branch first, every time, including for a typo.
- **Work is not done until the PR URL exists.**
- **Every behaviour change ships an e2e spec** (`NN-description.spec.ts`).
- **Never fail silently** — a handler that changes nothing and explains nothing
  is the worst outcome available (CLAUDE.md §2 rule 10).
- **Look at the rendered page** for anything visual. Eight double-inverted
  colours once shipped into review; neither `tsc` nor a diff reviewer saw them.

## Context hygiene

Each phase hands the next a small artifact, never the transcript. Explore emits
a file map of at most ~25 lines with no file bodies; Plan emits criteria plus the
locked file list; Review emits an issue list. Drop a phase's chatter the moment
its artifact is written — that is what keeps a long session viable.
