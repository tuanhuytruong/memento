CREATE TABLE "memento_dev".future_letters (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES "memento_dev".users(id) ON DELETE CASCADE,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 120), body text NOT NULL CHECK(length(body)<=10000),
 release_at timestamptz, timezone text, sealed_at timestamptz, opened_at timestamptz,
 version integer NOT NULL DEFAULT 1 CHECK(version>=1), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,id), CHECK(sealed_at IS NULL OR (release_at IS NOT NULL AND timezone IS NOT NULL AND length(btrim(body))>0 AND release_at>sealed_at)),
 CHECK(opened_at IS NULL OR (sealed_at IS NOT NULL AND opened_at>=release_at))
);
CREATE INDEX future_letters_library ON "memento_dev".future_letters(owner_id,updated_at DESC,id DESC);
CREATE INDEX future_letters_release ON "memento_dev".future_letters(owner_id,release_at,id);
CREATE TABLE "memento_dev".future_letter_photos (
 letter_id uuid NOT NULL,owner_id uuid NOT NULL,position integer NOT NULL CHECK(position BETWEEN 0 AND 5),moment_id text NOT NULL,image_id text NOT NULL,
 PRIMARY KEY(letter_id,position),UNIQUE(letter_id,image_id), FOREIGN KEY(owner_id,letter_id) REFERENCES "memento_dev".future_letters(owner_id,id) ON DELETE CASCADE
);
CREATE TABLE "memento_dev".letter_create_operations (
 actor_id uuid NOT NULL REFERENCES "memento_dev".users(id) ON DELETE CASCADE,operation_key text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('create','seal','open')),payload_hash text NOT NULL,letter_id uuid NOT NULL,
 deleted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor_id,operation_key)
);
CREATE INDEX letter_operations_resource ON "memento_dev".letter_create_operations(letter_id);
CREATE FUNCTION "memento_dev".guard_future_letter() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN UPDATE "memento_dev".letter_create_operations SET deleted_at=clock_timestamp() WHERE letter_id=OLD.id AND deleted_at IS NULL; RETURN OLD; END IF;
 IF OLD.sealed_at IS NOT NULL AND (NEW.title,NEW.body,NEW.release_at,NEW.timezone,NEW.sealed_at) IS DISTINCT FROM (OLD.title,OLD.body,OLD.release_at,OLD.timezone,OLD.sealed_at) THEN RAISE EXCEPTION 'Sealed letter is immutable'; END IF;
 IF OLD.opened_at IS NOT NULL AND NEW.opened_at IS DISTINCT FROM OLD.opened_at THEN RAISE EXCEPTION 'First open is immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER future_letter_guard BEFORE UPDATE OR DELETE ON "memento_dev".future_letters FOR EACH ROW EXECUTE FUNCTION "memento_dev".guard_future_letter();
CREATE FUNCTION "memento_dev".guard_letter_photo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "memento_dev".future_letters WHERE id=coalesce(NEW.letter_id,OLD.letter_id) AND sealed_at IS NOT NULL) THEN RAISE EXCEPTION 'Sealed attachments are immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER letter_photo_guard BEFORE INSERT OR UPDATE OR DELETE ON "memento_dev".future_letter_photos FOR EACH ROW EXECUTE FUNCTION "memento_dev".guard_letter_photo();
