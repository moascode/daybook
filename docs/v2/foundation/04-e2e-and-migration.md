# e2e and migration strategy

The redesign's largest execution risk is not the CSS. It is that **63 spec files
make 1,423 assertions against markup and copy that are about to change**, and
only 507 assertions are anchored to something stable.

```
getByRole    909      structure- and accessible-name-coupled
getByText    318      copy-coupled
getByLabel   196      copy-coupled, and matches substrings
getByTestId  507      stable
```

CLAUDE.md rule 11 forbids skipping a failing spec to go green. So either the
selectors are paid down before the reskin, or every reskin PR carries a pile of
unrelated spec edits — and a genuinely broken page hides inside them.

---

## 1. Pay it down in R1, before anything looks different

**R1 changes colours, not structure.** That is the one window where a selector
can be re-anchored and the change proven correct by the suite passing *both
before and after* the edit. Once R3 starts moving DOM, that proof is gone.

Work:

1. For every spec that touches a page scheduled for reskin (Wallet ×25, Tasks ×8,
   shell/nav ×6, ≈400 assertions), add a `data-testid` to the target element and
   convert the assertion.
2. Leave `getByRole` where the role *is* the contract — a button being a button,
   a heading being a heading. Those should survive a reskin, and if they do not,
   the reskin broke accessibility and the spec is right to fail.
3. Leave `getByText` where the text *is* the assertion (a computed total, an
   error message). Those are testing behaviour, not markup.

The rule: **anchor to identity, assert on behaviour.** `getByTestId('txn-row')`
then `toHaveText('−RM84.20')` survives any reskin; `getByRole('row', {name: /Whole Foods.*84/})`
does not.

## 2. Naming convention for new testids

```
<module>-<surface>-<element>[-<qualifier>]

wallet-txn-row            wallet-txn-row-amount
wallet-day-header         wallet-day-header-net
tasks-task-row            tasks-task-row-check
shell-modtab-wallet       shell-search
day-timeline-entry        trips-burn-chart
```

Lower-kebab, module-prefixed, no indices in the name (use `.nth()`).

## 3. Per-release testing obligations

| Release | New specs | Rewritten |
|---|---|---|
| R1 | `64-design-tokens.spec.ts` — both themes apply, tabular nums present, no `dark:` leakage; extend spec 58 (pre-paint) for the `data-theme` attribute | ~400 assertions re-anchored |
| R2 | `65-app-shell.spec.ts` — module tabs, badges, account menu two panes, mobile bottom tabs, search focus growth | sidebar/nav specs |
| R3 | per-page visual-structure specs (grid present, cards present) | all Wallet specs re-verified |
| R4 | task API contract specs | `01-tasks.spec.ts` must pass **unchanged** — that is the proof the schema bump broke nothing |
| R5–R17 | one spec file per new page, per CLAUDE.md §16 naming | — |

## 4. Traps this suite already knows about

All from CLAUDE.md §16; every one of them is live for this work.

1. **One clock.** Use `businessToday()` / `businessDatePlus()` from
   `e2e/helpers.ts`. Never `toISOString()`. Day and Trips are date-addressed
   pages, so this trap is about to get much easier to hit.
2. **Never hardcode a future date.** Trips mockups are set on 17 September 2026;
   do not port that date into a fixture.
3. **`getByLabel()` matches substrings.** Fix collisions in the app, not the spec.
4. **Both mobile and desktop chrome render.** Match `visible=true`.
5. **The harness runs a production build** — test hooks need `TEST_HOOKS_ENABLED`.
6. **Playwright cannot intercept a Worker→third-party fetch.** Relevant if the
   composer uses Claude (D-11): reuse the `DAYBOOK_TEST` + settings-row pattern
   from `worker/lib/anthropic.ts`.
7. **Do not hand-start a dev server on 5173.** `npm run dev:worker` is :8788.

## 5. Schema migration rules

Unchanged from CLAUDE.md, restated because R4, R12, R15 all add tables:

- Additive only. New numbered file in **both** `server/migrations/` and
  `worker/migrations/` — `scripts/schema-diff.mjs` gates CI on them matching,
  and `server/` is still the schema reference even though it gets no features.
- Never edit a shipped migration. Never drop a table or column.
- Renames via `ALTER TABLE … RENAME TO` are lossless and allowed **with owner
  sign-off**.
- D1 gotchas that will bite the new routes: **no named parameters** (positional
  `.bind()` only), **D1 strips SQL comments** from `sqlite_master`, and
  **`SQLITE_MAX_COMPOUND_SELECT` is low** — an 18-term `UNION ALL` is rejected,
  so project many aggregates with scalar subqueries. The Day timeline and the
  Trips burn-down are both many-aggregate queries; expect to hit the third one.

## 6. Rollback

Each release is a tag, and the tag is the deploy. Rollback is re-deploying the
previous tag — except where a migration ran, which is every additive one and
therefore harmless: the old code ignores the new columns.

The one release that is **not** cleanly reversible is **R14 (multi-currency)**,
because it changes what stored amounts mean. Treat it as a one-way door and
split it further before starting.

## 7. Definition of done, every release

1. `tsc` clean (`typecheck`, `typecheck:server`, `typecheck:worker`)
2. `npm run check:contrast` green (from R1)
3. `npx playwright test` — full suite, no skips
4. Rendered in the Browser pane, **both themes**, at 1440 / 768 / 390
5. PR per CLAUDE.md §11, and the status board in `docs/v2/README.md` updated
