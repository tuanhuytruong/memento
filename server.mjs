import dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_FILE || '.env.local', quiet: true });
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { pool, qschema, hashInvite, hashSession, id } from './memento-db.mjs';
import { asyncHandler, ApiError, transaction, authorizedMutation, expectedVersion } from './mutation-safety.mjs';
import { cleanupQueue, imageKeys, startCleanup } from './object-cleanup.mjs';
import { createImageDelivery } from './image-delivery.mjs';
import { invalidateImageObject } from './image-cache.mjs';
import { createRequestBudgets } from './request-budgets.mjs';
import { makeImageVariants, resolveVariant, VARIANT_CACHE_CONTROL } from './image-variants.mjs';

const app = express();
// Express 4 does not catch rejected async handlers (including pool acquisition).
for (const method of ['get','post','put','delete','patch']) {
  const register = app[method].bind(app);
  app[method] = (route, ...handlers) => register(route, ...handlers.map(fn => fn?.constructor?.name === 'AsyncFunction' ? asyncHandler(fn) : fn));
}
const PORT = Number(process.env.API_PORT || 3092);
const SESSION_DAYS = 14;
const MAX_IMAGE = 10 * 1024 * 1024;
const DB_SCHEMA = process.env.DB_SCHEMA;
if (DB_SCHEMA !== 'memento' && DB_SCHEMA !== 'memento_dev') {
  throw new Error('DB_SCHEMA must be either memento or memento_dev');
}
const R2_PREFIX = process.env.R2_PREFIX || `${DB_SCHEMA}/`;
if (R2_PREFIX !== `${DB_SCHEMA}/`) {
  throw new Error(`R2_PREFIX must be exactly ${DB_SCHEMA}/ for this deployment`);
}
for (const key of ['DATABASE_URL', 'SESSION_SECRET', 'INVITE_ADMIN_SECRET', 'R2_BUCKET', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
}
if (process.env.SESSION_SECRET.length < 32 || process.env.INVITE_ADMIN_SECRET.length < 32) throw new Error('Configured application secrets must be at least 32 characters');
const s3 = new S3Client({ region: 'auto', endpoint: process.env.R2_ENDPOINT, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
export const cleanup = cleanupQueue({ pool, qschema, prefix: R2_PREFIX, remove: key => { invalidateImageObject(key); return s3.send(new DeleteObjectCommand({Bucket:process.env.R2_BUCKET,Key:key}),{abortSignal:AbortSignal.timeout(30_000)}); } });
const mutate = (req, access, resourceId, work) => authorizedMutation({pool,schema:DB_SCHEMA,userId:req.user.id,resourceId,access,work});
const ownerWrite = (req, work) => transaction(pool,work,req.user.id,DB_SCHEMA);
const requireEditor = access => { if (!isEditor(access)) throw new ApiError(403,'Editor access required'); };
const COOKIE = 'memento_session';
const budgets = createRequestBudgets();
const imageDelivery = createImageDelivery({
  enabled: process.env.IMAGE_CACHE_ENABLED !== 'false',
  fetchObject: async (metadata, { signal }) => {
    const object = await s3.send(new GetObjectCommand({Bucket:process.env.R2_BUCKET,Key:metadata.key}),{abortSignal:signal});
    return {body:object.Body,contentLength:object.ContentLength};
  },
});
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
// Keep liveness independent of database, authentication and R2 availability.
app.get('/health', (_req, res) => res.status(200).json({ ok: true, service: 'memento-api' }));
app.use(express.json({ limit: '1mb', strict: true }));
app.use('/api', budgets.abuse);
app.use('/api/auth', budgets.auth);
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.path.startsWith('/api/')) {
    const origin = req.get('origin');
    const host = req.get('host');
    let parsedOrigin;
    try { parsedOrigin = new URL(origin || ''); } catch { parsedOrigin = null; }
    if (!parsedOrigin || !['https:', 'http:'].includes(parsedOrigin.protocol) || parsedOrigin.origin === 'null' || parsedOrigin.host !== host || parsedOrigin.protocol !== `${req.protocol}:`) return res.status(403).json({ error: 'Origin rejected' });
  }
  next();
});
const userShape = row => ({ id: row.id, username: row.username });
const clearCookie = res => res.clearCookie(COOKIE, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
const setCookie = (res, token) => res.cookie(COOKIE, token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: SESSION_DAYS * 86400000 });
async function authenticate(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE] || parseCookie(req.get('cookie'))[COOKIE];
    if (!token || token.length > 128) return res.status(401).json({ error: 'Authentication required' });
    const { rows } = await pool.query(`SELECT u.id, u.username FROM ${qschema}.sessions s JOIN ${qschema}.users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at > now()`, [hashSession(token)]);
    if (!rows[0]) return res.status(401).json({ error: 'Authentication required' });
    req.user = rows[0]; budgets.account(req,res,next);
  } catch (e) { next(e); }
}
function parseCookie(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const item = part.trim();
    if (!item) continue;
    const split = item.indexOf('=');
    if (split <= 0) continue;
    try { out[item.slice(0, split)] = decodeURIComponent(item.slice(split + 1)); } catch { /* malformed cookie is ignored */ }
  }
  return out;
}
const auth = (req, res, next) => authenticate(req, res, next);
const usernameValid = x => typeof x === 'string' && /^[a-zA-Z0-9_.-]{3,32}$/.test(x);
const passwordValid = x => typeof x === 'string' && x.length >= 12 && x.length <= 128;
const fail = (res, status, error) => res.status(status).json({ error });
async function persistTags(ownerId, tags, client = pool) {
  for (const tag of tags || []) await client.query(`INSERT INTO ${qschema}.tags(owner_id,name) VALUES($1,$2) ON CONFLICT DO NOTHING`, [ownerId, tag]);
}

