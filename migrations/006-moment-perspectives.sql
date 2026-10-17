CREATE TABLE IF NOT EXISTS "memento_dev".moment_perspectives (
  id uuid PRIMARY KEY,
  moment_owner_id uuid NOT NULL,
  moment_id text NOT NULL,
  author_id uuid NOT NULL REFERENCES "memento_dev".users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('perspective','reflection')),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  client_request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (moment_owner_id, moment_id)
    REFERENCES "memento_dev".moments(owner_id, id) ON DELETE CASCADE,
  UNIQUE (moment_owner_id, moment_id, author_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS moment_perspectives_page_idx
  ON "memento_dev".moment_perspectives(moment_owner_id, moment_id, created_at, id);
