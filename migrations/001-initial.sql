CREATE TABLE IF NOT EXISTS "memento_dev".schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "memento_dev".users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "memento_dev".invites (
  code_hash text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by uuid REFERENCES "memento_dev".users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "memento_dev".sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES "memento_dev".users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON "memento_dev".sessions(expires_at);
CREATE TABLE IF NOT EXISTS "memento_dev".tracks (
  owner_id uuid NOT NULL REFERENCES "memento_dev".users(id) ON DELETE CASCADE,
  id text NOT NULL,
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id, id)
);
CREATE TABLE IF NOT EXISTS "memento_dev".moments (
  owner_id uuid NOT NULL REFERENCES "memento_dev".users(id) ON DELETE CASCADE,
  id text NOT NULL,
  event_id text NOT NULL,
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id, id),
  FOREIGN KEY(owner_id, event_id) REFERENCES "memento_dev".tracks(owner_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS moments_owner_track_idx ON "memento_dev".moments(owner_id, event_id);
CREATE TABLE IF NOT EXISTS "memento_dev".tags (
  owner_id uuid NOT NULL REFERENCES "memento_dev".users(id) ON DELETE CASCADE,
  name text NOT NULL,
  PRIMARY KEY(owner_id, name)
);
CREATE TABLE IF NOT EXISTS "memento_dev".images (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES "memento_dev".users(id) ON DELETE CASCADE,
  moment_id text NOT NULL,
  object_key text NOT NULL UNIQUE,
  content_type text NOT NULL,
  size bigint NOT NULL CHECK (size > 0 AND size <= 10485760),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(owner_id, moment_id) REFERENCES "memento_dev".moments(owner_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS images_owner_moment_idx ON "memento_dev".images(owner_id, moment_id);