async function issueSession(user, res) {
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query(`INSERT INTO ${qschema}.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+($3 * interval '1 day'))`, [hashSession(token), user.id, SESSION_DAYS]);
  setCookie(res, token);
  return res.json({ user: userShape(user) });
}
app.post('/api/auth/register', async (req, res, next) => {
  const { username, password, inviteCode } = req.body || {};
  if (!usernameValid(username) || !passwordValid(password) || typeof inviteCode !== 'string' || inviteCode.length > 256) return fail(res, 400, 'Invalid registration details');
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const invite = await client.query(`SELECT code_hash FROM ${qschema}.invites WHERE code_hash=$1 AND consumed_at IS NULL AND expires_at > now() FOR UPDATE`, [hashInvite(inviteCode)]);
    if (!invite.rowCount) { await client.query('ROLLBACK'); return fail(res, 400, 'Invalid or used invite code'); }
    const passwordHash = await bcrypt.hash(password, 12);
    const uid = id();
    const created = await client.query(`INSERT INTO ${qschema}.users(id,username,password_hash) VALUES($1,$2,$3) ON CONFLICT(username) DO NOTHING RETURNING id,username`, [uid, username, passwordHash]);
    if (!created.rowCount) { await client.query('ROLLBACK'); return fail(res, 409, 'Username unavailable'); }
    await client.query(`UPDATE ${qschema}.invites SET consumed_at=now(), consumed_by=$2 WHERE code_hash=$1`, [invite.rows[0].code_hash, uid]);
    await client.query('COMMIT');
    return await issueSession(created.rows[0], res);
  } catch (e) { await client?.query('ROLLBACK').catch(()=>{}); next(e); }
  finally { client?.release(); }
});
app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!usernameValid(username) || typeof password !== 'string' || password.length > 128) return fail(res, 400, 'Invalid login details');
    const { rows } = await pool.query(`SELECT id,username,password_hash FROM ${qschema}.users WHERE username=$1`, [username]);
    const user = rows[0];
    const verified = user ? await bcrypt.compare(password, user.password_hash) : (await bcrypt.hash(password, 12), false);
    if (!user || !verified) return fail(res, 401, 'Invalid username or password');
    return await issueSession(user, res);
  } catch (e) { next(e); }
});
app.get('/api/auth/me', auth, (req, res) => res.json({ user: userShape(req.user) }));
app.get('/api/users/search', auth, async (req, res, next) => { try {
  const q = req.query.q;
  if (typeof q !== 'string' || !/^[a-zA-Z0-9_.-]{1,32}$/.test(q)) return fail(res, 400, 'Invalid username query');
  const { rows } = await pool.query(`SELECT username FROM ${qschema}.users WHERE id <> $1 AND starts_with(lower(username), lower($2)) ORDER BY lower(username), username LIMIT 3`, [req.user.id, q]);
  res.json({ usernames: rows.map(row => row.username) });
} catch (e) { next(e); } });
app.post('/api/auth/logout', auth, async (req, res, next) => {
  try { const token = parseCookie(req.get('cookie'))[COOKIE]; await pool.query(`DELETE FROM ${qschema}.sessions WHERE token_hash=$1`, [hashSession(token)]); clearCookie(res); res.json({ ok: true }); }
  catch (e) { next(e); }
});

