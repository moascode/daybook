-- Memoizes AI-derived merchant-name corrections, per user. The CSV import and
-- bulk-cleanup resolution ladder (regex guess -> corrections -> history -> AI)
-- calls Claude only when a given bank's narrative template has never produced
-- this exact regex guess before; the answer is written here so every future
-- occurrence of the same template resolves for free, without spending another
-- AI call. Keyed on the NORMALIZED regex guess (see correctionKey() in
-- worker/lib/merchant.ts), not the raw narrative, since the same guess can
-- recur across many raw narratives (different reference numbers, dates, etc.)
-- that all collapse to the same cleaned candidate.
CREATE TABLE IF NOT EXISTS merchant_corrections (
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  regex_guess    TEXT NOT NULL,
  corrected_name TEXT NOT NULL,
  created_at     TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, regex_guess)
);
