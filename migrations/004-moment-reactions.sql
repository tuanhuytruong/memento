CREATE TABLE IF NOT EXISTS "memento_dev".moment_reactions (
  moment_owner_id uuid NOT NULL,
  moment_id text NOT NULL,
  user_id uuid NOT NULL,
  emoji text NOT NULL CHECK (emoji IN ('❤️','🥹','😂','✨','🙌','🎉')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (moment_owner_id, moment_id, user_id, emoji),
  FOREIGN KEY (moment_owner_id, moment_id)
    REFERENCES "memento_dev".moments(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES "memento_dev".users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS moment_reactions_moment_idx
  ON "memento_dev".moment_reactions(moment_owner_id, moment_id, created_at);
