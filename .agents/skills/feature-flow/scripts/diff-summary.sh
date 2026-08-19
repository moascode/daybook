#!/usr/bin/env bash
# diff-summary.sh — condensed diff for the review handoff.
# Emits one line per changed file (path + insertions/deletions), NOT the full diff.
# Keeps the reviewer's context small; it opens only the files it needs.
#
# Usage:
#   diff-summary.sh                 # summary of uncommitted changes vs HEAD
#   diff-summary.sh <base>          # summary vs a base ref (e.g. main)
set -euo pipefail

BASE="${1:-HEAD}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "not a git repo" >&2; exit 1
fi

echo "Files changed vs ${BASE}:"
# --numstat gives: insertions  deletions  path
git diff --numstat "$BASE" | while read -r add del file; do
  printf -- "- %s (+%s -%s)\n" "$file" "$add" "$del"
done

# Untracked files (new files not yet staged) — count each as all-new lines.
git ls-files --others --exclude-standard | while read -r file; do
  lines=$(wc -l < "$file" 2>/dev/null | tr -d ' ')
  printf -- "- %s (new, ~%s lines)\n" "$file" "${lines:-0}"
done

TRACKED=$(git diff --numstat "$BASE" | wc -l | tr -d ' ')
UNTRACKED=$(git ls-files --others --exclude-standard | wc -l | tr -d ' ')
echo "Total: $((TRACKED + UNTRACKED)) file(s)"
