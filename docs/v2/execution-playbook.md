# v2 execution playbook — orchestrating the build with a team of agents

How the 17-release plan gets built: the `feature-flow` skill's phased,
model-tiered pipeline, adapted to this project's git rules, gates and
verification. This is the *how*; [release-plan.md](release-plan.md) is the *what*.

---

## 1. The unit of work is a PR, not a release

`feature-flow` runs one task end-to-end. A whole release is too big for one flow
(R3 alone is eight pages). So the mapping is:

```
release  →  one or more PR-sized flows  →  a tag
```

The release plan already decomposes this way — R3 is four PRs, R9 is four page
upgrades. **Each PR is one feature-flow run**: Triage → Explore → Plan → Implement
→ Verify → Review → PR. Module by module, feature by feature, exactly as asked.

A release is "done" when its PRs are all merged and green on `main`; then the tag
is cut (the tag is the deploy — `release.yml` runs the full suite, D1 migrations,
Worker deploy, smoke test).

---

## 2. Who does what, and on which model

The Agent tool exposes `haiku`, `sonnet`, `opus` (`claude-opus-5`), `fable`. The
skill's Opus-4.8-vs-Opus-5 split isn't selectable here, so **both planning and
review run on Opus 5** — more capable, fine for both. This also matches
CLAUDE.md §17's routing.

| Phase | Model | Runs as | Job | Never does |
|---|---|---|---|---|
| **Triage** | `haiku` | subagent, 1 call | classify the PR trivial/standard, bug/feature | write code |
| **Branch** | `haiku` | subagent | `git checkout -b <type>/<desc>` (CLAUDE.md §17: git is always Haiku) | anything else |
| **Explore** | `haiku` → `sonnet` on low confidence | up to 4 parallel subagents | map files + symbols the PR touches, read the matching proposal mockup, note the e2e specs that will break | write code, paste file bodies |
| **Plan + Clarify + Criteria** | `opus` | **main thread (me)** | design against the module doc, write acceptance criteria, lock the file list, tag steps parallel/sequential | assume — clarify in chat first |
| **Implement** | `sonnet` | 1–4 subagents (parallel only on independent files) | write **all** code, CSS, tests | touch a file not in the locked list |
| **Verify** | `haiku` | parallel subagents | run the gate set (§4), report pass/fail only | write code, "fix" anything |
| **Design review** | `opus` | **main thread (me), Browser pane** | render both themes at 1440/768/390, check AA + no-`dark:` + `countableAmount` + layout | — |
| **Code review** | `opus` | subagent(s), by concern | audit the diff against the acceptance criteria | rubber-stamp |
| **PR** | `haiku` | subagent | `gh pr create` with the §11 template, return the URL | — |

**The one deviation from the skill worth stating loudly:** the skill's Review
phase is text-only subagents against a diff. This is a *visual* redesign, and the
class of bug that shipped last time (eight double-inverted colours) is invisible
to a diff and to `tsc`. So **design review is done by me on the main thread with
the Browser pane**, on both themes, every PR. A subagent cannot see the rendered
page; I can. Code review still fans out to Opus subagents by concern.

---

## 3. Orchestration shape — serialize releases, parallelize within

**Across releases: one in flight at a time.** This is a live money app on a
single `main`, a shared e2e suite, and serial D1 migrations. Two releases'
Implement phases running at once would collide on migrations and spec files. The
dependency chain (R1→R2→R3/R4…) is walked one release at a time.

**Within a release: fan out where the skill allows.**
- **Explore** always fans out (cap 4) — e.g. R3 PR-1 explores `WalletPage`,
  `TransactionList`, `AccountsPage`, `AccountCard` in parallel.
- **Implement** fans out only across **independent files**. Four Wallet pages
  that don't share a component can be four Sonnet subagents; two edits to
  `theme.css` cannot.
- **Verify** fans out — typecheck, contrast, and Playwright run as parallel
  Haiku agents (CLAUDE.md §17: "independent verifications run in parallel").

The single narrow exception to one-release-at-a-time: **R4 (Tasks schema) may run
in parallel with R3 (Wallet reskin)** — different files, different migrations,
no shared surface. I'd take it only if you want the speed; default is serial.

---

## 4. The gate set (this project's real checks)

The bundled `run-checks.sh` auto-detects `lint`/`typecheck`/`test`, but this repo
has none of those script names — its real gates are different. Verify runs, as
parallel Haiku agents:

