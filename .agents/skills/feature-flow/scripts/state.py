#!/usr/bin/env python3
"""Read/write flow state at <docs>/.flow-state.json.

Usage:
  state.py init  --docs /docs --task "..." --task-type feature --mode manual
  state.py get   --docs /docs [--key phase]
  state.py set   --docs /docs --key phase --value plan
  state.py checkpoint --docs /docs --phase plan --artifact flow-plan.md
  state.py lock-files --docs /docs path/a path/b
  state.py bump-loop --docs /docs        # increments review_loop, prints new value
"""
import argparse, json, os, sys, datetime

def path(docs): return os.path.join(docs, ".flow-state.json")

def load(docs):
    p = path(docs)
    if not os.path.exists(p): return {}
    with open(p) as f: return json.load(f)

def save(docs, state):
    os.makedirs(docs, exist_ok=True)
    state["updated_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with open(path(docs), "w") as f: json.dump(state, f, indent=2)

def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    pi = sub.add_parser("init")
    pi.add_argument("--docs", required=True)
    pi.add_argument("--task", required=True)
    pi.add_argument("--task-type", default="feature", choices=["feature", "bug"])
    pi.add_argument("--mode", default="manual", choices=["auto", "manual"])

    pg = sub.add_parser("get"); pg.add_argument("--docs", required=True); pg.add_argument("--key")
    ps = sub.add_parser("set"); ps.add_argument("--docs", required=True); ps.add_argument("--key", required=True); ps.add_argument("--value", required=True)

    pc = sub.add_parser("checkpoint")
    pc.add_argument("--docs", required=True); pc.add_argument("--phase", required=True); pc.add_argument("--artifact")

    pl = sub.add_parser("lock-files"); pl.add_argument("--docs", required=True); pl.add_argument("files", nargs="+")
    pb = sub.add_parser("bump-loop"); pb.add_argument("--docs", required=True)

    a = ap.parse_args()

    if a.cmd == "init":
        save(a.docs, {"task": a.task, "task_type": a.task_type, "mode": a.mode,
                      "phase": "triage", "completed_artifacts": [], "locked_files": [],
                      "review_loop": 0, "escalations": []})
        print("initialized")
    elif a.cmd == "get":
        s = load(a.docs)
        print(json.dumps(s.get(a.key)) if a.key else json.dumps(s, indent=2))
    elif a.cmd == "set":
        s = load(a.docs); s[a.key] = a.value; save(a.docs, s); print(f"{a.key}={a.value}")
    elif a.cmd == "checkpoint":
        s = load(a.docs); s["phase"] = a.phase
        if a.artifact and a.artifact not in s.get("completed_artifacts", []):
            s.setdefault("completed_artifacts", []).append(a.artifact)
        save(a.docs, s); print(f"checkpoint: phase={a.phase}")
    elif a.cmd == "lock-files":
        s = load(a.docs); s["locked_files"] = a.files; save(a.docs, s); print(f"locked {len(a.files)} files")
    elif a.cmd == "bump-loop":
        s = load(a.docs); s["review_loop"] = s.get("review_loop", 0) + 1; save(a.docs, s); print(s["review_loop"])

if __name__ == "__main__":
    main()
