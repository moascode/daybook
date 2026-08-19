# Day — data model

Day mostly reads other modules' tables. It needs two things of its own.

---

## 1. Time of day (D-6)

`transactions.date` is `YYYY-MM-DD`. The timeline is ordered by *time*.

**R6 (interim).** Order money rows by `created_at`, which is already a full
timestamp, and **do not display a clock time on them**. The ribbon and the
ordering work; nothing lies.

Do not display `created_at` as if it were the purchase time. A row imported at
23:00 for a 09:00 coffee would place the coffee at 23:00 — and the seven-minutes-
apart adjacency is the entire argument for the page.

**R15 (real).**

```sql
ALTER TABLE transactions ADD COLUMN occurred_at TEXT DEFAULT NULL;  -- ISO datetime
```

- Set by the composer and editable in `TransactionForm`.
- Falls back to `created_at` when null.
- **CSV imports leave it null** and sort to the start of the day, in a group the
  timeline labels honestly (`no time recorded`) rather than scattering them.

Tasks get their time from R4's `due_time`, and completed tasks from
`completed_at`.

## 2. Notes

Notes are **first-class timeline entries**, not a text field on the day.

```sql
CREATE TABLE IF NOT EXISTS notes (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,                 -- YYYY-MM-DD, the day it belongs to
  occurred_at TEXT DEFAULT NULL,             -- position on the spine
  body        TEXT NOT NULL DEFAULT '',
  trip_id     TEXT REFERENCES trips(id) ON DELETE SET NULL,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_user_date ON notes(user_id, date);
```

Rendered in a sunken block with a left rule. They are also what makes **On this
day** work — the design's example lands because the boiler has come up in your
notes four times in twelve months, and that is only possible if notes are
searchable rows.

## 3. The timeline query

One endpoint, `GET /api/day/:date`, returning a merged, ordered entry list plus
the band figures. It reads `tasks`, `transactions`, `notes`, `habit_entries`
(R11) and `recurring_transactions`, filtered by the sidebar's four **Show on the
timeline** toggles.

Two constraints:

- **Business timezone, server-side.** "Today", the `now` rule position and the
  solid/hollow split are all timezone decisions, and CLAUDE.md §16 trap 1 is
  precisely this bug. Compute them where the timezone is known, not in the
  browser.
- **D1's low `SQLITE_MAX_COMPOUND_SELECT`.** This is a many-source union by
  nature. Use separate reads assembled in JS, or scalar subqueries — not one
  large `UNION ALL`.

## 4. Close the day (R16)

Needs a small amount of state so the ritual is idempotent and the month grid can
show which days were closed:

```sql
CREATE TABLE IF NOT EXISTS day_closures (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date     TEXT NOT NULL,
  closed_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, date)
);
```
