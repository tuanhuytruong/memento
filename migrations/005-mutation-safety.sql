-- Additive. Rollback: deploy previous code first; retain cleanup jobs and drain before dropping queue.
-- Version column / invariant should normally be retained on rollback (no destructive down migration).
ALTER TABLE "memento_dev".moments ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
UPDATE "memento_dev".moments SET document=jsonb_set(document,'{eventId}',to_jsonb(event_id));
ALTER TABLE "memento_dev".moments ADD CONSTRAINT moments_event_document_matches CHECK ((document->>'eventId') IS NOT DISTINCT FROM event_id);
ALTER TABLE "memento_dev".images ADD COLUMN uploader_id uuid, ADD COLUMN upload_key text, ADD COLUMN upload_hash text;
CREATE UNIQUE INDEX images_upload_idempotency ON "memento_dev".images(uploader_id,upload_key) WHERE upload_key IS NOT NULL;
CREATE TABLE "memento_dev".object_cleanup_jobs (
  id uuid PRIMARY KEY,
  object_keys jsonb NOT NULL CHECK (jsonb_typeof(object_keys)='array'),
  state text NOT NULL DEFAULT 'cleanup' CHECK (state IN ('staged','cleanup')),
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX object_cleanup_due ON "memento_dev".object_cleanup_jobs(next_attempt_at);