export function validateDocument(input, kind) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const d = { ...input };
  delete d.ownerId; delete d.owner_id; delete d.objectKey; delete d.object_key;
  if (kind === 'track') {
    if (typeof d.title !== 'string' || !d.title.trim() || d.title.length > 200 || typeof (d.description ?? '') !== 'string' || !Array.isArray(d.tags ?? []) || (d.tags ?? []).length > 100 || !(d.tags ?? []).every(t => typeof t === 'string' && t.trim().length > 0 && t.length <= 64)) return null;
    d.description ??= ''; d.tags ??= []; d.createdAt ??= new Date().toISOString(); d.updatedAt = new Date().toISOString();
  } else {
    if (typeof d.eventId !== 'string' || d.eventId.length > 128 || typeof d.date !== 'string' || !(/^\d{4}-\d{2}-\d{2}$/.test(d.date) || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(d.date)) || !Array.isArray(d.images ?? []) || !Array.isArray(d.tags ?? []) || (d.tags ?? []).length > 100 || !(d.tags ?? []).every(t => typeof t === 'string' && t.trim().length > 0 && t.length <= 64) || typeof (d.title ?? '') !== 'string' || (d.title ?? '').length > 200 || typeof (d.description ?? '') !== 'string' || (d.description ?? '').length > 10000) return null;
    const isDate = /^\d{4}-\d{2}-\d{2}$/.test(d.date);
    const isTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(d.date);
    if (!isDate && !isTimestamp) return null;
    const literalDate = d.date.slice(0, 10);
    const calendarDate = new Date(`${literalDate}T00:00:00Z`);
    if (Number.isNaN(calendarDate.getTime()) || calendarDate.toISOString().slice(0,10) !== literalDate) return null;
    const date = new Date(isDate ? `${d.date}T00:00:00Z` : d.date);
    if (Number.isNaN(date.getTime())) return null;
    if (d.time != null && (typeof d.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.time))) return null;
    d.title ??= ''; d.description ??= ''; d.images ??= []; d.tags ??= []; d.createdAt ??= new Date().toISOString(); d.updatedAt = new Date().toISOString();
  }
  return d;
}
function safeMoment(doc, imageRows, reactions = [], version) {
  return { ...doc, version, images: imageRows.map(x => `/api/images/${x.id}`), reactions };
}
const REACTION_EMOJIS = new Set(['❤️', '🥹', '😂', '✨', '🙌', '🎉']);
async function reactionSummaries(userId, moments, client = pool) {
  if (!moments.length) return new Map();
  const owners = moments.map(moment => moment.owner_id);
  const ids = moments.map(moment => moment.id);
  const { rows } = await client.query(`
    SELECT r.moment_owner_id,r.moment_id,r.emoji,COUNT(*)::int AS count,
      BOOL_OR(r.user_id=$1) AS selected, ARRAY_AGG(u.username ORDER BY u.username) AS usernames
    FROM ${qschema}.moment_reactions r JOIN ${qschema}.users u ON u.id=r.user_id
    WHERE (r.moment_owner_id,r.moment_id) IN (SELECT * FROM unnest($2::uuid[],$3::text[]))
    GROUP BY r.moment_owner_id,r.moment_id,r.emoji ORDER BY r.moment_owner_id,r.moment_id,r.emoji`, [userId, owners, ids]);
  const summaries = new Map();
  for (const row of rows) { const key = `${row.moment_owner_id}:${row.moment_id}`; const summary = summaries.get(key) || []; summary.push({ emoji: row.emoji, count: row.count, selected: row.selected, usernames: row.usernames }); summaries.set(key, summary); }
  return summaries;
}

async function trackAccess(userId, trackId, client = pool) {
  const { rows } = await client.query(`
    SELECT t.owner_id,t.id,t.document,'owner'::text AS role
    FROM ${qschema}.tracks t WHERE t.owner_id=$1 AND t.id=$2
    UNION ALL
    SELECT t.owner_id,t.id,t.document,c.role
    FROM ${qschema}.track_collaborators c
    JOIN ${qschema}.tracks t ON t.owner_id=c.owner_id AND t.id=c.track_id
    WHERE c.recipient_id=$1 AND c.track_id=$2 AND c.accepted_at IS NOT NULL
      AND c.revoked_at IS NULL`, [userId, trackId]);
  return rows[0] || null;
}
async function momentAccess(userId, momentId, client = pool) {
  const { rows } = await client.query(`
    SELECT m.owner_id,m.id,m.event_id,m.document,m.version,'owner'::text AS role
    FROM ${qschema}.moments m WHERE m.owner_id=$1 AND m.id=$2
    UNION ALL
    SELECT m.owner_id,m.id,m.event_id,m.document,m.version,c.role
    FROM ${qschema}.moments m
    JOIN ${qschema}.track_collaborators c ON c.owner_id=m.owner_id AND c.track_id=m.event_id
    WHERE m.id=$2 AND c.recipient_id=$1 AND c.accepted_at IS NOT NULL
      AND c.revoked_at IS NULL`, [userId, momentId]);
  return rows[0] || null;
}
async function imageAccess(userId, imageId, client = pool) {
  const { rows } = await client.query(`
    SELECT i.id,i.moment_id,i.object_key,i.content_type,i.size,i.thumb_object_key,i.display_object_key,i.thumb_size,i.display_size,m.owner_id,m.event_id,'owner'::text AS role
    FROM ${qschema}.images i JOIN ${qschema}.moments m ON m.owner_id=i.owner_id AND m.id=i.moment_id
    WHERE i.id=$2 AND i.owner_id=$1
    UNION ALL
    SELECT i.id,i.moment_id,i.object_key,i.content_type,i.size,i.thumb_object_key,i.display_object_key,i.thumb_size,i.display_size,m.owner_id,m.event_id,c.role
    FROM ${qschema}.images i JOIN ${qschema}.moments m ON m.owner_id=i.owner_id AND m.id=i.moment_id
    JOIN ${qschema}.track_collaborators c ON c.owner_id=m.owner_id AND c.track_id=m.event_id
    WHERE i.id=$2 AND c.recipient_id=$1 AND c.accepted_at IS NOT NULL
      AND c.revoked_at IS NULL`, [userId, imageId]);
  return rows[0] || null;
}
const isEditor = access => access?.role === 'owner' || access?.role === 'editor';

