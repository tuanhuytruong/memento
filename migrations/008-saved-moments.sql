-- Phase 2 Task 2.2: private saved memories.
--
-- A save is personal bookkeeping, not content: the row records only that one
-- user wants to find one memory again. There is no copied story, no photo, no
-- public id and no semantic profile, so a leak of this table reveals nothing
-- beyond "user X once opened memory Y".
--
-- The composite key means saving twice is the same fact, not a duplicate, and
-- the cascade means a deleted memory (or user) takes its saves with it rather
-- than leaving a dangling private pointer.
CREATE TABLE IF NOT EXISTS "memento_dev".saved_moments (
  user_id uuid NOT NULL REFERENCES "memento_dev".users(id) ON DELETE CASCADE,
  moment_owner_id uuid NOT NULL,
  moment_id text NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, moment_owner_id, moment_id),
  FOREIGN KEY (moment_owner_id, moment_id)
    REFERENCES "memento_dev".moments(owner_id, id) ON DELETE CASCADE
);

-- Listing a user's saves is the only read path, so it is the only index worth
-- paying for. Ordering is newest-first, which is what the Saved filter shows.
CREATE INDEX IF NOT EXISTS saved_moments_user_idx
  ON "memento_dev".saved_moments(user_id, saved_at DESC);
