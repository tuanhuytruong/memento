ALTER TABLE "memento_dev".images
  ADD COLUMN IF NOT EXISTS thumb_object_key text,
  ADD COLUMN IF NOT EXISTS display_object_key text,
  ADD COLUMN IF NOT EXISTS thumb_size bigint,
  ADD COLUMN IF NOT EXISTS display_size bigint,
  ADD COLUMN IF NOT EXISTS width integer,
  ADD COLUMN IF NOT EXISTS height integer;
CREATE INDEX IF NOT EXISTS images_variant_backfill_idx
  ON "memento_dev".images(id)
  WHERE thumb_object_key IS NULL OR display_object_key IS NULL;
