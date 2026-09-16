#!/usr/bin/env bash
# The gate set for a Daybook change, in one command.
#
#   bash scripts/flow-checks.sh              # everything except e2e
#   bash scripts/flow-checks.sh e2e/03-*.ts  # plus the targeted specs you name
#
# Why this exists: docs/archive/design-adoption/execution-playbook.md §4 promised
# it and never delivered, so these gates were run from memory, inconsistently,
# and usually incompletely. Every check below is already an npm script — the
# only thing that was missing was running them as a set.
#
# NOT included, deliberately: the full Playwright suite. CI shards it 8×.
# Reproducing it locally has repeatedly returned inflated, garbled numbers in
# this sandbox and cost real time without adding signal CI doesn't already give.
set -uo pipefail

pass=0 fail=0
declare -a failed=()

run() {
  local label=$1; shift
  printf '── %s\n' "$label"
  if "$@" >/tmp/flow-check.$$ 2>&1; then
    printf '   ✓ %s\n' "$label"; pass=$((pass + 1))
  else
    printf '   ✗ %s\n' "$label"; fail=$((fail + 1)); failed+=("$label")
    sed 's/^/     /' /tmp/flow-check.$$ | tail -30
  fi
  rm -f /tmp/flow-check.$$
}

run "typecheck (client)"  npx tsc -b
run "typecheck (server)"  npm run typecheck:server
run "typecheck (worker)"  npm run typecheck:worker
run "lint"                npm run lint
run "doc links"           npm run check:doc-links
run "backlog index"       npm run check:backlog
run "contrast (WCAG AA)"  npm run check:contrast

# Tokens are generated. Regenerate and fail if the committed file differs —
# the only sanctioned writer is scripts/gen-theme-tokens.mjs (CLAUDE.md §3).
printf '── theme tokens are generated\n'
if npm run gen:tokens >/dev/null 2>&1 && git diff --exit-code --quiet src/index.css; then
  printf '   ✓ theme tokens are generated\n'; pass=$((pass + 1))
else
  printf '   ✗ theme tokens are generated — src/index.css does not match the generator\n'
  printf '     Run: npm run gen:tokens && git add src/index.css\n'
  printf '     (This compares the regenerated file against what is STAGED, which is\n'
  printf '      what CI sees. A path rewritten in the generator but not in its output\n'
  printf '      has now caused this twice.)\n'
  fail=$((fail + 1)); failed+=("theme tokens")
fi

# Only meaningful when a migration changed; cheap enough to always run.
run "D1 schema parity"    npm run d1:schema-diff

if [ "$#" -gt 0 ]; then
  printf '── targeted e2e: %s\n' "$*"
  if npx playwright test "$@"; then
    printf '   ✓ targeted e2e\n'; pass=$((pass + 1))
  else
    printf '   ✗ targeted e2e\n'; fail=$((fail + 1)); failed+=("targeted e2e")
  fi
else
  printf '── targeted e2e: skipped (pass spec paths to run them)\n'
fi

printf '\n%s\n' "────────────────────────────────"
printf '%d passed, %d failed\n' "$pass" "$fail"
if [ "$fail" -gt 0 ]; then
  printf 'failed: %s\n' "${failed[*]}"
  exit 1
fi
