import { ApiError } from './mutation-safety.mjs';
import { createHmac, timingSafeEqual } from 'node:crypto';

function tokenFor(userId, fingerprint, secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('Export signing secret must have at least 32 characters');
  return createHmac('sha256', secret).update(JSON.stringify(['memento-export-v1', userId, fingerprint])).digest('hex');
}
function verifyToken(userId, fingerprint, token, secret) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw fail('Signed export token required');
  const expected = tokenFor(userId, fingerprint, secret);
  if (!timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'))) throw fail('Invalid export token');
}

export const EXPORT_PAGE_LIMIT = 200;
const kinds = new Set(['moments', 'tracks', 'tags', 'perspectives']);
const fail = message => new ApiError(400, message);

// One statement defines BOTH the fingerprint and the returned page. No exported
// collection is retained by Node, and no transaction survives an HTTP request.
// Page fingerprints prevent a transient change/revert from leaking a mixed page.
export function exportSnapshotSQL(qschema) {
  if (!['"memento_dev"', '"memento"', 'pg_temp'].includes(qschema)) throw new Error('Invalid export schema');
  return `WITH
  tracks AS MATERIALIZED (
    SELECT t.*, CASE WHEN t.owner_id=$1 THEN 'owner' ELSE c.role END AS access_role,
      CASE WHEN t.owner_id=$1 THEN EXISTS(SELECT 1 FROM ${qschema}.track_collaborators x WHERE x.owner_id=t.owner_id AND x.track_id=t.id AND x.revoked_at IS NULL) ELSE false END AS shared
    FROM ${qschema}.tracks t LEFT JOIN ${qschema}.track_collaborators c
      ON c.owner_id=t.owner_id AND c.track_id=t.id AND c.recipient_id=$1 AND c.accepted_at IS NOT NULL AND c.revoked_at IS NULL
    WHERE t.owner_id=$1 OR c.recipient_id=$1
  ), moments AS MATERIALIZED (
    SELECT m.* FROM ${qschema}.moments m WHERE m.owner_id=$1 OR EXISTS (
      SELECT 1 FROM tracks t WHERE t.owner_id=m.owner_id AND t.id=m.event_id)
  ), entries AS MATERIALIZED (
    SELECT 'tracks'::text AS kind,jsonb_build_array(t.owner_id,t.id)::text AS key,
      t.document || jsonb_build_object('resourceOwnerId',t.owner_id,'accessRole',t.access_role,'sharedByYou',t.shared) AS payload,
      jsonb_build_array(t.owner_id,t.id,t.access_role,t.shared,t.document) AS proof FROM tracks t
    UNION ALL
    SELECT 'moments',jsonb_build_array(m.owner_id,m.id)::text,
      jsonb_build_object('document',m.document,'ownerId',m.owner_id,'version',m.version,'images',im.ids),
      jsonb_build_array(m.owner_id,m.id,m.event_id,m.document,m.version,im.metadata)
    FROM moments m CROSS JOIN LATERAL (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id) ORDER BY i.created_at,i.id),'[]'::jsonb) AS ids,
        coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.created_at,i.id),'[]'::jsonb) AS metadata
      FROM ${qschema}.images i WHERE i.owner_id=m.owner_id AND i.moment_id=m.id
    ) im
    UNION ALL
    SELECT 'tags',to_jsonb(name)::text,to_jsonb(name),to_jsonb(name) FROM (
      SELECT name FROM ${qschema}.tags WHERE owner_id=$1
      UNION SELECT jsonb_array_elements_text(t.document->'tags') FROM tracks t WHERE t.owner_id<>$1
      UNION SELECT jsonb_array_elements_text(m.document->'tags') FROM moments m WHERE m.owner_id<>$1
    ) tags
    UNION ALL
    SELECT 'perspectives',p.id::text,
      jsonb_build_object('id',p.id,'momentOwnerId',p.moment_owner_id,'momentId',p.moment_id,'authorId',p.author_id,
        'username',u.username,'kind',p.kind,'body',p.body,'version',p.version,'createdAt',p.created_at,'updatedAt',p.updated_at),
      jsonb_build_array(to_jsonb(p),u.username)
    FROM ${qschema}.moment_perspectives p JOIN moments m ON m.owner_id=p.moment_owner_id AND m.id=p.moment_id
      JOIN ${qschema}.users u ON u.id=p.author_id WHERE p.moment_owner_id=$1
  ), fingerprint AS (
    SELECT encode(sha256(convert_to($1::text || ':' || coalesce(string_agg(
      encode(sha256(convert_to(jsonb_build_array(kind,key,payload,proof)::text,'UTF8')),'hex'),'' ORDER BY kind COLLATE "C",key COLLATE "C"),''),'UTF8')),'hex') AS fingerprint,
      jsonb_build_object('moments',count(*) FILTER(WHERE kind='moments'),'tracks',count(*) FILTER(WHERE kind='tracks'),
        'tags',count(*) FILTER(WHERE kind='tags'),'perspectives',count(*) FILTER(WHERE kind='perspectives')) AS counts
    FROM entries
  ), page AS (
    SELECT key,payload FROM entries WHERE kind=$2 AND ($3::text IS NULL OR key COLLATE "C">$3 COLLATE "C")
    ORDER BY key COLLATE "C" LIMIT $4
  ) SELECT f.*,coalesce((SELECT jsonb_agg(jsonb_build_object('key',key,'value',payload) ORDER BY key COLLATE "C") FROM page),'[]'::jsonb) AS items
    FROM fingerprint f`;
}

