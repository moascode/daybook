-- Convert plain-string tags to JSON arrays so json_each() filter works on all rows.
-- Rows already in JSON array format (json_valid = 1 AND starts with '[') are untouched.
-- Empty strings are left as '' (the filter already excludes them).
UPDATE transactions
SET tag = json_array(tag)
WHERE tag != ''
  AND tag != '[]'
  AND json_valid(tag) = 0;
