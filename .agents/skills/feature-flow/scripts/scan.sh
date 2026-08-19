#!/usr/bin/env bash
# scan.sh — cheap file/symbol discovery to narrow exploration before spawning explorers.
# Uses ripgrep. Returns matching files + line-limited symbol context, nothing more.
#
# Usage:
#   scan.sh <pattern> [path]          # find files + matching lines for a term
#   scan.sh --files <pattern> [path]  # just the file list (for fan-out planning)
#   scan.sh --defs <symbol> [path]    # likely definitions of a symbol
set -euo pipefail

MODE="lines"
if [[ "${1:-}" == "--files" ]]; then MODE="files"; shift; fi
if [[ "${1:-}" == "--defs" ]]; then MODE="defs"; shift; fi

PATTERN="${1:?usage: scan.sh [--files|--defs] <pattern> [path]}"
ROOT="${2:-.}"

if ! command -v rg >/dev/null 2>&1; then
  echo "ripgrep (rg) not found; falling back to grep -r" >&2
  grep -rniI --exclude-dir={.git,node_modules,dist,build} "$PATTERN" "$ROOT" | head -n 50
  exit 0
fi

case "$MODE" in
  files)
    rg -l --hidden -g '!.git' -g '!node_modules' "$PATTERN" "$ROOT" | head -n 50 ;;
  defs)
    # heuristic: lines that look like a definition of the symbol
    rg -n --hidden -g '!.git' -g '!node_modules' \
      "(def|class|function|const|let|var|fn|func|type|interface)\s+$PATTERN\b" "$ROOT" | head -n 40 ;;
  lines)
    rg -n --hidden -g '!.git' -g '!node_modules' -m 5 "$PATTERN" "$ROOT" | head -n 60 ;;
esac
