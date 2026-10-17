// Phase 2 Task 2.2: private saved memories.
//
// A save is personal bookkeeping, not collaboration. Nothing here copies a
// story, a photo or a track title, and nothing is visible to the memory's
// owner or to other collaborators. What is stored is the fact that one user
// asked to find one memory again.
//
// Every read intersects the stored rows with the caller's CURRENT authorized
// moments. Revoking access therefore hides the memory and the count without
// leaking an id or a title, and keeping a dormant relationship row does not
// restore anything on its own.

/** Composite identity used everywhere on the wire and in the client. */
export function savedKey(ownerId, id) {
  return `${ownerId}:${id}`;
}

/**
 * Desired-state write. `active: true` saves, `false` unsaves, and repeating
 * either is a no-op rather than an error, so a retried request and a
 * double-tap settle on the same fact. No racing toggle endpoint exists.
 */
export async function setSaved(client, userId, identity, active, schema) {
  if (active) {
    await client.query(
      `INSERT INTO "${schema}".saved_moments(user_id, moment_owner_id, moment_id)
       VALUES ($1, $2, $3) ON CONFLICT (user_id, moment_owner_id, moment_id) DO NOTHING`,
      [userId, identity.ownerId, identity.id],
    );
  } else {
    await client.query(
      `DELETE FROM "${schema}".saved_moments
       WHERE user_id=$1 AND moment_owner_id=$2 AND moment_id=$3`,
      [userId, identity.ownerId, identity.id],
    );
  }
  const { rows } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM "${schema}".saved_moments
       WHERE user_id=$1 AND moment_owner_id=$2 AND moment_id=$3
     ) AS saved`,
    [userId, identity.ownerId, identity.id],
  );
  return { ownerId: identity.ownerId, id: identity.id, saved: rows[0].saved };
}

/**
 * The caller's saves, newest first, already intersected with moments they can
 * currently read. Only the composite identity and the save timestamp leave the
 * database: the caller already has the content in their own moments list, and
 * returning it here would mean this endpoint could serve content the main
 * feed's authorization path never checked.
 */
export async function listSaved(client, userId, { limit = 40, cursor = null } = {}, schema) {
  const args = [userId];
  let cursorClause = '';
  if (cursor) {
    args.push(cursor.savedAt, cursor.ownerId, cursor.id);
    cursorClause = `AND (s.saved_at, s.moment_owner_id, s.moment_id) < ($2::timestamptz, $3::uuid, $4::text)`;
  }
  args.push(limit + 1);
  const { rows } = await client.query(
    `SELECT s.moment_owner_id, s.moment_id, s.saved_at
     FROM "${schema}".saved_moments s
     WHERE s.user_id = $1
       AND (
         s.moment_owner_id = $1
         OR EXISTS (
           SELECT 1 FROM "${schema}".track_collaborators c
           WHERE c.owner_id = s.moment_owner_id AND c.track_id = (
             SELECT m.event_id FROM "${schema}".moments m
             WHERE m.owner_id = s.moment_owner_id AND m.id = s.moment_id
           )
           AND c.recipient_id = $1 AND c.accepted_at IS NOT NULL AND c.revoked_at IS NULL
         )
       )
       AND EXISTS (
         SELECT 1 FROM "${schema}".moments m
         WHERE m.owner_id = s.moment_owner_id AND m.id = s.moment_id
       )
       ${cursorClause}
     ORDER BY s.saved_at DESC, s.moment_owner_id DESC, s.moment_id DESC
     LIMIT $${args.length}`,
    args,
  );
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map(row => ({
      ownerId: row.moment_owner_id,
      id: row.moment_id,
      savedAt: row.saved_at,
    })),
    nextCursor: hasMore && last
      ? Buffer.from(JSON.stringify({ savedAt: last.saved_at, ownerId: last.moment_owner_id, id: last.moment_id })).toString('base64url')
      : null,
  };
}

/**
 * Saved count, intersected the same way as the list so the number the user
 * sees can never exceed what the list would actually return.
 */
export async function savedCount(client, userId, schema) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM "${schema}".saved_moments s
     WHERE s.user_id = $1
       AND EXISTS (
         SELECT 1 FROM "${schema}".moments m
         WHERE m.owner_id = s.moment_owner_id AND m.id = s.moment_id
           AND (
             m.owner_id = $1
             OR EXISTS (
               SELECT 1 FROM "${schema}".track_collaborators c
               WHERE c.owner_id = m.owner_id AND c.track_id = m.event_id
                 AND c.recipient_id = $1 AND c.accepted_at IS NOT NULL AND c.revoked_at IS NULL
             )
           )
       )`,
    [userId],
  );
  return rows[0].count;
}

/**
 * Every saved composite identity for the caller, so the list and detail views
 * can render the pressed state without a request per card.
 */
export async function savedIdentities(client, userId, schema) {
  const { rows } = await client.query(
    `SELECT s.moment_owner_id, s.moment_id
     FROM "${schema}".saved_moments s
     WHERE s.user_id = $1
       AND EXISTS (
         SELECT 1 FROM "${schema}".moments m
         WHERE m.owner_id = s.moment_owner_id AND m.id = s.moment_id
           AND (
             m.owner_id = $1
             OR EXISTS (
               SELECT 1 FROM "${schema}".track_collaborators c
               WHERE c.owner_id = m.owner_id AND c.track_id = m.event_id
                 AND c.recipient_id = $1 AND c.accepted_at IS NOT NULL AND c.revoked_at IS NULL
             )
           )
       )`,
    [userId],
  );
  return rows.map(row => savedKey(row.moment_owner_id, row.moment_id));
}

/** Validate a wire cursor; a malformed or foreign cursor is a 400, never a guess. */
export function decodeSavedCursor(raw) {
  if (raw == null || raw === '') return null;
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed.savedAt !== 'string' || Number.isNaN(Date.parse(parsed.savedAt))
    || typeof parsed.ownerId !== 'string' || typeof parsed.id !== 'string') return undefined;
  return { savedAt: parsed.savedAt, ownerId: parsed.ownerId, id: parsed.id };
}
