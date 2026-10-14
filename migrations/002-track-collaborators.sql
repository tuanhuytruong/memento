CREATE TABLE IF NOT EXISTS "memento_dev".track_collaborators (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  track_id text NOT NULL,
  recipient_id uuid NOT NULL REFERENCES "memento_dev".users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('viewer', 'editor')),
  invited_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  FOREIGN KEY (owner_id, track_id) REFERENCES "memento_dev".tracks(owner_id, id) ON DELETE CASCADE,
  UNIQUE (owner_id, track_id, recipient_id),
  CHECK (expires_at > invited_at)
);
CREATE INDEX IF NOT EXISTS track_collaborators_recipient_active_idx
  ON "memento_dev".track_collaborators(recipient_id, expires_at)
  WHERE accepted_at IS NOT NULL AND revoked_at IS NULL;
