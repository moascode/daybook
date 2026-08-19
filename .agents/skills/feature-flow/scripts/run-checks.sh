#!/usr/bin/env bash
# run-checks.sh — run lint + typecheck + tests, return a PASS/FAIL summary only.
# Auto-detects the toolchain. Prints a compact result the orchestrator can act on.
# Exit code: 0 if all detected checks pass, 1 otherwise.
#
# On failure the flow ALWAYS gates (both modes) — this script never decides to retry.
#
# Usage: run-checks.sh [project_dir]
set -uo pipefail

DIR="${1:-.}"
cd "$DIR"
FAILED=0
run() {  # run <label> <cmd...>
  local label="$1"; shift
  if "$@" >/tmp/flow_check.log 2>&1; then
    echo "PASS  $label"
  else
    echo "FAIL  $label — $(tail -n 1 /tmp/flow_check.log)"
    FAILED=1
  fi
}

if [[ -f package.json ]]; then
  command -v npm >/dev/null && grep -q '"lint"'       package.json && run "lint"      npm run -s lint
  command -v npm >/dev/null && grep -q '"typecheck"'  package.json && run "typecheck" npm run -s typecheck
  command -v npm >/dev/null && grep -q '"test"'       package.json && run "test"      npm test --silent
elif [[ -f pyproject.toml || -f setup.py || -f requirements.txt ]]; then
  command -v ruff  >/dev/null && run "lint"      ruff check .
  command -v mypy  >/dev/null && run "typecheck" mypy .
  command -v pytest>/dev/null && run "test"      pytest -q
elif [[ -f Cargo.toml ]]; then
  run "lint"      cargo clippy -q
  run "test"      cargo test  -q
elif [[ -f go.mod ]]; then
  run "lint"      go vet ./...
  run "test"      go test ./...
else
  echo "SKIP  no recognized toolchain in $DIR"
fi

if [[ "$FAILED" -eq 0 ]]; then echo "RESULT PASS"; exit 0; else echo "RESULT FAIL"; exit 1; fi
