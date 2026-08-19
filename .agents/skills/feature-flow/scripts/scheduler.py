#!/usr/bin/env python3
"""scheduler.py — periodic checkpoint + heartbeat for long flows.

A convenience layer on top of `resume`. Writes a heartbeat and touches the
state file's updated_at on an interval so an interrupted long phase loses less
work. It is NEVER required for correctness — if it's stale or absent, fall back
to plain `resume`.

Usage:
  scheduler.py --interval 300 --docs /docs     # heartbeat every 5 min (foreground; run with & or nohup)
  scheduler.py --status --docs /docs           # show last heartbeat and staleness
  scheduler.py --once --docs /docs             # write a single heartbeat and exit
"""
import argparse, json, os, sys, time, datetime

def hb_path(docs): return os.path.join(docs, ".flow-heartbeat")
def state_path(docs): return os.path.join(docs, ".flow-state.json")

def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def write_heartbeat(docs):
    os.makedirs(docs, exist_ok=True)
    phase = None
    try:
        with open(state_path(docs)) as f:
            phase = json.load(f).get("phase")
    except Exception:
        pass
    with open(hb_path(docs), "w") as f:
        json.dump({"heartbeat_at": now_iso(), "phase": phase}, f)

def status(docs):
    p = hb_path(docs)
    if not os.path.exists(p):
        print("no heartbeat — use plain `resume`"); return
    with open(p) as f: hb = json.load(f)
    ts = datetime.datetime.fromisoformat(hb["heartbeat_at"])
    age = (datetime.datetime.now(datetime.timezone.utc) - ts).total_seconds()
    stale = age > 900  # 15 min
    print(json.dumps({"heartbeat_at": hb["heartbeat_at"], "phase": hb.get("phase"),
                      "age_seconds": round(age), "stale": stale,
                      "note": "stale → fall back to resume" if stale else "ok"}, indent=2))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--docs", required=True)
    ap.add_argument("--interval", type=int, default=300)
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--once", action="store_true")
    a = ap.parse_args()

    if a.status: status(a.docs); return
    if a.once:   write_heartbeat(a.docs); print("heartbeat written"); return

    # foreground loop; caller backgrounds it
    try:
        while True:
            write_heartbeat(a.docs)
            time.sleep(a.interval)
    except KeyboardInterrupt:
        print("scheduler stopped")

if __name__ == "__main__":
    main()