app.get('/api/tracks', auth, async (req,res,next) => { try {
  const {rows}=await pool.query(`
    SELECT t.document,'owner'::text AS role, EXISTS(SELECT 1 FROM ${qschema}.track_collaborators c WHERE c.owner_id=t.owner_id AND c.track_id=t.id AND c.revoked_at IS NULL) AS shared_by_owner
    FROM ${qschema}.tracks t WHERE t.owner_id=$1
    UNION ALL
    SELECT t.document,c.role,false AS shared_by_owner FROM ${qschema}.track_collaborators c JOIN ${qschema}.tracks t ON t.owner_id=c.owner_id AND t.id=c.track_id
    WHERE c.recipient_id=$1 AND c.accepted_at IS NOT NULL AND c.revoked_at IS NULL
`, [req.user.id]);
  res.json({tracks:rows.map(x=>({ ...x.document, accessRole: x.role, sharedByYou: x.shared_by_owner }))});
} catch(e){next(e);} });
app.post('/api/tracks', auth, async (req,res) => {
  const d=validateDocument(req.body,'track'); if(!d) throw new ApiError(400,'Invalid track');
  d.id=typeof d.id==='string'&&d.id.length<128?d.id:id();
  await ownerWrite(req,async c=>{ await c.query(`INSERT INTO ${qschema}.tracks(owner_id,id,document) VALUES($1,$2,$3)`,[req.user.id,d.id,d]); await persistTags(req.user.id,d.tags,c); });
  res.status(201).json({track:{...d,accessRole:'owner'}});
});
app.put('/api/tracks/:id', auth, async (req,res) => {
  const track=await ownerWrite(req,async c=>{
    const old=await c.query(`SELECT document FROM ${qschema}.tracks WHERE owner_id=$1 AND id=$2`,[req.user.id,req.params.id]);
    if(!old.rowCount) throw new ApiError(404,'Track not found');
    const d=validateDocument({...old.rows[0].document,...req.body,id:req.params.id},'track'); if(!d) throw new ApiError(400,'Invalid track');
    await c.query(`UPDATE ${qschema}.tracks SET document=$3,updated_at=now() WHERE owner_id=$1 AND id=$2`,[req.user.id,req.params.id,d]);
    await persistTags(req.user.id,d.tags,c); return d;
  }); res.json({track});
});
app.delete('/api/tracks/:id', auth, async (req,res) => {
  await ownerWrite(req,async c=>{
    const track=await c.query(`SELECT id FROM ${qschema}.tracks WHERE owner_id=$1 AND id=$2`,[req.user.id,req.params.id]);
    if(!track.rowCount) throw new ApiError(404,'Track not found');
    const imgs=await c.query(`SELECT i.* FROM ${qschema}.images i JOIN ${qschema}.moments m ON m.owner_id=i.owner_id AND m.id=i.moment_id WHERE i.owner_id=$1 AND m.event_id=$2`,[req.user.id,req.params.id]);
    await cleanup.enqueue(c,imageKeys(imgs.rows));
    await c.query(`DELETE FROM ${qschema}.tracks WHERE owner_id=$1 AND id=$2`,[req.user.id,req.params.id]);
  }); res.json({ok:true});
});

