// Phase 0 baseline: reproducible measurements, not performance claims.
// Three independent sections, each clearly labelled:
//   1) controlled synthetic UI fixtures (route-intercepted, NOT account E2E)
//   2) live authorized DEV API/R2 first-byte timing with temporary resources
//   3) DEV-only index inventory and bounded EXPLAIN (ANALYZE, BUFFERS)
// Usage (on DEV):
//   node tests/performance-baseline.cjs                          # sections 1+3
//   MEMENTO_BASELINE_LIVE=1 node tests/performance-baseline.cjs  # + section 2
// Evidence is written under .hermes/evidence/next-phase-0/.
// Nothing here exports real stories, photos, usernames or object keys.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const VIEWPORT = { width: 390, height: 844 };
const DATASET_SIZES = [100, 1000, 5000];
const TRACK_COUNT = 5;
const REPO_ROOT = path.resolve(__dirname, '..');
const EVIDENCE_DIR = process.env.MEMENTO_BASELINE_EVIDENCE
  || path.join(REPO_ROOT, '.hermes', 'evidence', 'next-phase-0');

const out = { sections: {}, limitations: [] };

function section(name, data) {
  out.sections[name] = data;
  process.stdout.write(`\n=== ${name} ===\n${JSON.stringify(data, null, 2)}\n`);
}

