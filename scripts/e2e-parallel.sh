#!/usr/bin/env bash
#
# e2e-parallel.sh — run the Playwright suite as N locally-parallel shards.
#
# The full suite (`npx playwright test`) runs single-worker
# (playwright.config.ts: workers: 1, fullyParallel: false) and takes ~10
# minutes. CI cuts that to ~2 by running 6 shards — but each on its own
# GitHub Actions runner (.github/workflows/ci.yml), a separate machine with
# nothing shared between them.
#
# That can't be copied onto one machine by just adding `--shard` locally.
# This repo's local D1 (Miniflare/workerd) is fragile under ANY concurrent
# access to the same storage — even two `wrangler dev` processes pointed at
# the same persisted state produced SQLITE_BUSY errors and hung requests
# during R2's development (see docs/v2/.flow/R2-shell/.flow-log.md). The
# root cause was concurrent access to ONE shared SQLite file, not concurrency
# itself, so the fix is real isolation, not raw parallelism: each shard here
# gets its own `wrangler dev` process, own port, own `--persist-to` D1
# storage directory, and own HTML report folder. Nothing is shared except
# the one-time `npm run build` (the built dist/ is read-only at test time).
# Verified clean at 2 shards (339/339 passed, zero SQLITE_BUSY).
#
# Two more things had to be earned the hard way getting this far, both at 4
# shards on a 4-core/15GB box:
#
# 1. One shard's `wrangler dev` hit the exact "empty ✘ [ERROR]" crash
#    playwright.config.ts already documents as a known, pre-existing
#    wrangler/workerd fragility under load (not something this script's
#    isolation caused — concurrent local resource pressure just triggers it
#    more readily than CI's one-shard-per-runner). CI's own mitigation is
#    `retries: 2`, deliberately CI-only ("local runs stay strict — a failure
#    on this machine is a failure" per that file's comment). This script
#    narrows that same mitigation to exactly the case it's for: after the
#    run, a FAILED shard whose server no longer answers its health check
#    gets one fresh restart + retry (that failure is the tool crashing, not
#    a test); a failed shard whose server is still healthy is left alone
#    and reported as a real failure, never retried.
#
# 2. `kill "$server_pid"` on the tracked wrangler PID is NOT enough to stop
#    a shard: `npx wrangler dev` is actually three processes deep (npx's
#    node wrapper -> the wrangler CLI -> a workerd runtime child), and
#    workerd does not reliably die with its parent. A crashed run left
#    orphaned wrangler+workerd processes still bound to their ports; the
#    NEXT run then failed at startup with workerd's own
#    "Address already in use" — a second, different-looking symptom of the
#    exact same underlying wrangler fragility as (1), not a new bug. Every
#    stop below is therefore by PORT (`fuser -k`, which kills whoever is
#    actually listening, at any process-tree depth) rather than by the one
#    PID `$!` happened to capture, and the script frees its whole port range
#    up front too, in case a previous run was killed hard enough to skip its
#    own cleanup trap (e.g. `kill -9`, a crashed shell).
#
# playwright.config.ts and e2e/global-setup.ts read E2E_PORT / E2E_PERSIST_TO
# / E2E_REPORT_DIR to make this possible; unset (every other invocation —
# CI, `npm run test:e2e`, a bare `npx playwright test`), each defaults to
# today's exact single-server values, so nothing here changes those paths.
#
# Usage:
#   scripts/e2e-parallel.sh [N]
#
#   N   Number of shards. Defaults to min(nproc, 6) — 6 to match CI's own
#       shard count, capped by actual cores since this all runs on one
#       machine (workerd + Chromium per shard is real CPU/memory, unlike
#       CI's one-shard-per-runner). If you see the crash in (1) above even
#       at the default, pass a smaller N, e.g. `scripts/e2e-parallel.sh 2`.
#
# Output: pass/fail per shard on stdout; full logs under .e2e-parallel-logs/
# (one {shard}.server.log / {shard}.migrate.log / {shard}.test.log each,
# plus a .retry copy of the latter two if that shard was retried) for
# anything that needs a closer look. Exits non-zero if any shard failed
# after its retry (if it got one).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# ── Shard count ──────────────────────────────────────────────────────────
CORES="$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)"
DEFAULT_N=$(( CORES < 6 ? CORES : 6 ))
N="${1:-$DEFAULT_N}"