// Collaboration invitations are deliberately separate from registration invites. Only the owner can create, list, or revoke them.
app.post('/api/tracks/:id/collaborators', auth, async (req,res,next) => { try {
  const {username,role}=req.body||{};
  if(!usernameValid(username)||!['viewer','editor'].includes(role)) return fail(res,400,'Invalid collaborator');
  const recipient=await pool.query(`SELECT id,username FROM ${qschema}.users WHERE username=$1`,[username]);
  if(!recipient.rowCount) return fail(res,404,'User not found');
  if(recipient.rows[0].id===req.user.id) return fail(res,400,'Cannot invite the track owner');
  const inserted=await ownerWrite(req,c=>c.query(`INSERT INTO ${qschema}.track_collaborators(id,owner_id,track_id,recipient_id,role,expires_at)
    SELECT $1,t.owner_id,t.id,$2,$3,now() + interval '7 days' FROM ${qschema}.tracks t WHERE t.owner_id=$4 AND t.id=$5
    ON CONFLICT(owner_id,track_id,recipient_id) DO UPDATE SET role=EXCLUDED.role, invited_at=now(), expires_at=EXCLUDED.expires_at, accepted_at=NULL, revoked_at=NULL
    RETURNING id,role,expires_at`,[id(),recipient.rows[0].id,role,req.user.id,req.params.id]));
  if(!inserted.rowCount)return fail(res,404,'Track not found');
  res.status(201).json({collaborator:{...inserted.rows[0],username:recipient.rows[0].username}});
} catch(e){next(e);} });
app.get('/api/tracks/:id/collaborators', auth, async (req,res,next) => { try {
  const {rows}=await pool.query(`SELECT c.id,u.id AS user_id,u.username,c.role,c.invited_at,c.expires_at,c.accepted_at,c.revoked_at FROM ${qschema}.track_collaborators c JOIN ${qschema}.users u ON u.id=c.recipient_id WHERE c.owner_id=$1 AND c.track_id=$2 ORDER BY c.invited_at DESC`,[req.user.id,req.params.id]);
  const exists=await pool.query(`SELECT 1 FROM ${qschema}.tracks WHERE owner_id=$1 AND id=$2`,[req.user.id,req.params.id]); if(!exists.rowCount)return fail(res,404,'Track not found'); res.json({collaborators:rows});
} catch(e){next(e);} });
app.delete('/api/tracks/:id/collaborators/:userId', auth, async (req,res,next) => { try {
  const result=await ownerWrite(req,c=>c.query(`UPDATE ${qschema}.track_collaborators SET revoked_at=now() WHERE owner_id=$1 AND track_id=$2 AND recipient_id=$3 AND revoked_at IS NULL`,[req.user.id,req.params.id,req.params.userId]));
  if(!result.rowCount)return fail(res,404,'Collaborator not found');res.json({ok:true});
} catch(e){next(e);} });
app.get('/api/collaboration-invitations', auth, async (req,res,next) => { try {
  const {rows}=await pool.query(`SELECT c.id,c.role,c.invited_at,c.expires_at,t.document AS track,u.username AS owner_username FROM ${qschema}.track_collaborators c JOIN ${qschema}.tracks t ON t.owner_id=c.owner_id AND t.id=c.track_id JOIN ${qschema}.users u ON u.id=c.owner_id WHERE c.recipient_id=$1 AND c.accepted_at IS NULL AND c.revoked_at IS NULL AND c.expires_at > now() ORDER BY c.invited_at DESC`,[req.user.id]);res.json({invitations:rows});
} catch(e){next(e);} });
app.post('/api/collaboration-invitations/:id/accept', auth, async (req,res,next) => { try {
  const probe=await pool.query(`SELECT owner_id FROM ${qschema}.track_collaborators WHERE id=$1 AND recipient_id=$2`,[req.params.id,req.user.id]);
  if(!probe.rowCount) throw new ApiError(404,'Invitation not found');
  const result=await transaction(pool,c=>c.query(`UPDATE ${qschema}.track_collaborators SET accepted_at=now() WHERE id=$1 AND recipient_id=$2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() RETURNING id,role,accepted_at`,[req.params.id,req.user.id]),probe.rows[0].owner_id,DB_SCHEMA);
  if(!result.rowCount)return fail(res,404,'Invitation not found or expired');res.json({invitation:result.rows[0]});
} catch(e){next(e);} });

