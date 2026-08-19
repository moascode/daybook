# Tasks — feature waves (R10–R11)

---

## R10 · `v3.4.0` — Upcoming, Assigned to me, recurrence

### Upcoming (`tasks-upcoming.html`)

A seven-column week board — **the one place in either module where the layout is
a canvas rather than a list**, because planning is spatial. That is the design's
justification and it is a good one; do not "simplify" it into another list.

- Cards carry a list-coloured left edge; day headers count their load; empty days
  show a dashed **Add**.
- The point of the view is visible without reading: Wednesday has 7, Saturday
  has 1.
- Below it, the tasks **waiting for a date** with per-row Schedule.
- **Balance the week** proposes two specific moves that bring Wednesday to 5 and
  Saturday to 2 — an action, not an observation.
- Drag between days sets `due_date`. Reuse `@dnd-kit`, already in the stack for
  the outliner.

### Assigned to me (`tasks-assigned.html`) — **requires D-15**

Delegation as a **two-way ledger**:

- *Waiting on you*, grouped by who asked.
- The rail shows what **you** handed out, flagging ones that have **gone quiet**
  — and naming the actual cause: assigned without a date.
- The band carries **turnaround times per person** (Jordan 1.1 days, Priya 3.8).

That last one is the household-ledger argument in a nutshell: a shared task app
can know it and a personal one cannot.

If D-15 is declined, this page does not ship and R10 is just Upcoming +
recurrence.

### Task recurrence

Wallet has recurrence; Tasks does not, and the designed rows say `Repeats weekly`.

```sql
ALTER TABLE tasks ADD COLUMN recurrence      TEXT DEFAULT NULL;  -- daily|weekly|monthly|yearly|custom
ALTER TABLE tasks ADD COLUMN recurrence_data TEXT DEFAULT NULL;  -- JSON: interval, weekdays, end
ALTER TABLE tasks ADD COLUMN recurrence_parent_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;
```

Decide once and write it down: **does completing a recurring task create the
next instance, or does the instance already exist?** Wallet's
`recurring_transactions` materialises on due; matching that is the consistent
choice and means one mental model across the app.

---

## R11 · `v3.5.0` — Habits, Completed analytics, Worth knowing

### Habits (`tasks-habits.html`)

```sql
CREATE TABLE IF NOT EXISTS habits (
  id, user_id, name, color, icon,
  target_per_week INTEGER NOT NULL DEFAULT 7,
  schedule TEXT,                   -- JSON: which weekdays it is due
  linked_kind TEXT DEFAULT NULL,   -- e.g. 'wallet:no-spend'
  archived INTEGER NOT NULL DEFAULT 0,
  created_at
);
CREATE TABLE IF NOT EXISTS habit_entries (
  habit_id, date TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (habit_id, date)
);
```

Each habit gets a completion ring, a **28-day dot grid** (green kept, red missed,
grey not-due), a current streak and a personal best. The weekday chart carries
the insight, not just the data: Friday is the only day under 70%, **and the
reason is that Friday is the second-heaviest task day** — habits are being
squeezed out rather than forgotten.

**"No spend day"** is the Wallet-linked habit: `done` derives from there being no
expense transaction that day. It is the cheapest cross-module feature in the plan
and the most convincing.

### Completed analytics

Year-long heatmap (one square per day), completions by list, and **time to
finish** — which lands the finding the design is proudest of: Work takes 0.8
days, Someday takes 94. **Someday is a graveyard, not a backlog.**

### Worth knowing

Tasks' equivalent of Budgets' Suggestions, read off your own history. Same
architecture: a pure module, unit-tested, each finding paired with a fix.

| Finding | Offered fix |
|---|---|
| mornings finish 78% of the time, evenings 41%; three of today's six are evening | move them to the morning |
| "Book the dentist" has moved four times, and tasks moved 3+ times rarely get done | break it down or drop it |
| Sunday is nine and Saturday is one | rebalance |

### Wallet chips on task rows

The other half of the cross-module thread: `Wallet · RM1,800 due tomorrow`,
`Saves RM59.99/mo`, `Wallet goal · 88% funded`. Needs a link between a task and a
wallet object — a nullable `tasks.wallet_ref` (`kind:id`) is enough, and is
narrower than a join table for a feature that is one chip.

Also ships **Up next** in the Today rail actually mixing modules, which R5
deliberately left as tasks-only.
