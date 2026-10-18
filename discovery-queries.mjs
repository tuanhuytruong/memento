import { ApiError } from './mutation-safety.mjs';
import { foldNeedle, sqlFold } from './moment-queries.mjs';

export const INTENT_EMOTIONS = {
  surprise: [], comfort: ['serene', 'grateful', 'nostalgic'],
  courage: ['challenged', 'proud', 'focused'], spark: ['inspired', 'excited'],
  reflection: ['reflective', 'nostalgic', 'grateful'], celebration: ['joyful', 'proud', 'excited'],
};
export function validateBlindbox(input = {}) {
  const intent = input.intent ?? 'surprise';
  if (!Object.hasOwn(INTENT_EMOTIONS, intent)) throw new ApiError(400, 'Unknown Blindbox intent');
  if (typeof (input.query ?? '') !== 'string' || (input.query ?? '').length > 120) throw new ApiError(400, 'query must be at most 120 characters');
  return { intent, words: foldNeedle(input.query ?? '').split(/\s+/).filter(w => w.length >= 2).slice(0, 12) };
}
async function enrich(client, rows, schema, safeMoment) {
  if (!rows.length) return [];
  const images = await client.query(`SELECT owner_id,moment_id,id FROM ${schema}.images WHERE (owner_id,moment_id) IN (SELECT * FROM unnest($1::uuid[],$2::text[])) ORDER BY created_at,id`, [rows.map(r => r.owner_id), rows.map(r => r.id)]);
  return rows.map(r => safeMoment(r.document, images.rows.filter(i => i.owner_id === r.owner_id && i.moment_id === r.id), [], r.version, r.owner_id));
}
// A single statement ranks the entire freshly authorized scope. Only the winner
// crosses the SQL boundary; images are fetched for that one identity, never an album.
export async function queryBlindbox(client, userId, input, schema, { safeMoment }) {
  const { intent, words } = validateBlindbox(input);
  const corpus = sqlFold(`concat_ws(' ',m.document->>'title',m.document->>'description',m.document->>'idea', (SELECT string_agg(value,' ') FROM jsonb_array_elements_text(coalesce(m.document->'tags','[]'::jsonb))),m.document->'location'->>'name',m.document->'location'->>'city',t.document->>'title')`);
  const { rows } = await client.query(`WITH scored AS (
    SELECT m.owner_id,m.id,m.document,m.version,
      (CASE WHEN m.document->>'emotion'=ANY($2::text[]) THEN 3 ELSE 0 END +
       2*(SELECT count(*) FROM unnest($3::text[]) word WHERE strpos(${corpus},word)>0)) AS score
    FROM ${schema}.moments m
    LEFT JOIN ${schema}.tracks t ON t.owner_id=m.owner_id AND t.id=m.event_id
    WHERE m.owner_id=$1 OR EXISTS (SELECT 1 FROM ${schema}.track_collaborators c
      WHERE c.owner_id=m.owner_id AND c.track_id=m.event_id AND c.recipient_id=$1
      AND c.accepted_at IS NOT NULL AND c.revoked_at IS NULL)
  ) SELECT * FROM scored ORDER BY score DESC,random() LIMIT 1`, [userId, INTENT_EMOTIONS[intent], words]);
  const [event] = await enrich(client, rows, schema, safeMoment);
  return event ? { event, fallback: Number(rows[0].score) === 0 && (intent !== 'surprise' || words.length > 0) } : null;
}

export function validatePostcardPicker(input = {}, userId) {
  const trackKey = input.trackKey;
  if (typeof trackKey !== 'string' || !trackKey.startsWith(`${userId}:`) || trackKey.length > 300 || trackKey.length <= userId.length + 1) throw new ApiError(400, 'Choose an owned track');
  const search = input.search ?? '';
  if (typeof search !== 'string' || search.length > 120) throw new ApiError(400, 'search must be at most 120 characters');
  const limit = input.limit ?? 40;
  if (!Number.isInteger(limit) || limit < 1 || limit > 40) throw new ApiError(400, 'limit must be between 1 and 40');
  let cursor = null;
  const scope = JSON.stringify([userId, trackKey, search]);
  if (input.cursor != null) {
    try { cursor = JSON.parse(Buffer.from(String(input.cursor), 'base64url').toString()); } catch { throw new ApiError(400, 'Invalid picker cursor'); }
    if (!cursor || cursor.scope !== scope || typeof cursor.date !== 'string' || typeof cursor.id !== 'string') throw new ApiError(400, 'Invalid picker cursor');
  }
  return { trackId: trackKey.slice(userId.length + 1), search: foldNeedle(search), limit, cursor, scope };
}
export async function queryPostcardPicker(client, userId, input, schema, { safeMoment }) {
  const { trackId, search, limit, cursor, scope } = validatePostcardPicker(input, userId);
  // owner_id is fixed by authenticated identity, not any caller-provided scope.
  const { rows } = await client.query(`SELECT m.owner_id,m.id,m.document,m.version,coalesce(m.document->>'date','') AS sort_date
    FROM ${schema}.moments m WHERE m.owner_id=$1 AND m.event_id=$2
      AND ($3='' OR strpos(${sqlFold(`concat_ws(' ',m.document->>'title',m.document->>'description',m.document->>'idea',m.document->'location'->>'name',m.document->'location'->>'city')`)},$3)>0)
      AND ($4::text IS NULL OR (coalesce(m.document->>'date',''),m.id)>($4,$5))
    ORDER BY coalesce(m.document->>'date',''),m.id LIMIT $6`, [userId, trackId, search, cursor?.date ?? null, cursor?.id ?? null, limit + 1]);
  const page = rows.slice(0, limit), last = page.at(-1);
  return { moments: await enrich(client, page, schema, safeMoment), nextCursor: rows.length > limit ? Buffer.from(JSON.stringify({ scope, date: last.sort_date, id: last.id })).toString('base64url') : null };
}