app.get('/api/moments', auth, async (req,res,next) => { try {
  const {rows}=await pool.query(`SELECT m.owner_id,m.document,m.id,m.version FROM ${qschema}.moments m WHERE m.owner_id=$1 UNION ALL SELECT m.owner_id,m.document,m.id,m.version FROM ${qschema}.moments m JOIN ${qschema}.track_collaborators c ON c.owner_id=m.owner_id AND c.track_id=m.event_id WHERE c.recipient_id=$1 AND c.accepted_at IS NOT NULL AND c.revoked_at IS NULL`,[req.user.id]);
  const owners=rows.map(row=>row.owner_id), ids=rows.map(row=>row.id);
  const [images,reactions]=await Promise.all([rows.length ? pool.query(`SELECT owner_id,moment_id,id FROM ${qschema}.images WHERE (owner_id,moment_id) IN (SELECT * FROM unnest($1::uuid[],$2::text[])) ORDER BY created_at`,[owners,ids]) : {rows:[]},reactionSummaries(req.user.id,rows)]);
  const imagesByMoment=new Map(); for(const image of images.rows){const key=`${image.owner_id}:${image.moment_id}`;const list=imagesByMoment.get(key)||[];list.push(image);imagesByMoment.set(key,list);}
  res.json({moments:rows.map(row=>safeMoment(row.document,imagesByMoment.get(`${row.owner_id}:${row.id}`)||[],reactions.get(`${row.owner_id}:${row.id}`)||[],row.version))});
} catch(e){next(e);} });
app.get('/api/moments/:id/reactions', auth, async (req,res,next) => { try {
  const moment=await momentAccess(req.user.id,req.params.id);if(!moment)return fail(res,404,'Moment not found'); const reactions=(await reactionSummaries(req.user.id,[moment])).get(`${moment.owner_id}:${moment.id}`)||[]; res.json({reactions,selectedEmojis:reactions.filter(reaction=>reaction.selected).map(reaction=>reaction.emoji)});
} catch(e){next(e);} });
async function writeReaction(req,res) {
  const {emoji,active}=req.body||{};
  if(!REACTION_EMOJIS.has(emoji)|| (req.method==='PUT'&&typeof active!=='boolean')) throw new ApiError(400,'Invalid reaction');
  const reactions=await mutate(req,momentAccess,req.params.id,async(c,m)=>{
    const args=[m.owner_id,m.id,req.user.id,emoji];
    if(req.method==='PUT') {
      if(active) await c.query(`INSERT INTO ${qschema}.moment_reactions(moment_owner_id,moment_id,user_id,emoji) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,args);
      else await c.query(`DELETE FROM ${qschema}.moment_reactions WHERE moment_owner_id=$1 AND moment_id=$2 AND user_id=$3 AND emoji=$4`,args);
    } else {
      // Backwards compatible toggle, serialized. New clients use PUT desired state.
      const removed=await c.query(`DELETE FROM ${qschema}.moment_reactions WHERE moment_owner_id=$1 AND moment_id=$2 AND user_id=$3 AND emoji=$4 RETURNING emoji`,args);
      if(!removed.rowCount) await c.query(`INSERT INTO ${qschema}.moment_reactions(moment_owner_id,moment_id,user_id,emoji) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,args);
    }
    return (await reactionSummaries(req.user.id,[m],c)).get(`${m.owner_id}:${m.id}`)||[];
  });
  res.json({reactions,selectedEmojis:reactions.filter(r=>r.selected).map(r=>r.emoji)});
}
app.put('/api/moments/:id/reactions',auth,asyncHandler(writeReaction));
app.post('/api/moments/:id/reactions',auth,asyncHandler(writeReaction));
app.post('/api/moments', auth, async (req,res) => {
  const d=validateDocument(req.body,'moment'); if(!d) throw new ApiError(400,'Invalid moment');
  if(d.images.length) throw new ApiError(400,'Images must be uploaded using POST /api/images');
  d.id=typeof d.id==='string'&&d.id.length<128?d.id:id(); d.images=[]; delete d.version; delete d.expectedVersion;
  await mutate(req,trackAccess,d.eventId,async(c,a)=>{
    requireEditor(a); await c.query(`INSERT INTO ${qschema}.moments(owner_id,id,event_id,document) VALUES($1,$2,$3,$4)`,[a.owner_id,d.id,d.eventId,d]);
    await persistTags(a.owner_id,d.tags,c);
  }); res.status(201).json({moment:{...d,version:1}});
});
app.put('/api/moments/:id', auth, async (req,res) => {
  const moment=await mutate(req,momentAccess,req.params.id,async(c,old)=>{
    requireEditor(old);
    if(old.role==='editor'&&req.body?.eventId!=null&&req.body.eventId!==old.event_id) throw new ApiError(403,'Editors cannot move a shared moment');
    const expected=expectedVersion(req);
    if(expected!==old.version) throw new ApiError(409,'Moment changed; retain your draft and reload',{code:'VERSION_CONFLICT',currentVersion:old.version});
    const d=validateDocument({...old.document,...req.body,id:old.id,eventId:req.body?.eventId??old.event_id},'moment');
    if(!d) throw new ApiError(400,'Invalid moment');
    if(d.eventId!==old.event_id){const target=await trackAccess(req.user.id,d.eventId,c);if(!target||target.role!=='owner'||target.owner_id!==old.owner_id)throw new ApiError(400,'Owned target track required');}
    const imgs=await c.query(`SELECT id FROM ${qschema}.images WHERE owner_id=$1 AND moment_id=$2 ORDER BY created_at`,[old.owner_id,old.id]);
    d.images=imgs.rows.map(x=>`/api/images/${x.id}`); delete d.version; delete d.expectedVersion;
    await c.query(`UPDATE ${qschema}.moments SET event_id=$3,document=$4,version=version+1,updated_at=now() WHERE owner_id=$1 AND id=$2`,[old.owner_id,old.id,d.eventId,d]);
    await persistTags(old.owner_id,d.tags,c); return {...d,version:old.version+1};
  });res.json({moment});
});
app.delete('/api/moments/:id',auth,async(req,res)=>{
  await mutate(req,momentAccess,req.params.id,async(c,m)=>{
    requireEditor(m);const imgs=await c.query(`SELECT * FROM ${qschema}.images WHERE owner_id=$1 AND moment_id=$2`,[m.owner_id,m.id]);
    await cleanup.enqueue(c,imageKeys(imgs.rows));await c.query(`DELETE FROM ${qschema}.moments WHERE owner_id=$1 AND id=$2`,[m.owner_id,m.id]);
  });res.json({ok:true});
});

