// Live upload timing on DEV: the same route a browser calls, without a browser.
//
// For each prepared size this records the client-observed duration, the origin's own
// Server-Timing stages, and the unattributed remainder between them. Bodies are generated
// fixtures; the disposable user, moments and R2 objects are removed and re-verified at the end.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import sharp from 'sharp';
import { S3Client, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import bcrypt from 'bcryptjs';
import { pool, qschema, hashSession } from '../memento-db.mjs';

const envFile = fs.existsSync('.env.local') ? '.env.local' : '.env';
const env = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split('\n')
  .map((line) => line.trim()).filter((line) => line && !line.startsWith('#') && line.includes('='))
  .map((line) => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1).replace(/^["']|["']$/g, '')]; }));

const base = process.env.MEMENTO_DEV_BASE || 'https://memento-dev.srv.io.vn';
const repeats = Number(process.env.MEMENTO_UPLOAD_REPEATS || 3);
const out = path.resolve(process.env.MEMENTO_UI_ARTIFACTS || '.hermes/evidence/upload-timing');
fs.mkdirSync(out, { recursive: true });

const s3 = new S3Client({
  region: 'auto',
  endpoint: env.R2_ENDPOINT,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  maxAttempts: 1,
});
const bucket = env.R2_BUCKET;
const report = { base, repeats, samples: [], cleanup: {}, notes: [] };

const parseServerTiming = (header) => {
  const stages = {};
  for (const metric of String(header || '').split(',')) {
    const [name, ...params] = metric.split(';').map((part) => part.trim());
    const dur = params.find((param) => param.toLowerCase().startsWith('dur='));
    if (!name || !dur) continue;
    const value = Number(dur.slice(4));
    if (Number.isFinite(value)) stages[name] = Math.round(value * 1000) / 1000;
  }
  return stages;
};

const owner = { id: crypto.randomUUID(), username: `qa_timing_${crypto.randomBytes(5).toString('hex')}`, token: crypto.randomBytes(32).toString('hex') };
const track = 'qa-timing';
const moments = [];
try {
  const passwordHash = await bcrypt.hash(crypto.randomBytes(18).toString('hex'), 12);
  await pool.query(`INSERT INTO ${qschema}.users(id,username,password_hash) VALUES($1,$2,$3)`, [owner.id, owner.username, passwordHash]);
  await pool.query(`INSERT INTO ${qschema}.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')`, [hashSession(owner.token), owner.id]);
  await pool.query(`INSERT INTO ${qschema}.tracks(owner_id,id,document) VALUES($1,$2,$3)`, [owner.id, track, {
    id: track, title: 'QA timing', description: 'Temporary upload timing fixture', color: 'indigo', icon: 'Heart', tags: [], createdAt: '2026-10-20', updatedAt: '2026-10-20',
  }]);

  // Two prepared sizes: what the browser sends after compression, and a large original.
  const fixtures = [
    { label: 'prepared-322KB', buffer: await sharp({ create: { width: 1200, height: 1600, channels: 3, background: { r: 172, g: 162, b: 205 } } }).jpeg({ quality: 62, mozjpeg: true }).toBuffer() },
    { label: 'original-1.7MB', buffer: await sharp({ create: { width: 1921, height: 2560, channels: 3, background: { r: 150, g: 185, b: 168 } } }).jpeg({ quality: 96 }).toBuffer() },
  ];

  for (const fixture of fixtures) {
    const momentId = `qa-timing-${fixture.label}`;
    await pool.query(`INSERT INTO ${qschema}.moments(owner_id,id,event_id,document) VALUES($1,$2,$3,$4)`, [owner.id, momentId, track, {
      id: momentId, eventId: track, title: `QA timing ${fixture.label}`, description: '', date: '2026-10-20', tags: [], images: [], isMilestone: false, createdAt: '2026-10-20', updatedAt: '2026-10-20',
    }]);
    moments.push(momentId);

    const keys = [];
    for (let attempt = 1; attempt <= repeats; attempt += 1) {
      const form = new FormData();
      form.append('file', new Blob([fixture.buffer], { type: 'image/jpeg' }), 'fixture.jpg');
      form.append('momentId', momentId);
      form.append('ownerId', owner.id);
      const startedAt = performance.now();
      let response;
      let failure = null;
      try {
        response = await fetch(`${base}/api/images`, {
          method: 'POST',
          headers: {
            Origin: base,
            Cookie: `memento_session=${owner.token}`,
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: form,
        });
      } catch (error) {
        failure = error.message;
      }
      const clientMs = Math.round((performance.now() - startedAt) * 1000) / 1000;
      const serverTiming = response ? parseServerTiming(response.headers.get('server-timing')) : {};
      const serverMs = serverTiming['up-total'] ?? null;
      const sample = {
        fixture: fixture.label,
        attempt,
        uploadBytes: fixture.buffer.length,
        clientMs,
        serverMs,
        transitMs: serverMs === null ? null : Math.round((clientMs - serverMs) * 1000) / 1000,
        status: response ? response.status : null,
        diagnosticId: response ? response.headers.get('x-upload-diagnostic-id') : null,
        stages: serverTiming,
        failure,
      };
      report.samples.push(sample);
      if (response && response.ok) {
        const body = await response.json().catch(() => ({}));
        if (body?.image?.id) {
          const row = await pool.query(`SELECT object_key,thumb_object_key,display_object_key FROM ${qschema}.images WHERE owner_id=$1 AND id=$2`, [owner.id, body.image.id]);
          if (row.rowCount) for (const key of [row.rows[0].object_key, row.rows[0].thumb_object_key, row.rows[0].display_object_key].filter(Boolean)) keys.push(key);
        }
      }
      console.log(`SAMPLE ${fixture.label} #${attempt} client=${clientMs}ms origin=${serverMs}ms transit=${sample.transitMs}ms status=${sample.status} r2=${(serverTiming['up-r2_original'] ?? 'n/a')}/${(serverTiming['up-r2_thumb'] ?? 'n/a')}/${(serverTiming['up-r2_display'] ?? 'n/a')}`);
    }
    report.cleanup[fixture.label] = { keys: keys.length };
    for (const key of keys) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    // Route-level deletion also runs through the app: rows and objects must both disappear.
    for (const moment of moments) await fetch(`${base}/api/moments/${moment}`, { method: 'DELETE', headers: { Origin: base, Cookie: `memento_session=${owner.token}` } }).catch(() => {});
    const remaining = await pool.query(`SELECT count(*)::int AS images FROM ${qschema}.images WHERE owner_id=$1`, [owner.id]);
    report.cleanup[fixture.label].imagesRemaining = remaining.rows[0].images;
    const present = [];
    for (const key of keys) {
      const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key })).then(() => true).catch(() => false);
      if (head) present.push(key);
    }
    report.cleanup[fixture.label].objectsRemaining = present.length;
    if (present.length) {
      for (const key of present) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      report.cleanup[fixture.label].forced = present.length;
    }
  }

  // Summarise per fixture without claiming percentiles from a tiny sample.
  for (const fixture of fixtures) {
    const rows = report.samples.filter((sample) => sample.fixture === fixture.label && sample.status === 201);
    if (!rows.length) continue;
    const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };
    report.notes.push({
      fixture: fixture.label,
      samples: rows.length,
      clientMedianMs: median(rows.map((row) => row.clientMs)),
      originMedianMs: median(rows.map((row) => row.serverMs ?? 0)),
      r2MedianMs: median(rows.map((row) => (row.stages['up-r2_original'] ?? 0) + (row.stages['up-r2_thumb'] ?? 0) + (row.stages['up-r2_display'] ?? 0))),
      transformMedianMs: median(rows.map((row) => row.stages['up-transform'] ?? 0)),
    });
    console.log('SUMMARY', JSON.stringify(report.notes.at(-1)));
  }
} finally {
  await pool.query(`DELETE FROM ${qschema}.users WHERE id=$1`, [owner.id]).catch(() => {});
  const leftover = await pool.query(`SELECT (SELECT count(*) FROM ${qschema}.moments WHERE owner_id=$1) AS moments, (SELECT count(*) FROM ${qschema}.images WHERE owner_id=$1) AS images`, [owner.id]).catch(() => ({ rows: [{ moments: 'n/a', images: 'n/a' }] }));
  report.cleanup.rows = leftover.rows[0];
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await pool.end().catch(() => {});
  console.log('CLEANUP', JSON.stringify(report.cleanup));
}
