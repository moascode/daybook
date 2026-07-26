-- Fix transactions where tag is an empty string or otherwise invalid JSON.
-- Migration 0002 skipped tag='' rows assuming the filter would exclude them,
-- but json_each('') throws a SQLite error and breaks the tag filter entirely.
UPDATE transactions SET tag = '[]' WHERE tag = '' OR NOT json_valid(tag) OR json_type(tag) != 'array';