const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_IMAGE,files:1}});
function imageType(buffer){if(buffer.length>=3&&buffer[0]===0xff&&buffer[1]===0xd8&&buffer[2]===0xff)return'image/jpeg';if(buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return'image/png';if(buffer.length>=6&&['GIF87a','GIF89a'].includes(buffer.toString('ascii',0,6)))return'image/gif';if(buffer.length>=12&&buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP')return'image/webp';return null;}
app.post('/api/images',auth,upload.single('file'),async(req,res,next)=>{
  let jobId;
  try {
    if(!req.file||typeof req.body.momentId!=='string')throw new ApiError(400,'file and momentId are required');
    const type=imageType(req.file.buffer);if(!type||req.file.mimetype!==type)throw new ApiError(415,'Unsupported or invalid image');
    const moment=await momentAccess(req.user.id,req.body.momentId);if(!moment)throw new ApiError(404,'Moment not found');requireEditor(moment);
    const uploadKey=req.get('idempotency-key')||null;
    if(uploadKey&&!/^[a-zA-Z0-9_.:-]{8,128}$/.test(uploadKey))throw new ApiError(400,'Invalid Idempotency-Key');
    const uploadHash=crypto.createHash('sha256').update(req.body.momentId).update('\0').update(type).update('\0').update(req.file.buffer).digest('hex');
    const replay=async(c)=>{
      if(!uploadKey)return null;
      const found=await c.query(`SELECT id,moment_id,content_type,size,upload_hash FROM ${qschema}.images WHERE uploader_id=$1 AND upload_key=$2`,[req.user.id,uploadKey]);
      if(found.rowCount&&found.rows[0].upload_hash!==uploadHash)throw new ApiError(409,'Idempotency key reused with different upload');
      return found.rows[0]||null;
    };
    // Replays still require fresh authorization. Keys are scoped to authenticated uploader.
    const previous=await mutate(req,momentAccess,req.body.momentId,async(c,current)=>{requireEditor(current);return replay(c);});
    const response=image=>({id:image.id,url:`/api/images/${image.id}`,momentId:image.moment_id,contentType:image.content_type,size:image.size});
    if(previous)return res.status(200).json({image:response(previous),replayed:true});
    const imageId=id(),base=`${R2_PREFIX}${crypto.randomUUID()}/${imageId}`,objectKey=`${base}/original`;
    const variants=await makeImageVariants(req.file.buffer,type);
    const thumbKey=variants.thumb?`${base}/thumb.webp`:null,displayKey=variants.display?`${base}/display.webp`:null;
    const uploads=[{key:objectKey,body:req.file.buffer,contentType:type}];
    if(variants.thumb)uploads.push({key:thumbKey,body:variants.thumb.body,contentType:'image/webp'});
    if(variants.display)uploads.push({key:displayKey,body:variants.display.body,contentType:'image/webp'});
    // Persist all possible objects before the first PUT: crash/fault recovery needs no request continuation.
    jobId=await cleanup.enqueue(pool,uploads.map(x=>x.key),{staged:true});
    for(const item of uploads)await s3.send(new PutObjectCommand({Bucket:process.env.R2_BUCKET,Key:item.key,Body:item.body,ContentType:item.contentType,CacheControl:'private, no-store'}),{abortSignal:AbortSignal.timeout(60_000)});
    const result=await mutate(req,momentAccess,req.body.momentId,async(c,current)=>{
      requireEditor(current);
      // A move to another shared track must not let this staged upload silently follow it.
      if(current.owner_id!==moment.owner_id||current.event_id!==moment.event_id)throw new ApiError(409,'Moment moved during upload');
      const existing=await replay(c);if(existing)return {image:existing,replayed:true};
      await cleanup.attach(c,jobId);
      await c.query(`INSERT INTO ${qschema}.images(id,owner_id,moment_id,object_key,content_type,size,thumb_object_key,display_object_key,thumb_size,display_size,width,height,uploader_id,upload_key,upload_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,[imageId,current.owner_id,current.id,objectKey,type,req.file.size,thumbKey,displayKey,variants.thumb?.size||null,variants.display?.size||null,variants.width,variants.height,req.user.id,uploadKey,uploadHash]);
      const updated=await c.query(`UPDATE ${qschema}.moments SET version=version+1,updated_at=now() WHERE owner_id=$1 AND id=$2 RETURNING version`,[current.owner_id,current.id]);
      return {image:{id:imageId,moment_id:current.id,content_type:type,size:req.file.size},version:updated.rows[0].version};
    });
    if(result.replayed)await cleanup.abandon(jobId);jobId=null;
    res.status(result.replayed?200:201).json({image:response(result.image),version:result.version,replayed:!!result.replayed});
  } catch(error) {
    // If DB is unavailable, durable staged job remains recoverable after its lease expires.
    if(jobId)await cleanup.abandon(jobId).catch(()=>{});
    next(error);
  }
});
app.get('/api/images/:id',auth,async(req,res,next)=>{try{
  const image=await imageAccess(req.user.id,req.params.id);if(!image)return fail(res,404,'Image not found');
  const variant=resolveVariant(image,req.query.variant || 'original');if(!variant)return fail(res,400,'Invalid image variant');
  if(!variant.key.startsWith(R2_PREFIX))throw new Error('Invalid image namespace');
  await imageDelivery.deliver({req,res,metadata:variant});
}catch(e){next(e);}});
app.delete('/api/images/:id',auth,async(req,res)=>{
  await mutate(req,imageAccess,req.params.id,async(c,image)=>{
    requireEditor(image); await cleanup.enqueue(c,imageKeys([image]));
    await c.query(`DELETE FROM ${qschema}.images WHERE id=$1`,[image.id]);
    await c.query(`UPDATE ${qschema}.moments SET version=version+1,updated_at=now() WHERE owner_id=$1 AND id=$2`,[image.owner_id,image.moment_id]);
  });res.json({ok:true});
});

app.get('/api/tags',auth,async(req,res,next)=>{try{const {rows}=await pool.query(`SELECT name FROM ${qschema}.tags WHERE owner_id=$1 UNION SELECT DISTINCT jsonb_array_elements_text(m.document->'tags') AS name FROM ${qschema}.moments m JOIN ${qschema}.track_collaborators c ON c.owner_id=m.owner_id AND c.track_id=m.event_id WHERE c.recipient_id=$1 AND c.accepted_at IS NOT NULL AND c.revoked_at IS NULL UNION SELECT DISTINCT jsonb_array_elements_text(t.document->'tags') AS name FROM ${qschema}.tracks t JOIN ${qschema}.track_collaborators c ON c.owner_id=t.owner_id AND c.track_id=t.id WHERE c.recipient_id=$1 AND c.accepted_at IS NOT NULL AND c.revoked_at IS NULL ORDER BY name`,[req.user.id]);res.json({tags:rows.map(x=>x.name)});}catch(e){next(e);}});
app.post('/api/tags',auth,async(req,res)=>{
  const tag=req.body?.tag;if(typeof tag!=='string'||!tag.trim()||tag.trim().length>64) throw new ApiError(400,'Invalid tag');
  const value=tag.trim(), trackId=req.body?.trackId;
  if(trackId!=null){if(typeof trackId!=='string')throw new ApiError(400,'Invalid track');await mutate(req,trackAccess,trackId,async(c,a)=>{requireEditor(a);await persistTags(a.owner_id,[value],c);});}
  else await ownerWrite(req,c=>persistTags(req.user.id,[value],c));
  res.status(201).json({tag:value});
});
app.delete('/api/tags/:tag',auth,async(req,res)=>{
  const tag=req.params.tag,trackId=req.query.trackId;
  if(trackId!=null&&typeof trackId!=='string')throw new ApiError(400,'Invalid track');
  const remove=async(c,a)=>{
    requireEditor(a);const args=[a.owner_id,tag];if(trackId)args.push(trackId);
    const patch=`jsonb_set(jsonb_set(document,'{tags}',COALESCE((SELECT jsonb_agg(v) FROM jsonb_array_elements(document->'tags') v WHERE v<>to_jsonb($2::text)),'[]'::jsonb)),'{updatedAt}',to_jsonb(now()::text))`;
    await c.query(`UPDATE ${qschema}.moments SET document=${patch},version=version+1,updated_at=now() WHERE owner_id=$1 AND document->'tags' ? $2 ${trackId?'AND event_id=$3':''}`,args);
    if(a.role==='owner')await c.query(`UPDATE ${qschema}.tracks SET document=${patch},updated_at=now() WHERE owner_id=$1 AND document->'tags' ? $2 ${trackId?'AND id=$3':''}`,args);
    if(!trackId)await c.query(`DELETE FROM ${qschema}.tags WHERE owner_id=$1 AND name=$2`,args);
  };
  if(trackId)await mutate(req,trackAccess,trackId,remove);else await ownerWrite(req,c=>remove(c,{owner_id:req.user.id,role:'owner'}));
  res.json({ok:true});
});

// Named dependencies support deterministic fault injection without test-only HTTP routes.
export { app, s3 };
app.use((err,req,res,next)=>{if(res.headersSent)return next(err);if(['IMAGE_BUSY','IMAGE_TIMEOUT'].includes(err?.code)){res.removeHeader('Content-Length');res.removeHeader('ETag');res.set('Cache-Control','no-store');res.set('Retry-After','2');return fail(res,503,'Image delivery temporarily unavailable');}if(['IMAGE_LENGTH_MISMATCH','IMAGE_METADATA_INVALID'].includes(err?.code)){res.removeHeader('Content-Length');res.removeHeader('ETag');res.set('Cache-Control','no-store');return fail(res,502,'Image storage temporarily unavailable');}if(['IMAGE_INVALID','IMAGE_TOO_LARGE','IMAGE_TRANSFORM_BUSY','TRANSFORM_BUSY'].includes(err?.code)){const status=err.code==='IMAGE_INVALID'?400:err.code==='IMAGE_TOO_LARGE'?413:503;if(status===503)res.set('Retry-After','2');return fail(res,status,status===400?'Invalid or unsupported image':status===413?'Image is too large':'Image processing temporarily unavailable');}if(err instanceof ApiError)return res.status(err.status).json({error:err.message,...err.details});if(['ECONNREFUSED','ECONNRESET','ETIMEDOUT','EHOSTUNREACH','53300','57P01','57P03','08006'].includes(err?.code)||/connection.*(timeout|terminated|closed)|timeout.*connect/i.test(err?.message||''))return fail(res,503,'Dependency temporarily unavailable');if(err instanceof multer.MulterError)return res.status(err.code==='LIMIT_FILE_SIZE'?413:400).json({error:'Invalid upload'});if(err?.code==='23505')return fail(res,409,'Resource already exists');if(err?.name==='NoSuchKey')return fail(res,404,'Image not found');res.status(500).json({error:'Internal server error'});});
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const stopCleanup=startCleanup(cleanup,()=>process.stderr.write('Cleanup drain unavailable\n'));const server=app.listen(PORT,'127.0.0.1',()=>console.log(`Memento API listening on 127.0.0.1:${PORT}`));const stop=()=>{stopCleanup();server.close(async()=>{await pool.end();process.exit(0);});};process.on('SIGTERM',stop);process.on('SIGINT',stop);}
