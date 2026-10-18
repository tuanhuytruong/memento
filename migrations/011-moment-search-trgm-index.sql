-- pg_trgm installation is a separately approved database-wide operation.
-- This migration only creates the target schema's small DEV index.
SET LOCAL lock_timeout = '3s';
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_trgm' AND n.nspname='public') THEN
  RAISE EXCEPTION 'Install approved pg_trgm in verified public namespace before migration 011';
 END IF;
 IF EXISTS (SELECT 1 FROM "memento_dev".moments WHERE search_text IS NULL) THEN
  RAISE EXCEPTION 'Run bounded search backfill and verify before index migration';
 END IF;
END $$;
CREATE INDEX moments_search_text_trgm_v1 ON "memento_dev".moments USING gin (search_text public.gin_trgm_ops);
ANALYZE "memento_dev".moments;
