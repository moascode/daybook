-- FEAT-061 follow-up (docs/backlog/EP-07-tasks-depth/) — "Every N days" habits.
-- A weekday schedule (0023_habits.sql) cannot say "water the plants every 3
-- days": the gap is not a day-of-week pattern. interval_days is a fixed cycle
-- anchored on the habit's created_at business date — day D is due iff
-- D >= anchor and (D - anchor) % interval_days = 0. It is mutually exclusive
-- with `schedule` (the API stores schedule NULL whenever interval_days is set).
ALTER TABLE habits ADD COLUMN interval_days INTEGER DEFAULT NULL; -- every N days (N>=2); NULL = use schedule
