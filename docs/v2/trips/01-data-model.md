# Trips — data model (R12, extended R13/R14)

Reconstructed from the five mockups and `REVIEW.md` v15. There is no surviving
written spec (see [README.md](README.md)).

All migrations additive, in **both** `server/migrations/` and
`worker/migrations/`.

---

## R12 — the trip and the thread

```sql
CREATE TABLE IF NOT EXISTS trips (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  destination  TEXT DEFAULT '',
  start_date   TEXT,                       -- null while it is still an idea
  end_date     TEXT,
  status       TEXT NOT NULL DEFAULT 'idea', -- idea|planned|active|past
  budget       REAL NOT NULL DEFAULT 0,      -- in home currency
  palette      TEXT NOT NULL DEFAULT 't-violet',
  currency     TEXT DEFAULT NULL,            -- local currency; null = home only
  cover        TEXT DEFAULT '',
  group_id     TEXT REFERENCES groups(id) ON DELETE SET NULL,  -- who you travel with
  created_at   TEXT DEFAULT (datetime('now'))
);

-- the thread. ON DELETE SET NULL is the promise the UI makes.
ALTER TABLE transactions ADD COLUMN trip_id TEXT REFERENCES trips(id) ON DELETE SET NULL;
ALTER TABLE tasks        ADD COLUMN trip_id TEXT REFERENCES trips(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_txn_trip   ON transactions(trip_id);
CREATE INDEX IF NOT EXISTS idx_tasks_trip ON tasks(trip_id);
CREATE INDEX IF NOT EXISTS idx_trips_user ON trips(user_id, status, start_date);
```

`status` is stored rather than derived from dates because **`idea` has no dates
at all** — a wishlist trip is a real row with a name and nothing else, and that
is the state the module has to be honest about in January.

## R13 — the plan

```sql
CREATE TABLE IF NOT EXISTS trip_items (          -- the itinerary
  id, trip_id NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  day_date   TEXT NOT NULL,
  start_time TEXT,                                -- HH:MM, null = unscheduled
  title      TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'activity',    -- travel|stay|food|activity|admin
  estimate       REAL DEFAULT NULL,               -- home currency; NULL = no estimate
  estimate_local REAL DEFAULT NULL,
  transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,  -- the settled actual
  note       TEXT DEFAULT '',
  sort_order REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS trip_bookings (
  id, trip_id NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                             -- flight|hotel|rail|car|ticket|other
  title, reference TEXT, starts_at TEXT, ends_at TEXT,
  amount REAL DEFAULT 0, currency TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed',       -- held|confirmed|cancelled
  transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  note TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS trip_wishlist (        -- ideas with no commitment
  id, user_id NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title, destination TEXT, note TEXT,
  rough_budget REAL DEFAULT 0, best_season TEXT,
  promoted_trip_id TEXT REFERENCES trips(id) ON DELETE SET NULL,
  created_at
);
```

**`trip_items.estimate` must be nullable and must stay distinguishable from
zero.** One of the itinerary page's two callouts is *"two entries had no estimate
at all and are 64% of Tuesday"* — that finding is impossible if a missing
estimate is stored as 0.

**Packing is not a table.** It is a Tasks subtree with `trip_id` set, seeded
from `task_templates` — which already exists and is currently unused for
anything. That is the ownership rule from [README.md](README.md) applied.

## R14 — multi-currency (**blocked on D-5**)

This reverses CLAUDE.md §15's single-currency decision and touches every money
surface in the app. Treat R14 as a one-way door.

```sql
ALTER TABLE transactions ADD COLUMN original_amount   REAL DEFAULT NULL;
ALTER TABLE transactions ADD COLUMN original_currency TEXT DEFAULT NULL;
ALTER TABLE transactions ADD COLUMN fx_rate           REAL DEFAULT NULL;
```

Rules, from the design:

- **Every trip amount is a pair.** Local leads inside Trips; home leads in
  Wallet, whose job is your ledger and not your holiday.
- **Never two currencies in one column.**
- **The rate is captured per transaction and shown, never back-filled.** A
  back-filled rate is a lie about what you actually paid.
- The rate card lists what you budgeted at, what you are averaging, the best you
  got and the worst — and then does the honest thing: **separates the part of
  the overrun the exchange rate caused from the part you chose.**
- A `local · home` segment in the page head flips which line leads, everywhere at
  once.

`formatMYR` gains a sibling rather than a parameter — a formatter that can
silently produce the wrong currency is the failure mode to design out.

---

## Queries to watch

The burn-down and the "cost of the rest of your plan" figure both aggregate
across `transactions`, `trip_items` and `trip_bookings` in one read.
`SQLITE_MAX_COMPOUND_SELECT` is low on D1 — project with scalar subqueries, not
`UNION ALL`. This is the third documented D1 trap in CLAUDE.md and this is the
query that will hit it.

## Deletion semantics — test them explicitly

Deleting a trip must leave every task, transaction and split intact, with only
`trip_id` nulled. Write that as an e2e spec in R12, not R13: it is the module's
central promise, it is one line of SQL to get wrong, and nothing else in the app
would notice if it were.
