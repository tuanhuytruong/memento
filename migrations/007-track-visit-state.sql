CREATE TABLE IF NOT EXISTS "memento_dev".track_visit_state (
  user_id uuid NOT NULL REFERENCES "memento_dev".users(id) ON DELETE CASCADE,
  track_owner_id uuid NOT NULL,
  track_id text NOT NULL,
  last_opened_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, track_owner_id, track_id),
  FOREIGN KEY (track_owner_id, track_id)
    REFERENCES "memento_dev".tracks(owner_id, id) ON DELETE CASCADE
);
