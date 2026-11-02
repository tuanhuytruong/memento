-- Durable tombstones intentionally have no FK to moments/tracks: deletion must
-- never make an old operation usable again. Account deletion cleans its ledger.
CREATE TABLE "memento_dev".moment_create_operations (
  actor_id uuid NOT NULL REFERENCES "memento_dev".users(id) ON DELETE CASCADE,
  operation_key text NOT NULL CHECK (length(operation_key) BETWEEN 8 AND 128),
  owner_id uuid NOT NULL REFERENCES "memento_dev".users(id) ON DELETE CASCADE,
  track_id text NOT NULL,
  payload_hash text NOT NULL,
  moment_id text NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, operation_key)
);
CREATE INDEX moment_create_resource ON "memento_dev".moment_create_operations(owner_id,moment_id);
CREATE FUNCTION "memento_dev".tombstone_moment_create() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "memento_dev".moment_create_operations SET deleted_at=now()
    WHERE owner_id=OLD.owner_id AND moment_id=OLD.id AND deleted_at IS NULL;
  RETURN OLD;
END;
$$;
CREATE TRIGGER moment_create_deleted BEFORE DELETE ON "memento_dev".moments
FOR EACH ROW EXECUTE FUNCTION "memento_dev".tombstone_moment_create();
