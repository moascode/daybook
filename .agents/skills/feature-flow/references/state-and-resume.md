# State, Resume & Scheduling

## State schema (`/docs/.flow-state.json`)

```json
{
  "task": "short description",
  "task_type": "feature | bug",
  "mode": "auto | manual",
  "phase": "triage | explore | plan | implement | review | done",
  "completed_artifacts": ["flow-context-map.md", "flow-plan.md"],
  "locked_files": ["path/a", "path/b"],
  "review_loop": 0,
  "escalations": [],
  "updated_at": "ISO-8601"
}
```

`review_loop` enforces the cap of 2. `locked_files` is copied from the plan and read by the scope guard. `completed_artifacts` is what enables reuse — before spawning any phase, check whether its artifact already exists here and reuse it rather than redoing the work.

## Checkpointing

Checkpoint after **every** phase by writing state via `scripts/state.py set`. A checkpoint is: update `phase`, append to `completed_artifacts`, bump `updated_at`. This is cheap and is the backbone of resumability.

## Resume procedure (`resume`)

1. Read `/docs/.flow-state.json`.
2. Verify each artifact in `completed_artifacts` still exists in `/docs`. If one is missing, treat that phase as incomplete and re-run only it.
3. Reload the artifacts (not transcripts) needed by the next phase.
4. Continue from `phase`.

Resume must always work on its own — it depends only on files in `/docs`, nothing in-memory. This is the primary recovery path.

## Time-based scheduler (`scripts/scheduler.py`)

A convenience layer for long flows. It:
- writes a periodic heartbeat (`/docs/.flow-heartbeat`) with a timestamp,
- triggers a checkpoint on an interval so an interrupted long phase loses less work.

Usage:
```bash
python scripts/scheduler.py --interval 300 --docs /docs   # checkpoint/heartbeat every 5 min
python scripts/scheduler.py --status --docs /docs          # show last heartbeat / staleness
```

**Fallback rule:** the scheduler is optional. If it's unavailable, errors, or the heartbeat is stale, fall back to plain `resume`. Never block or fail the flow because the scheduler misbehaved — it only ever *adds* safety, it is never required for correctness.