```
eslint .                        # lint (38 known warnings baseline — no new ones)
tsc -b                          # base typecheck
npm run typecheck:server        # server tree
npm run typecheck:worker        # worker tree
npm run check:contrast          # NEW in R1 — AA gate, fails the build below 4.5:1
npm run test:e2e                # full Playwright suite, no skips (rule 11)
npm run d1:schema-diff          # only when a migration changed
npm run gen:tokens && git diff --exit-code src/index.css   # tokens changed ONLY via generator
```

**On any failure the flow gates — both modes, no auto-loop** (skill rule). I add
one project rule on top: a Playwright failure is checked against the known
`wrangler dev` broken-pipe flake (CLAUDE.md §13) before anything is called a
real break — reproduce the shard locally first.

I'll add a `scripts/flow-checks.sh` wrapping the above so Verify runs one command.

---

## 5. Where you are in the loop

`feature-flow` has two gates. On top of them, this project's standing rules add
three hard stops that fire **even in auto mode**:

| Trigger | Mode | What happens |
|---|---|---|
| **Gate 1** — after Plan | manual: pause | I show acceptance criteria + locked file list; you approve before any code is written |
| **Gate 2** — after Review | manual: pause | I show the review verdict + both-theme screenshots; you approve the merge |
| **Any Claude API call** | **always** | hard stop — your standing rule (ai-usage.md). No AI wired without your yes |
| **A design decision** the mockup doesn't settle | **always** | hard stop — I surface options, don't invent behaviour (CLAUDE.md rule 8) |
| **A file outside the locked list** | **always** | hard stop — the scope guard |
| **A failed gate check** | **always** | hard stop — no auto-retry |

### Recommended mode per release

- **Manual** for the first PR of every module — it establishes the pattern, and
  you see how the reskin lands before I repeat it.
- **Auto-eligible** for subsequent same-shape PRs in that module (e.g. R3 PR-4's
  four restyle-only pages once PR-1's pattern is approved), with the hard stops
  above always live.
- **Always manual** for anything touching money math, migrations, sharing, or
  the API.

Auto mode still logs every decision to the flow log and still stops on all five
hard triggers — it removes the two *routine* approvals, nothing else.

---

## 6. Context hygiene — namespaced so flows don't collide

The skill writes artifacts to `/docs`. This repo's `/docs` is real
documentation, and `docs/.flow-*` from a previous run is already there. v2 flows
write to a namespace:

```
docs/v2/.flow/<release>-<pr-slug>/
├── flow-context-map.md     Explore output (≤25 file lines, no bodies)
├── flow-plan.md            acceptance criteria + locked files + tagged steps
├── flow-review.md          issue list only
└── .flow-state.json        phase, locked_files, review_loop (cap 2)
```

Each phase consumes only the prior artifact, never the transcript — that is what
keeps the orchestrator's context lean across a 17-release program. The state file
makes `resume` work: if a session dies mid-R7, `resume` reads the last checkpoint
and continues from the next phase.

I will **not** let an explorer paste file bodies into the map, and I will drop
exploration chatter the moment the map is written. Same discipline every phase.

---

## 7. Reconciling with CLAUDE.md §17

The project already mandates BRANCH→PLAN→BUILD→VERIFY→PR with the same model
tiers. `feature-flow` is that workflow with two additions — a Triage classifier
and a context-map handoff — and the same routing. Where they'd differ, the
stricter rule wins:

- §17 "every session ends with a Haiku verification agent + PR" → the PR phase is
  mandatory, not optional. A flow isn't done until the PR URL exists.
- §11 branch-per-task, PR template, `Co-Authored-By: Claude Opus 5` → the Branch
  and PR phases use exactly these.
- Rule 11 e2e-per-feature → Verify's Playwright run is non-negotiable, and every
  new page ships its `NN-*.spec.ts`.

---

## 8. First move, when you say go

I'd start **R1 as two flows**, manual mode:

1. **`R1-tokens`** — rewrite `gen-theme-tokens.mjs` to the two-layer model, add
   the scales to `tailwind.config.js`, port the component CSS, add
   `check-contrast.mjs`. Explore(4 Haiku) → I plan → Implement(Sonnet) →
   Verify(Haiku ×5) → I review both themes → PR(Haiku).
2. **`R1-e2e-seams`** — add `data-testid` to reskin-target elements and convert
   the ~400 role/text/label assertions, proven by the suite passing before *and*
   after. Mostly mechanical → a candidate for auto mode once flow 1 sets the
   contrast/gen-tokens pattern.

Then R2 (shell), then R3 (Wallet), following the release plan's order.

**I won't spawn anything until you approve this playbook and say start.** When you
do, tell me the mode (manual / auto-eligible) and whether to allow the R3‖R4
parallel exception — everything else follows the tables above.