/** Inputs are consistency assertions, never authorization credentials. */
export async function readExportSnapshot(pool, userId, input = {}, qschema, { safeMoment, signingSecret = process.env.SESSION_SECRET } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Invalid export body');
  if (Object.keys(input).some(key => !['action','fingerprint','token','kind','limit','cursor'].includes(key))) throw fail('Unexpected export input');
  const action = input.action ?? 'start';
  if (!['start', 'page', 'finalize'].includes(action)) throw fail('Invalid export action');
  if (action !== 'start' && !/^[a-f0-9]{64}$/.test(input.fingerprint ?? '')) throw fail('Export fingerprint required');
  const kind = input.kind ?? 'moments';
  if (!kinds.has(kind)) throw fail('Invalid export component');
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > EXPORT_PAGE_LIMIT) throw fail('Invalid export page limit');
  let after = null;
  if (input.cursor != null) {
    if (typeof input.cursor !== 'string' || input.cursor.length > 4096) throw fail('Invalid export cursor');
    let cursor;
    try { cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString()); } catch { throw fail('Invalid export cursor'); }
    if (cursor.userId !== userId || cursor.kind !== kind || cursor.fingerprint !== input.fingerprint || typeof cursor.key !== 'string') throw fail('Export cursor scope changed');
    after = cursor.key;
  }
  if (action !== 'start') verifyToken(userId, input.fingerprint, input.token, signingSecret);
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows: [row] } = await client.query(exportSnapshotSQL(qschema), [userId, action === 'page' ? kind : null, after, action === 'page' ? limit + 1 : 0]);
    if (action !== 'start' && row.fingerprint !== input.fingerprint) throw new ApiError(409, 'Export scope changed; restart export', { code: 'EXPORT_SCOPE_CHANGED' });
    await client.query('COMMIT');
    const result = { fingerprint: row.fingerprint, token: tokenFor(userId, row.fingerprint, signingSecret), counts: row.counts };
    if (action === 'finalize') return { ...result, complete: true };
    if (action === 'start') return { ...result, scope: 'all-authorized-moments;owned-perspectives', images: 'references-to-stored-images-only' };
    const page = row.items.slice(0, limit);
    const items = page.map(({ value }) => {
      if (kind !== 'moments') return value;
      if (typeof safeMoment !== 'function') throw new Error('safeMoment helper required');
      const moment = safeMoment(value.document, value.images, [], value.version, value.ownerId);
      // Reactions are not backup content and intentionally not fingerprinted.
      delete moment.reactions;
      return moment;
    });
    return { ...result, items, nextCursor: row.items.length > limit ? Buffer.from(JSON.stringify({ userId, kind, fingerprint: row.fingerprint, key: page.at(-1).key })).toString('base64url') : null };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

/** Integration:
 * import { mountExportSnapshotRoutes } from './export-snapshot.mjs';
 * mountExportSnapshotRoutes(app, { auth, pool, qschema, safeMoment });
 * Mount after same-origin/JSON middleware, before the error handler, using
 * the real session-auth middleware (not a cached account assertion).
 * Client: POST start {}, retain {fingerprint,token,counts}; for EACH kind in
 * moments/tracks/tags/perspectives POST page {fingerprint,token,kind,cursor,limit},
 * accumulating items until nextCursor=null. Reject duplicate composite moment
 * identities and counts different from start. POST finalize {fingerprint,token}
 * only AFTER all pages resolve; write the Blob only on complete:true and with
 * an unchanged client auth generation. Use ONLY these fresh component pages,
 * never UI-cached tracks/tags or the legacy perspective exporter. Any 409,
 * auth/error/cancel discards the complete attempt. Restart from start, not
 * from a failed cursor. Photos remain authenticated references, not bytes.
 * Every page recomputes the SAME full-scope fingerprint in its own statement;
 * this deliberately trades database work for bounded Node memory and rejects
 * transient changes even if they revert before finalization. There is no
 * retained session, timeout cleanup job, migration or cross-request MVCC lease.
 * Endpoints use POST and no-store; cursors/fingerprints never grant access.
 */
export function mountExportSnapshotRoutes(app, dependencies) {
  for (const action of ['start', 'page', 'finalize']) {
    app.post(`/api/export/${action}`, dependencies.auth, async (req, res, next) => {
      try {
        res.set('Cache-Control', 'no-store').json(await readExportSnapshot(dependencies.pool, req.user.id,
          { ...req.body, action }, dependencies.qschema, dependencies));
      } catch (error) { next(error); }
    });
  }
}