// Deterministic PRNG so every run measures the same synthetic account shape.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['đà lạt', 'hè', 'gia đình', 'buổi sáng', 'cà phê', 'bãi biển', 'quê', 'tuổi trẻ', 'buổi tối'];
function buildMoments(count, rand) {
  const tracks = Array.from({ length: TRACK_COUNT }, (_, i) => ({
    id: `qa-track-${i}`, resourceOwnerId: 'A', title: `Chương ${i + 1} ${'r'.repeat(30)}`,
    description: '', color: 'indigo', icon: 'Heart', tags: [`tag${i}`], createdAt: '2026-01-01', updatedAt: '2026-01-01', accessRole: 'owner',
  }));
  const moments = [];
  for (let i = 0; i < count; i += 1) {
    // Repeated dates are deliberate: real accounts cluster memories on a few days.
    const day = 1 + Math.floor(rand() * 28);
    const month = 1 + Math.floor(rand() * 12);
    const photoCount = rand() < 0.4 ? 1 + Math.floor(rand() * 3) : 0;
    moments.push({
      id: `qa-moment-${i}`,
      resourceOwnerId: 'A',
      eventId: `qa-track-${i % TRACK_COUNT}`,
      version: 1,
      title: `${WORDS[i % WORDS.length]} mô tả tổng hợp ${i}`.slice(0, 180),
      date: `2025-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      time: `${String(Math.floor(rand() * 24)).padStart(2, '0')}:${String(Math.floor(rand() * 60)).padStart(2, '0')}`,
      description: `Nội dung nhật ký tổng hợp số ${i}. ${'một đoạn kể chuyện dùng để đo kích thước phản hồi '.repeat(2)}`.slice(0, 400),
      tags: [`tag${i % TRACK_COUNT}`, ...WORDS.slice(0, Math.floor(rand() * 3))],
      images: Array.from({ length: photoCount }, (_, p) => `/api/images/qa-${i}-${p}`),
      reactions: rand() < 0.25 ? [{ emoji: '❤️', count: 1 + Math.floor(rand() * 4), selected: false, usernames: ['qa-a', 'qa-b'] }] : [],
      createdAt: '2026-01-01', updatedAt: '2026-01-01',
    });
  }
  return { tracks, moments };
}

function currentBuildHash() {
  try {
    const assets = fs.readdirSync(path.join(REPO_ROOT, 'dist', 'assets')).filter(name => /^index-.*\.js$/.test(name));
    return assets[0] || null;
  } catch { return null; }
}

function git(cmd) {
  try { return execFileSync('git', cmd.split(' '), { cwd: REPO_ROOT, encoding: 'utf8' }).trim(); }
  catch { return null; }
}

async function measureSyntheticUi() {
  let chromium;
  // require() honors NODE_PATH, unlike dynamic import(); same pattern as ui-remediation.cjs.
  try { ({ chromium } = require('playwright')); }
  catch { return { skipped: 'Playwright not installed (set NODE_PATH); section not measured' }; }
  const executablePath = process.env.CHROMIUM_PATH;
  if (!executablePath) return { skipped: 'CHROMIUM_PATH not set; section not measured' };
  const results = [];
  const browserVersion = await (async () => {
    const probe = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
    const version = probe.version();
    await probe.close();
    return version;
  })();
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--enable-precise-memory-info'] });
  try {
    for (const size of DATASET_SIZES) {
      const rand = mulberry32(1337 + size);
      const { tracks, moments } = buildMoments(size, rand);
      const perRun = {};
      for (const run of ['cold', 'warm']) {
        const context = await browser.newContext({ viewport: VIEWPORT });
        const page = await context.newPage();
        let apiBytes = 0; let apiRequests = 0;
        await page.route('**/api/**', async route => {
          const request = route.request();
          const url = new URL(request.url());
          apiRequests += 1;
          if (url.pathname.startsWith('/api/images/')) {
            const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="100%" height="100%" fill="teal"/></svg>';
            const payload = Buffer.from(svg);
            apiBytes += payload.length;
            return route.fulfill({ contentType: 'image/svg+xml', body: payload });
          }
          let body = {};
          if (url.pathname === '/api/auth/me') body = { user: { id: 'A', username: 'qa-baseline' } };
          else if (url.pathname === '/api/tracks') body = { tracks };
          else if (url.pathname === '/api/moments' && request.method() === 'GET') body = { moments };
          else if (url.pathname === '/api/tags') body = { tags: [] };
          else if (url.pathname === '/api/track-visits') body = { visits: [] };
          else if (url.pathname === '/api/collaboration-invitations') body = { invitations: [] };
          const payload = Buffer.from(JSON.stringify(body));
          apiBytes += payload.length;
          return route.fulfill({ json: body });
        });
        const started = Date.now();
        await page.goto(process.env.MEMENTO_UI_URL || 'https://memento-dev.srv.io.vn', { waitUntil: 'domcontentloaded' });
        await page.locator('[id^="event-card-"]').first().waitFor({ timeout: 60000 });
        await page.locator('#timeline-search-input').waitFor();
        const usableTimelineMs = Date.now() - started;
        const filterMs = await page.evaluate(async () => {
          const input = document.querySelector('#timeline-search-input');
          const initial = document.querySelectorAll('[id^="event-card-"]').length;
          const before = performance.now();
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, 'đà lạt');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(resolve => {
            const check = () => (document.querySelectorAll('[id^="event-card-"]').length !== initial ? resolve() : requestAnimationFrame(check));
            requestAnimationFrame(check);
            setTimeout(resolve, 3000);
          });
          return Math.round(performance.now() - before);
        });
        const cardDomCount = await page.locator('[id^="event-card-"]').count();
        const heap = await page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize) : null));
        const navTiming = await page.evaluate(() => {
          const [entry] = performance.getEntriesByType('navigation');
          return entry ? { responseEnd: Math.round(entry.responseEnd), domContentLoaded: Math.round(entry.domContentLoadedEventEnd), loadEvent: Math.round(entry.loadEventEnd) } : null;
        });
        perRun[run] = { apiRequests, apiBytes, usableTimelineMs, filterInteractionMs: filterMs, cardDomCount, usedJsHeapBytes: heap, navigation: navTiming };
        await context.close();
      }
      results.push({ syntheticMoments: size, tracks: TRACK_COUNT, viewport: VIEWPORT, throttling: 'none (no CDP throttling applied)', cacheState: 'cold = fresh browser context; warm = fresh context reusing HTTP cache on the same origin', ...perRun });
    }
  } finally { await browser.close(); }
  return {
    kind: 'controlled synthetic route-intercepted fixtures — NOT authenticated account E2E and NOT an R2 benchmark',
    browserVersion,
    buildHash: currentBuildHash(),
    results,
  };
}

async function measureLiveApiR2() {
  if (process.env.MEMENTO_BASELINE_LIVE !== '1') return { skipped: 'set MEMENTO_BASELINE_LIVE=1 to measure live DEV API/R2 with temporary resources' };
  const dotenv = require('dotenv');
  dotenv.config({ path: process.env.ENV_FILE || path.join(REPO_ROOT, '.env.local'), quiet: true });
  const { pool, qschema, createInvite, hashInvite, hashSession } = await import('../memento-db.mjs');
  const token = crypto.randomBytes(32).toString('base64url');
  const userId = crypto.randomUUID();
  const username = `qa_base_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const base = process.env.MEMENTO_BASELINE_BASE_URL || 'http://127.0.0.1:3092';
  const origin = base;
  const timings = {};
  const time = async (key, work) => {
    const started = Date.now();
    const value = await work();
    timings[key] = Date.now() - started;
    return value;
  };
  // 1x1 transparent PNG: small enough to be a fair per-object R2 timing probe.
  const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNgZGJmZGJmgFAAAK4AGRLRbNUAAAAASUVORK5CYII=', 'base64');
  const json = async (pathName, { method = 'GET', body, headers = {} } = {}) => {
    const h = { ...headers };
    if (method !== 'GET') h.Origin = origin;
    h.Cookie = `memento_session=${token}`;
    let payload;
    if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + pathName, { method, headers: h, body: payload, signal: AbortSignal.timeout(30000) });
    return { status: res.status, data: res.headers.get('content-type')?.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };
  let inviteHash;
  try {
    const invite = await createInvite(1);
    inviteHash = hashInvite(invite);
    await pool.query(`INSERT INTO ${qschema}.users(id,username,password_hash) VALUES($1,$2,'qa-baseline-unused')`, [userId, username]);
    await pool.query(`INSERT INTO ${qschema}.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')`, [hashSession(token), userId]);
    const track = await time('createTrackMs', async () => (await json('/api/tracks', { method: 'POST', body: { title: 'QA baseline track', description: '', color: 'indigo', icon: 'Heart', tags: [] } })).data.track);
    const moment = await time('createMomentMs', async () => (await json('/api/moments', { method: 'POST', body: { eventId: track.id, eventOwnerId: userId, title: 'QA baseline memory', date: '2026-01-02', description: 'temporary measurement resource', tags: [], images: [] } })).data.moment);
    const form = new FormData();
    form.set('momentId', moment.id);
    form.set('ownerId', userId);
    form.set('file', new Blob([PIXEL], { type: 'image/png' }), 'probe.png');
    const uploaded = await time('uploadImageMs', async () => {
      const res = await fetch(`${base}/api/images`, { method: 'POST', headers: { Origin: origin, Cookie: `memento_session=${token}` }, body: form, signal: AbortSignal.timeout(60000) });
      if (res.status !== 201) throw new Error(`upload failed: ${res.status}`);
      return (await res.json()).image;
    });
    await time('listMomentsFirstByteMs', async () => (await json('/api/moments')).status);
    const variantBytes = {};
    for (const variant of ['original', 'thumb', 'display']) {
      for (const pass of ['cold', 'warm']) {
        const started = Date.now();
        const res = await fetch(`${base}/api/images/${uploaded.id}?variant=${variant}`, { headers: { Cookie: `memento_session=${token}` }, signal: AbortSignal.timeout(30000) });
        const buffer = Buffer.from(await res.arrayBuffer());
        timings[`${variant}_${pass}Ms`] = Date.now() - started;
        if (pass === 'cold') variantBytes[variant] = buffer.length;
      }
    }
    return {
      kind: 'live authorized DEV API/R2 measurement using temporary resources that are deleted afterwards; per-object R2 first-byte latency, not a payload-size benchmark',
      base,
      timings,
      responseBytes: variantBytes,
    };
  } finally {
    // Temporary measurement resources are removed; no usernames or keys are printed.
    await pool.query(`DELETE FROM ${qschema}.users WHERE id=$1`, [userId]).catch(() => {});
    if (inviteHash) await pool.query(`DELETE FROM ${qschema}.invites WHERE code_hash=$1`, [inviteHash]).catch(() => {});
    await pool.end().catch(() => {});
  }
}

const EXPLAIN_QUERIES = {
  accessibleMoments: {
    sql: `SELECT m.owner_id,m.document,m.id,m.version FROM SCHEMA.moments m WHERE m.owner_id=$1 UNION ALL SELECT m.owner_id,m.document,m.id,m.version FROM SCHEMA.moments m JOIN SCHEMA.track_collaborators c ON c.owner_id=m.owner_id AND c.track_id=m.event_id WHERE c.recipient_id=$1 AND c.accepted_at IS NOT NULL AND c.revoked_at IS NULL`,
    args: 'userId',
  },
  momentImages: {
    sql: `SELECT owner_id,moment_id,id FROM SCHEMA.images WHERE (owner_id,moment_id) IN (SELECT * FROM unnest($1::uuid[],$2::text[])) ORDER BY created_at`,
    args: 'ownerMomentPairs',
  },
  reactionSummaries: {
    sql: `SELECT r.moment_owner_id,r.moment_id,r.emoji,COUNT(*)::int AS count, BOOL_OR(r.user_id=$1) AS selected, ARRAY_AGG(u.username ORDER BY u.username) AS usernames FROM SCHEMA.moment_reactions r JOIN SCHEMA.users u ON u.id=r.user_id WHERE (r.moment_owner_id,r.moment_id) IN (SELECT * FROM unnest($2::uuid[],$3::text[])) GROUP BY r.moment_owner_id,r.moment_id,r.emoji ORDER BY r.moment_owner_id,r.moment_id,r.emoji`,
    args: 'userIdOwnerMomentPairs',
  },
};

async function inspectDatabase() {
  const dotenv = require('dotenv');
  dotenv.config({ path: process.env.ENV_FILE || path.join(REPO_ROOT, '.env.local'), quiet: true });
  const pg = require('pg');
  const { schema, qschema } = await import('../memento-db.mjs');
  // Dedicated pool: this section must not end the shared module pool used by other sections.
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try {
    const tables = ['users', 'sessions', 'invites', 'tracks', 'moments', 'tags', 'images', 'object_cleanup_jobs', 'track_collaborators', 'moment_reactions', 'moment_perspectives', 'track_visit_state'];
    const indexes = [];
    const counts = {};
    for (const table of tables) {
      const found = await pool.query(`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=$1 AND tablename=$2`, [schema, table]);
      for (const row of found.rows) indexes.push({ table, name: row.indexname, definition: row.indexdef.replace(new RegExp(`"${schema}"\\.`, 'g'), '') });
      const count = await pool.query(`SELECT count(*)::int AS n FROM ${qschema}.${table}`);
      counts[table] = count.rows[0].n;
    }
    // EXPLAIN only against a small real owner and only while data stays bounded.
    const owner = await pool.query(`SELECT owner_id,count(*)::int AS n FROM ${qschema}.moments GROUP BY owner_id ORDER BY n ASC LIMIT 1`);
    const explain = [];
    if (owner.rows.length && owner.rows[0].n <= 5000) {
      const userId = owner.rows[0].owner_id;
      const pairs = await pool.query(`SELECT owner_id,id FROM ${qschema}.moments WHERE owner_id=$1 ORDER BY id LIMIT 100`, [userId]);
      const owners = pairs.rows.map(r => r.owner_id); const ids = pairs.rows.map(r => r.id);
      const argsFor = { userId: [userId], ownerMomentPairs: [owners, ids], userIdOwnerMomentPairs: [userId, owners, ids] };
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL statement_timeout='5000'`);
        await client.query(`SET LOCAL idle_in_transaction_session_timeout='8000'`);
        for (const [name, spec] of Object.entries(EXPLAIN_QUERIES)) {
          const sql = spec.sql.replaceAll('SCHEMA', qschema);
          try {
            const plan = await client.query(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`, argsFor[spec.args]);
            explain.push({ query: name, statementTimeoutMs: 5000, plan: plan.rows.map(r => r['QUERY PLAN']) });
          } catch (error) {
            explain.push({ query: name, statementTimeoutMs: 5000, error: String(error.message).split('\n')[0] });
          }
        }
      } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
    } else {
      explain.push({ skipped: 'no owner with a bounded moment count (<=5000) was available' });
    }
    return { schema, tableRowCounts: counts, indexes, explain, note: 'DEV-only inspection with statement timeout; migration inventory is not assumed to equal deployed indexes' };
  } finally { await pool.end().catch(() => {}); }
}

