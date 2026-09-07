-- v3 P4 — Web Push subscriptions.
--
-- One row per browser that has granted permission. `endpoint` is the push
-- service URL the browser hands us and is unique per install, so it is the
-- natural key: re-subscribing the same browser replaces rather than duplicates.
--
-- p256dh/auth are the subscription's own keys. They are stored because the Web
-- Push spec requires them for an encrypted payload — Daybook sends PAYLOAD-LESS
-- pushes (the service worker fetches the content itself), so they are unused
-- today and kept only so adding a payload later does not need a re-subscribe.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL UNIQUE,
  p256dh       TEXT NOT NULL DEFAULT '',
  auth         TEXT NOT NULL DEFAULT '',
  created_at   TEXT DEFAULT (datetime('now')),
  last_sent_at TEXT DEFAULT NULL,
  -- Set when the push service answers 404/410: the subscription is dead and
  -- must never be retried. Rows are kept rather than deleted so a debug session
  -- can tell "never subscribed" from "subscription expired".
  expired_at   TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id, expired_at);

-- One row per user per notification kind per day, so a cron that runs twice
-- (a retry, an overlapping schedule) cannot notify twice. The date is the
-- business-timezone calendar date.
CREATE TABLE IF NOT EXISTS push_sent_log (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL,
  sent_on  TEXT NOT NULL,
  sent_at  TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, kind, sent_on)
);
