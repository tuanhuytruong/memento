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

const app = express();
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
const COOKIE = 'memento_session';
const limits = new Map();
let limiterRequests = 0;
const limiter = (req, res, next) => {
  if (++limiterRequests % 256 === 0) {
    const now = Date.now();
    for (const [key, value] of limits) if (value.until < now) limits.delete(key);
  }
  const isAuth = req.originalUrl.split('?')[0].startsWith('/api/auth/');
  const key = `${req.ip}:${isAuth ? 'auth' : 'api'}`;
  const now = Date.now();
  let state = limits.get(key);
  if (!state || state.until < now) state = { count: 0, until: now + 60_000 };
  state.count++;
  limits.set(key, state);
  if (state.count > (key.endsWith(':auth') ? 20 : 120)) return res.status(429).json({ error: 'Too many requests' });
  next();
};
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
// Keep liveness independent of database, authentication and R2 availability.
app.get('/health', (_req, res) => res.status(200).json({ ok: true, service: 'memento-api' }));
app.use(express.json({ limit: '1mb', strict: true }));
app.use('/api', limiter);
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
    req.user = rows[0]; next();
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
async function persistTags(ownerId, tags) {
  for (const tag of tags || []) await pool.query(`INSERT INTO ${qschema}.tags(owner_id,name) VALUES($1,$2) ON CONFLICT DO NOTHING`, [ownerId, tag]);
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
  const client = await pool.connect();
  try {
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
  } catch (e) { await client.query('ROLLBACK').catch(()=>{}); next(e); }
  finally { client.release(); }
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
function safeMoment(doc, imageRows) {
  const images = imageRows.map(x => `/api/images/${x.id}`);
  return { ...doc, images };
}
app.get('/api/tracks', auth, async (req,res,next) => { try { const {rows}=await pool.query(`SELECT document FROM ${qschema}.tracks WHERE owner_id=$1 ORDER BY created_at,id`,[req.user.id]); res.json({tracks:rows.map(x=>x.document)}); } catch(e){next(e);} });
app.post('/api/tracks', auth, async (req,res,next) => {
  try { const d=validateDocument(req.body,'track'); if(!d) return fail(res,400,'Invalid track'); d.id=typeof d.id==='string'&&d.id.length<128?d.id:id(); await pool.query(`INSERT INTO ${qschema}.tracks(owner_id,id,document) VALUES($1,$2,$3)`,[req.user.id,d.id,d]); await persistTags(req.user.id,d.tags); res.status(201).json({track:d}); }
  catch(e){if(e.code==='23505')return fail(res,409,'Track already exists');next(e);}
});
app.put('/api/tracks/:id', auth, async (req,res,next) => {
  const c=await pool.connect();
  try { await c.query('BEGIN'); const old=await c.query(`SELECT document FROM ${qschema}.tracks WHERE owner_id=$1 AND id=$2 FOR UPDATE`,[req.user.id,req.params.id]); if(!old.rowCount){await c.query('ROLLBACK');return fail(res,404,'Track not found');} const d=validateDocument({...old.rows[0].document,...req.body,id:req.params.id},'track'); if(!d){await c.query('ROLLBACK');return fail(res,400,'Invalid track');} await c.query(`UPDATE ${qschema}.tracks SET document=$3,updated_at=now() WHERE owner_id=$1 AND id=$2`,[req.user.id,req.params.id,d]); await c.query('COMMIT');await persistTags(req.user.id,d.tags);res.json({track:d}); }
  catch(e){await c.query('ROLLBACK').catch(()=>{});next(e);}finally{c.release();}
});
async function deleteImageObjects(rows) {
  let complete = true;
  for (const row of rows) {
    try { await s3.send(new DeleteObjectCommand({Bucket:process.env.R2_BUCKET,Key:row.object_key})); }
    catch { complete = false; process.stderr.write(`Private R2 cleanup failed for image ${row.id}; metadata retained\\n`); }
  }
  return complete;
}
app.delete('/api/tracks/:id', auth, async (req,res,next) => {
  const c=await pool.connect();
  try { await c.query('BEGIN'); const track=await c.query(`SELECT id FROM ${qschema}.tracks WHERE owner_id=$1 AND id=$2 FOR UPDATE`,[req.user.id,req.params.id]); if(!track.rowCount){await c.query('ROLLBACK');return fail(res,404,'Track not found');} const imgs=await c.query(`SELECT i.id,i.object_key FROM ${qschema}.images i JOIN ${qschema}.moments m ON m.owner_id=i.owner_id AND m.id=i.moment_id WHERE i.owner_id=$1 AND m.event_id=$2`,[req.user.id,req.params.id]); await c.query('COMMIT'); if (!(await deleteImageObjects(imgs.rows))) return fail(res,503,'Image storage cleanup incomplete; retry deletion'); await pool.query(`DELETE FROM ${qschema}.tracks WHERE owner_id=$1 AND id=$2`,[req.user.id,req.params.id]);res.json({ok:true}); }
  catch(e){await c.query('ROLLBACK').catch(()=>{});next(e);}finally{c.release();}
});
app.get('/api/moments', auth, async (req,res,next) => { try { const {rows}=await pool.query(`SELECT m.document,m.id FROM ${qschema}.moments m WHERE m.owner_id=$1 ORDER BY m.document->>'date' DESC,m.id`,[req.user.id]); const out=[]; for(const row of rows){const imgs=await pool.query(`SELECT id FROM ${qschema}.images WHERE owner_id=$1 AND moment_id=$2 ORDER BY created_at`,[req.user.id,row.id]);out.push(safeMoment(row.document,imgs.rows));}res.json({moments:out});}catch(e){next(e);} });
app.post('/api/moments', auth, async (req,res,next) => {
  try { const d=validateDocument(req.body,'moment');if(!d)return fail(res,400,'Invalid moment');d.id=typeof d.id==='string'&&d.id.length<128?d.id:id(); const track=await pool.query(`SELECT 1 FROM ${qschema}.tracks WHERE owner_id=$1 AND id=$2`,[req.user.id,d.eventId]);if(!track.rowCount)return fail(res,400,'Track not found'); if(d.images.length)return fail(res,400,'Images must be uploaded using POST /api/images'); d.images=[]; await pool.query(`INSERT INTO ${qschema}.moments(owner_id,id,event_id,document) VALUES($1,$2,$3,$4)`,[req.user.id,d.id,d.eventId,d]);await persistTags(req.user.id,d.tags);res.status(201).json({moment:d}); }
  catch(e){if(e.code==='23505')return fail(res,409,'Moment already exists');next(e);}
});
app.put('/api/moments/:id', auth, async (req,res,next) => {
  try {const old=await pool.query(`SELECT document,event_id FROM ${qschema}.moments WHERE owner_id=$1 AND id=$2`,[req.user.id,req.params.id]);if(!old.rowCount)return fail(res,404,'Moment not found');const requested={...old.rows[0].document,...req.body,id:req.params.id};if(requested.images?.some(x=>!String(x).startsWith('/api/images/')))return fail(res,400,'Invalid image URL');const d=validateDocument(requested,'moment');if(!d)return fail(res,400,'Invalid moment');if(d.eventId!==old.rows[0].event_id){const track=await pool.query(`SELECT 1 FROM ${qschema}.tracks WHERE owner_id=$1 AND id=$2`,[req.user.id,d.eventId]);if(!track.rowCount)return fail(res,400,'Track not found');}const imgs=await pool.query(`SELECT id FROM ${qschema}.images WHERE owner_id=$1 AND moment_id=$2`,[req.user.id,req.params.id]);d.images=imgs.rows.map(x=>`/api/images/${x.id}`);await pool.query(`UPDATE ${qschema}.moments SET event_id=$3,document=$4,updated_at=now() WHERE owner_id=$1 AND id=$2`,[req.user.id,req.params.id,d.eventId,d]);await persistTags(req.user.id,d.tags);res.json({moment:d});}
  catch(e){next(e);}
});
app.delete('/api/moments/:id', auth, async (req,res,next) => {
  try {const rows=await pool.query(`SELECT id,object_key FROM ${qschema}.images WHERE owner_id=$1 AND moment_id=$2`,[req.user.id,req.params.id]); const m=await pool.query(`SELECT 1 FROM ${qschema}.moments WHERE owner_id=$1 AND id=$2`,[req.user.id,req.params.id]);if(!m.rowCount)return fail(res,404,'Moment not found');if (!(await deleteImageObjects(rows.rows))) return fail(res,503,'Image storage cleanup incomplete; retry deletion');await pool.query(`DELETE FROM ${qschema}.moments WHERE owner_id=$1 AND id=$2`,[req.user.id,req.params.id]);res.json({ok:true});}catch(e){next(e);}
});

const upload = multer({ storage:multer.memoryStorage(), limits:{fileSize:MAX_IMAGE,files:1} });
function imageType(buffer) {
  if(buffer.length>=3&&buffer[0]===0xff&&buffer[1]===0xd8&&buffer[2]===0xff)return 'image/jpeg';
  if(buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(buffer.length>=6&&['GIF87a','GIF89a'].includes(buffer.toString('ascii',0,6)))return 'image/gif';
  if(buffer.length>=12&&buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP')return 'image/webp';
  return null;
}
app.post('/api/images', auth, upload.single('file'), async (req,res,next) => {
  let objectKey;
  try { if(!req.file||typeof req.body.momentId!=='string')return fail(res,400,'file and momentId are required');const type=imageType(req.file.buffer);if(!type||req.file.mimetype!==type)return fail(res,415,'Unsupported or invalid image'); const moment=await pool.query(`SELECT 1 FROM ${qschema}.moments WHERE owner_id=$1 AND id=$2`,[req.user.id,req.body.momentId]);if(!moment.rowCount)return fail(res,404,'Moment not found');const imageId=id();objectKey=`${R2_PREFIX}${crypto.randomUUID()}/${imageId}`;await s3.send(new PutObjectCommand({Bucket:process.env.R2_BUCKET,Key:objectKey,Body:req.file.buffer,ContentType:type,CacheControl:'private, no-store'}));try{await pool.query(`INSERT INTO ${qschema}.images(id,owner_id,moment_id,object_key,content_type,size) VALUES($1,$2,$3,$4,$5,$6)`,[imageId,req.user.id,req.body.momentId,objectKey,type,req.file.size]);}catch(e){await s3.send(new DeleteObjectCommand({Bucket:process.env.R2_BUCKET,Key:objectKey})).catch(()=>{process.stderr.write(`R2 orphan cleanup failed for image ${imageId}\n`);});throw e;}res.status(201).json({image:{id:imageId,url:`/api/images/${imageId}`,momentId:req.body.momentId,contentType:type,size:req.file.size}}); }
  catch(e){next(e);}
});
app.get('/api/images/:id', auth, async (req,res,next) => {
  try {const {rows}=await pool.query(`SELECT object_key,content_type,size FROM ${qschema}.images WHERE id=$1 AND owner_id=$2`,[req.params.id,req.user.id]);if(!rows[0])return fail(res,404,'Image not found');const obj=await s3.send(new GetObjectCommand({Bucket:process.env.R2_BUCKET,Key:rows[0].object_key}));res.set({'Content-Type':rows[0].content_type,'Content-Length':String(rows[0].size),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});obj.Body.pipe(res);obj.Body.on('error',next);}
  catch(e){next(e);}
});
app.delete('/api/images/:id', auth, async (req,res,next) => { try {const {rows}=await pool.query(`SELECT id,object_key FROM ${qschema}.images WHERE id=$1 AND owner_id=$2`,[req.params.id,req.user.id]);if(!rows[0])return fail(res,404,'Image not found');if (!(await deleteImageObjects(rows))) return fail(res,503,'Image storage cleanup incomplete; retry deletion');await pool.query(`DELETE FROM ${qschema}.images WHERE id=$1 AND owner_id=$2`,[req.params.id,req.user.id]);res.json({ok:true});}catch(e){next(e);} });
app.get('/api/tags', auth, async (req,res,next) => {try{const {rows}=await pool.query(`SELECT name FROM ${qschema}.tags WHERE owner_id=$1 ORDER BY name`,[req.user.id]);res.json({tags:rows.map(x=>x.name)});}catch(e){next(e);}});
app.post('/api/tags', auth, async (req,res,next) => {try{const tag=req.body?.tag;if(typeof tag!=='string'||!tag.trim()||tag.trim().length>64)return fail(res,400,'Invalid tag');const value=tag.trim();await pool.query(`INSERT INTO ${qschema}.tags(owner_id,name) VALUES($1,$2) ON CONFLICT DO NOTHING`,[req.user.id,value]);res.status(201).json({tag:value});}catch(e){next(e);}});
app.delete('/api/tags/:tag', auth, async (req,res,next) => {try{const tag=req.params.tag;await pool.query(`DELETE FROM ${qschema}.tags WHERE owner_id=$1 AND name=$2`,[req.user.id,tag]);const {rows}=await pool.query(`SELECT id,document FROM ${qschema}.moments WHERE owner_id=$1`,[req.user.id]);for(const row of rows){const d=row.document;if(Array.isArray(d.tags)&&d.tags.includes(tag)){d.tags=d.tags.filter(x=>x!==tag);d.updatedAt=new Date().toISOString();await pool.query(`UPDATE ${qschema}.moments SET document=$3,updated_at=now() WHERE owner_id=$1 AND id=$2`,[req.user.id,row.id,d]);}}const tracks=await pool.query(`SELECT id,document FROM ${qschema}.tracks WHERE owner_id=$1`,[req.user.id]);for(const row of tracks.rows){const d=row.document;if(Array.isArray(d.tags)&&d.tags.includes(tag)){d.tags=d.tags.filter(x=>x!==tag);d.updatedAt=new Date().toISOString();await pool.query(`UPDATE ${qschema}.tracks SET document=$3,updated_at=now() WHERE owner_id=$1 AND id=$2`,[req.user.id,row.id,d]);}}res.json({ok:true});}catch(e){next(e);}});

export { app };
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof multer.MulterError) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'Invalid upload' });
  if (err?.code === '23505') return fail(res, 409, 'Resource already exists');
  if (err?.name === 'NoSuchKey') return fail(res, 404, 'Image not found');
  res.status(500).json({ error: 'Internal server error' });
});
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server=app.listen(PORT,'127.0.0.1',()=>console.log(`Memento API listening on 127.0.0.1:${PORT}`));
  const stop=()=>server.close(async()=>{await pool.end();process.exit(0);});
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
