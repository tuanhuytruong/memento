// Visit state is private to the visitor: one latest timestamp per (user, track).
// It never stores search phrases, reflection drafts or inferred emotions, and it is
// never exposed to the track owner or collaborators.
export async function listVisitState(client, userId, schema) {
  const { rows } = await client.query(`
    SELECT v.track_owner_id, v.track_id, v.last_opened_at
    FROM "${schema}".track_visit_state v
    WHERE v.user_id = $1
      AND (
        v.track_owner_id = $1
        OR EXISTS (
          SELECT 1 FROM "${schema}".track_collaborators c
          WHERE c.owner_id = v.track_owner_id AND c.track_id = v.track_id
            AND c.recipient_id = $1 AND c.accepted_at IS NOT NULL AND c.revoked_at IS NULL
        )
      )
    ORDER BY v.last_opened_at DESC, v.track_owner_id, v.track_id`, [userId]);
  return rows.map(row => ({
    trackOwnerId: row.track_owner_id,
    trackId: row.track_id,
    lastOpenedAt: row.last_opened_at,
  }));
}

// Single latest timestamp only; never an append-only event log.
export async function recordVisit(client, userId, identity, schema) {
  const { rows } = await client.query(`
    INSERT INTO "${schema}".track_visit_state(user_id, track_owner_id, track_id, last_opened_at)
    VALUES ($1, $2, $3, now())
    ON CONFLICT (user_id, track_owner_id, track_id)
    DO UPDATE SET last_opened_at = GREATEST("${schema}".track_visit_state.last_opened_at, EXCLUDED.last_opened_at)
    RETURNING last_opened_at`, [userId, identity.ownerId, identity.id]);
  return { trackOwnerId: identity.ownerId, trackId: identity.id, lastOpenedAt: rows[0].last_opened_at };
}
