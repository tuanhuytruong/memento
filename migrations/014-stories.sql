CREATE TABLE "memento_dev".stories (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES "memento_dev".users(id) ON DELETE CASCADE,
 track_id text NOT NULL, title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 120),
 opening text NOT NULL DEFAULT '' CHECK(length(opening)<=4000), closing text NOT NULL DEFAULT '' CHECK(length(closing)<=4000),
 version integer NOT NULL DEFAULT 1 CHECK(version>=1), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,id), FOREIGN KEY(owner_id,track_id) REFERENCES "memento_dev".tracks(owner_id,id) ON DELETE CASCADE
);
CREATE INDEX stories_library ON "memento_dev".stories(owner_id,track_id,updated_at DESC,id DESC);
CREATE TABLE "memento_dev".story_items (
 story_id uuid NOT NULL, item_id text NOT NULL CHECK(length(item_id) BETWEEN 1 AND 128), owner_id uuid NOT NULL,
 moment_id text NOT NULL CHECK(length(moment_id) BETWEEN 1 AND 200), position integer NOT NULL CHECK(position BETWEEN 0 AND 49),
 note text NOT NULL DEFAULT '' CHECK(length(note)<=2000), PRIMARY KEY(story_id,item_id),
 UNIQUE(story_id,position), UNIQUE(story_id,moment_id),
 FOREIGN KEY(owner_id,story_id) REFERENCES "memento_dev".stories(owner_id,id) ON DELETE CASCADE
);
-- Deliberately no entity/track FK: deleted creates remain consumed forever.
CREATE TABLE "memento_dev".story_create_operations (
 actor_id uuid NOT NULL REFERENCES "memento_dev".users(id) ON DELETE CASCADE,
 operation_key text NOT NULL CHECK(length(operation_key) BETWEEN 8 AND 128), payload_hash text NOT NULL,
 story_id uuid NOT NULL, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor_id,operation_key)
);
CREATE INDEX story_create_resource ON "memento_dev".story_create_operations(story_id);
CREATE FUNCTION "memento_dev".tombstone_story_create() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE "memento_dev".story_create_operations SET deleted_at=now() WHERE story_id=OLD.id AND deleted_at IS NULL;
 RETURN OLD;
END;
$$;
CREATE TRIGGER story_create_deleted BEFORE DELETE ON "memento_dev".stories FOR EACH ROW EXECUTE FUNCTION "memento_dev".tombstone_story_create();