if ! [[ "$N" =~ ^[0-9]+$ ]] || [ "$N" -lt 1 ]; then
  echo "✗ N must be a positive integer (got: $N)" >&2
  exit 1
fi

BASE_PORT=5180          # avoids 5173 — CLAUDE.md's own trap: a hand-started
                         # server there gets silently adopted by a bare
                         # `playwright test` run via reuseExistingServer.
INSPECTOR_OFFSET=4000   # wrangler's devtools inspector port, offset per
                         # shard — its default (9229) is shared across every
                         # instance, so two shards on one port would collide
                         # on it even with distinct --port/--persist-to.
LOG_DIR="$ROOT_DIR/.e2e-parallel-logs"

rm -rf "$LOG_DIR"
mkdir -p "$LOG_DIR"

port_for()       { echo $((BASE_PORT + $1)); }
inspector_for()  { echo $(($(port_for "$1") + INSPECTOR_OFFSET)); }
persist_for()    { echo "$ROOT_DIR/.wrangler-e2e-shard-$1"; }

# Kill whoever is actually listening on a port, then BLOCK until the OS has
# actually released it — see postmortem (2) above for why this, not a
# tracked PID, is the thing that has to be reliable. `fuser -k` sends the
# kill and returns immediately; there is a real window afterward where the
# process is dead but the socket hasn't been reclaimed yet, and starting the
# next shard's server inside that window is exactly what produced workerd's
# own "Address already in use" the first two times this script tried it.
free_port() {
  local port="$1"
  fuser -k "$port/tcp" >/dev/null 2>&1 || true
  for _attempt in $(seq 1 20); do
    fuser "$port/tcp" >/dev/null 2>&1 || return 0
    sleep 0.5
  done
  echo "✗ port $port still held after 10s — see \`fuser $port/tcp\`" >&2
  return 1
}

# Recursively SIGKILL a PID and everything it spawned. Needed because
# `wrangler dev`'s own node process supervises workerd and RESPAWNS it the
# instant it dies — so killing only the current port-holder (what free_port
# does) can chase a moving target forever. Observed directly: fuser -k on
# the app port killed workerd, and a fresh workerd instance reappeared on
# the very same port seconds later, spawned by the still-alive wrangler CLI
# process several tree levels above — free_port's own polling loop then has
# nothing to converge on and can spin for its full 10s timeout repeatedly.
kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$child"
  done
  kill -9 "$pid" >/dev/null 2>&1 || true
}

declare -A SERVER_PIDS=()

