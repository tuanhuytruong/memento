-- Measured on DEV with scripts/phase3-measurement.mjs: at 5,000 moments
-- per owner (20,000 total, accepted collaboration mix), feed warm p95 fell
-- from 24.68ms to 2.52ms. Search did not improve; no search index/extension.
-- Text-only canonical keys match dateKey/timeKey in moment-queries.mjs;
-- no cast or backfill, so malformed legacy dates remain safe sentinels.
-- Rollback: DROP INDEX <configured_schema>.moments_canonical_feed_idx;
CREATE INDEX IF NOT EXISTS moments_canonical_feed_idx ON "memento_dev".moments (
  (CASE WHEN document->>'date' ~ '^\d{4}-\d{2}-\d{2}$' THEN document->>'date' ELSE '9999-99-99' END),
  (CASE WHEN document->>'time' ~ '^\d{2}:\d{2}$' THEN document->>'time' ELSE '99:99' END),
  owner_id, id
);