(async () => {
  const started = Date.now();
  out.meta = {
    committedAt: new Date().toISOString(),
    commit: git('rev-parse HEAD'),
    branch: git('branch --show-current'),
    buildHash: currentBuildHash(),
    viewport: VIEWPORT,
    node: process.version,
    invocation: 'node tests/performance-baseline.cjs',
  };
  out.sections.syntheticUi = await measureSyntheticUi();
  if (out.sections.syntheticUi.skipped) out.limitations.push(out.sections.syntheticUi.skipped);
  out.sections.database = await inspectDatabase();
  out.sections.liveApiR2 = await measureLiveApiR2();
  if (out.sections.liveApiR2.skipped) out.limitations.push(out.sections.liveApiR2.skipped);
  out.meta.totalDurationMs = Date.now() - started;
  out.limitations.push('Synthetic fixtures prove payload/DOM shape, never authenticated account E2E or production latency; live section measures per-object R2 first-byte only.');
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = path.join(EVIDENCE_DIR, `performance-baseline-${out.meta.committedAt.replaceAll(':', '-')}.json`);
  fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  process.stdout.write(`\n=== EVIDENCE ===\n${file}\n`);
  section('summary', { evidenceFile: file, limitations: out.limitations });
})().catch(error => { process.stderr.write(`${error?.stack || error}\n`); process.exit(1); });