cleanup() {
  # Captured first: this trap's own commands (the `|| true` guards below in
  # particular) otherwise overwrite $? by the time the function returns,
  # silently turning a real "shard(s) failed" `exit 1` into a 0 — observed
  # directly in this environment (script printed the failure summary, then
  # exited 0). Restored explicitly at the end so a caller (CI, `&&`/`if`
  # chain, another script) sees the real result.
  local status=$?
  if [ "${#SERVER_PIDS[@]}" -gt 0 ]; then
    echo "› Stopping shard server(s)…"
    for i in "${!SERVER_PIDS[@]}"; do
      # Kill the whole tree FIRST so the supervisor can't respawn workerd
      # out from under free_port's port-release wait — see kill_tree above.
      kill_tree "${SERVER_PIDS[$i]}"
      free_port "$(port_for "$i")" || true
      free_port "$(inspector_for "$i")" || true
    done
    wait >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

# A previous run killed hard enough to skip its own trap (kill -9, a crashed
# shell) leaves exactly this: the next run's ports already held. Clear the
# whole range before touching anything.
echo "› Clearing ports $((BASE_PORT + 1))-$((BASE_PORT + N)) (and their inspector ports) of anything left over from a previous run…"
for i in $(seq 1 "$N"); do
  free_port "$(port_for "$i")" || true
  free_port "$(inspector_for "$i")" || true
done

# Start shard $1's wrangler dev (fresh D1, migrated, health-checked before
# returning). Safe to call twice for the same shard — always wipes first.
start_shard() {
  local i="$1" port persist
  port="$(port_for "$i")"
  persist="$(persist_for "$i")"
  rm -rf "$persist"

  npx wrangler d1 migrations apply daybook --env dev --local --persist-to "$persist" \
    > "$LOG_DIR/shard-$i.migrate.log" 2>&1 || {
      echo "✗ shard $i: D1 migration failed — see $LOG_DIR/shard-$i.migrate.log" >&2
      exit 1
    }

  npx wrangler dev --env dev --port "$port" --inspector-port "$(inspector_for "$i")" \
    --persist-to "$persist" --show-interactive-dev-session false --var DAYBOOK_QUIET_LOGS:1 \
    > "$LOG_DIR/shard-$i.server.log" 2>&1 &
  SERVER_PIDS[$i]="$!"

  local up=0
  for _attempt in $(seq 1 60); do
    if curl -sf "http://localhost:$port/api/health" >/dev/null 2>&1; then
      up=1
      break
    fi
    sleep 1
  done
  if [ "$up" -ne 1 ]; then
    echo "✗ shard $i's server (port $port) never came up after 60s — see $LOG_DIR/shard-$i.server.log" >&2
    exit 1
  fi
}

stop_shard() {
  local i="$1"
  # Kill the whole tree first — see kill_tree's comment: wrangler's node
  # process respawns workerd, so free_port alone can chase a moving target.
  kill_tree "${SERVER_PIDS[$i]}"
  free_port "$(port_for "$i")" || true
  free_port "$(inspector_for "$i")" || true
  unset "SERVER_PIDS[$i]"
}

# True (0) if shard $1's server is still answering its health check.
shard_server_healthy() {
  curl -sf "http://localhost:$(port_for "$1")/api/health" >/dev/null 2>&1
}

run_shard_tests() {
  local i="$1" suffix="${2:-}" port persist
  port="$(port_for "$i")"
  persist="$(persist_for "$i")"
  E2E_PORT="$port" E2E_PERSIST_TO="$persist" E2E_REPORT_DIR="playwright-report-shard-$i" \
    npx playwright test --shard="$i/$N" > "$LOG_DIR/shard-$i.test${suffix}.log" 2>&1
}

echo "› Building once (shared read-only across all $N shards)…"
VITE_E2E=1 npm run build

echo "› Starting $N isolated wrangler dev instances (own port, own D1 storage each)…"
for i in $(seq 1 "$N"); do
  start_shard "$i"
done
echo "✓ all $N servers healthy"

echo "› Running $N test shards in parallel…"
declare -A TEST_PIDS=()
for i in $(seq 1 "$N"); do
  run_shard_tests "$i" &
  TEST_PIDS[$i]="$!"
done

declare -A RESULT=()  # pass | fail
for i in $(seq 1 "$N"); do
  if wait "${TEST_PIDS[$i]}"; then
    RESULT[$i]=pass
    echo "✓ shard $i/$N passed"
  else
    RESULT[$i]=fail
    echo "✗ shard $i/$N failed"
  fi
done

# ── Retry pass: only shards whose server crashed, and only once ──────────
RETRIED=()
for i in $(seq 1 "$N"); do
  if [ "${RESULT[$i]}" = fail ] && ! shard_server_healthy "$i"; then
    echo ""
    echo "› shard $i's server died mid-run (the known wrangler crash, not a test) — restarting and retrying once…"
    stop_shard "$i"
    start_shard "$i"
    if run_shard_tests "$i" ".retry"; then
      RESULT[$i]=pass
      echo "✓ shard $i/$N passed on retry"
    else
      echo "✗ shard $i/$N failed again on retry — treating as a real failure"
    fi
    RETRIED+=("$i")
  fi
done

echo ""
FAILED=0
for i in $(seq 1 "$N"); do
  [ "${RESULT[$i]}" = fail ] && FAILED=1
done

if [ "$FAILED" -ne 0 ]; then
  echo "── failure summary ──"
  for i in $(seq 1 "$N"); do
    [ "${RESULT[$i]}" = fail ] || continue
    log="$LOG_DIR/shard-$i.test.log"
    for r in "${RETRIED[@]:-}"; do [ "$r" = "$i" ] && log="$LOG_DIR/shard-$i.test.retry.log"; done
    echo "── shard $i ($log) ──"
    grep -B2 -A 15 -E "^\s*[0-9]+\) |Error:" "$log" 2>/dev/null | head -60
    echo ""
  done
  echo "✗ e2e-parallel: at least one shard failed"
  exit 1
fi

if [ "${#RETRIED[@]}" -gt 0 ]; then
  echo "✓ e2e-parallel: all $N shards passed (shard(s) ${RETRIED[*]} needed one retry after a wrangler crash)"
else
  echo "✓ e2e-parallel: all $N shards passed"
fi
