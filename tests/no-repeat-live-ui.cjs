// Authenticated live browser QA for the round-local no-repeat contract.
// Real /api/discovery/blindbox over real HTTP against a real PostgreSQL fixture.
// Run: MEMENTO_NO_REPEAT_TARGET=deployed node tests/no-repeat-live-ui.cjs   (nginx 3091 + PM2 API 3092)
//      node tests/no-repeat-live-ui.cjs                                     (latest source + latest dist)
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
(async () => {
  require('dotenv').config({ path: '.env.local', quiet: true });
  const { pool, qschema, hashSession } = await import('../memento-db.mjs');
  assert.equal(process.env.DB_SCHEMA, 'memento_dev', 'live QA writes disposable rows, so it is DEV-only');
  const deployed = process.env.MEMENTO_NO_REPEAT_TARGET === 'deployed';
  // The deployed mode never starts a server of its own: it drives nginx -> PM2 as-is.
  const app = deployed ? null : (await import('../server.mjs')).app;
  const out = path.resolve('.hermes/evidence/no-repeat');
  fs.mkdirSync(out, { recursive: true });
  const report = { synthetic: false, target: deployed ? `deployed DEV via ${process.env.MEMENTO_DEPLOYED_URL || 'https://memento-dev.srv.io.vn'} (tunnel -> nginx 3091 -> PM2 API 3092)` : 'latest source app + latest dist', checks: [], blindbox: [], pageerrors: [], cleanup: false };
  const track = 'no-repeat-qa-track';
  const ownerIds = ['qa-round-1', 'qa-round-2', 'qa-round-3', 'qa-round-4'];
  const sharedId = 'qa-round-shared';
  const gone = 'Every memory, revisited';
  const users = ['owner', 'viewer', 'stranger'].map((role) => ({ role, id: crypto.randomUUID(), username: `qa_round_${role}_${crypto.randomBytes(6).toString('hex')}`, token: crypto.randomBytes(32).toString('hex') }));
  const [owner, viewer, stranger] = users;
  let api, web, browser; const contexts = [];
  const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', r));
  const close = (s) => s ? new Promise((r) => s.close(r)) : Promise.resolve();
  try {
    for (const u of users) {
      await pool.query(`INSERT INTO ${qschema}.users(id,username,password_hash) VALUES($1,$2,$3)`, [u.id, u.username, 'unused-qa-fixture']);
      await pool.query(`INSERT INTO ${qschema}.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')`, [hashSession(u.token), u.id]);
    }
    const doc = (id, title, eventId, extra = {}) => ({ id, eventId, title, description: extra.description ?? '', date: extra.date ?? '2026-02-02', tags: [], images: [], ...extra });
    const trackDoc = (id, title, color) => ({ id, title, description: '', color, icon: 'Heart', tags: [], createdAt: '2026-02-02', updatedAt: '2026-02-02' });
    await pool.query(`INSERT INTO ${qschema}.tracks(owner_id,id,document) VALUES($1,$2,$3)`, [owner.id, track, trackDoc(track, 'Round QA track', 'indigo')]);
    await pool.query(`INSERT INTO ${qschema}.tracks(owner_id,id,document) VALUES($1,$2,$3)`, [viewer.id, `${track}-viewer`, trackDoc(`${track}-viewer`, 'Viewer track', 'amber')]);
    await pool.query(`INSERT INTO ${qschema}.tracks(owner_id,id,document) VALUES($1,$2,$3)`, [stranger.id, `${track}-private`, trackDoc(`${track}-private`, 'Private track', 'stone')]);
    for (const [index, id] of ownerIds.entries()) {
      await pool.query(`INSERT INTO ${qschema}.moments(owner_id,id,event_id,document) VALUES($1,$2,$3,$4)`, [owner.id, id, track, doc(id, `Round memory ${index + 1}`, track, index === 3 ? { emotion: 'serene', description: 'Bình yên' } : {})]);
    }
    // The same id under another owner: only a composite identity may exclude it.
    await pool.query(`INSERT INTO ${qschema}.moments(owner_id,id,event_id,document) VALUES($1,$2,$3,$4)`, [viewer.id, sharedId, `${track}-viewer`, doc(sharedId, 'Viewer shared id', `${track}-viewer`)]);
    await pool.query(`INSERT INTO ${qschema}.moments(owner_id,id,event_id,document) VALUES($1,$2,$3,$4)`, [stranger.id, 'qa-round-private', `${track}-private`, doc('qa-round-private', 'Private memory', `${track}-private`)]);
    await pool.query(`INSERT INTO ${qschema}.track_collaborators(id,owner_id,track_id,recipient_id,role,expires_at,accepted_at) VALUES($1,$2,$3,$4,$5,now()+interval '7 days',now())`, [crypto.randomUUID(), owner.id, track, viewer.id, 'viewer']);
    let base;
    // The deployed smoke drives the real public DEV hostname so the browser's own
    // Origin matches the forwarded Host; loopback HTTP would be rejected by the app's
    // origin validation (nginx forwards X-Forwarded-Proto https), and that rule must
    // not be weakened for a harness.
    if (deployed) { base = process.env.MEMENTO_DEPLOYED_URL || 'https://memento-dev.srv.io.vn'; }
    else {
      api = http.createServer(app); await listen(api);
      web = http.createServer((req, res) => {
        if (req.url.startsWith('/api/') || req.url === '/health') {
          const upstream = http.request({ hostname: '127.0.0.1', port: api.address().port, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
          upstream.on('error', () => { res.statusCode = 502; res.end(); }); req.pipe(upstream); return;
        }
        let f = path.join(process.cwd(), 'dist', decodeURIComponent(req.url.split('?')[0]));
        if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(process.cwd(), 'dist/index.html');
        const ext = path.extname(f);
        res.setHeader('Content-Type', ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : 'text/html');
        res.end(fs.readFileSync(f));
      }); await listen(web); base = `http://127.0.0.1:${web.address().port}`;
    }
    const built = fs.readdirSync('dist/assets').filter((f) => /^index-.*\.js$/.test(f));
    report.dist_entry = `dist/assets/${built[0]}`;
    const served = deployed
      ? await fetch(`${base}/`).then((r) => r.text()).then((html) => html.match(/src="([^"]+\.js)"/)[1])
      : fs.readFileSync('dist/index.html', 'utf8').match(/src="([^"]+\.js)"/)[1];
    report.served_entry = served;
    assert.equal(path.basename(served), path.basename(report.dist_entry), 'the served bundle is the freshly built one');
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell', args: ['--no-sandbox'] });
    const open = async (page) => { await page.getByRole('button', { name: 'Memory actions', exact: true }).click(); await page.getByRole('button', { name: 'Open a random memory', exact: true }).click(); };
    const dialogOf = (page) => page.getByRole('dialog', { name: 'Blindbox memory' });
    const session = async (u, viewport) => {
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' }); contexts.push(context);
      if (u) await context.addCookies([{ name: 'memento_session', value: u.token, url: base, httpOnly: true, sameSite: 'Lax' }]);
      const page = await context.newPage();
      page.on('pageerror', (e) => report.pageerrors.push({ role: u ? u.role : 'anonymous', message: e.message }));
      page.on('request', (r) => { if (new URL(r.url()).pathname === '/api/discovery/blindbox') report.blindbox.push({ role: u ? u.role : 'anonymous', body: r.postDataJSON() }); });
      return { context, page };
    };
    const probe = async (u, body) => {
      const { context, page } = await session(u, { width: 390, height: 844 });
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      const result = await page.evaluate(async (payload) => { const r = await fetch('/api/discovery/blindbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); return { status: r.status, body: await r.text() }; }, body);
      await context.close();
      return result;
    };
    const part = async (u, viewport, expected) => {
      const { context, page } = await session(u, viewport);
      await page.goto(base, { waitUntil: 'networkidle' });
      await page.locator('[id^="event-card-"]').first().waitFor();
      await open(page);
      await dialogOf(page).locator('h3').first().waitFor({ timeout: 30000 });
      const found = [];
      for (let step = 0; step < 12; step++) {
        found.push((await dialogOf(page).locator('h3').first().innerText()).trim());
        await page.getByRole('button', { name: 'Another memory', exact: true }).click();
        await page.waitForFunction((previous) => {
          const d = document.querySelector('[role="dialog"]'); if (!d) return false;
          if (d.textContent.includes('Every memory, revisited')) return true;
          const h = d.querySelector('h3'); return !!h && h.textContent.trim() !== previous;
        }, found.at(-1), { timeout: 30000 });
        if (await page.getByRole('heading', { name: gone, exact: true }).count()) break;
      }
      assert.equal(await page.getByRole('heading', { name: gone, exact: true }).count(), 1, `${u.role}: the round ends on the completion scene`);
      assert.deepEqual([...found].sort(), [...expected].sort(), `${u.role}: revealed exactly the accessible memories`);
      assert.equal(new Set(found).size, found.length, `${u.role}: nothing is revealed twice`);
      assert.equal(await page.getByRole('button', { name: 'Another memory', exact: true }).count(), 0, `${u.role}: the repeat action is gone at exhaustion`);
      assert((await dialogOf(page).innerText()).includes("You've wandered through all your memories for now."), `${u.role}: completion copy`);
      const action = page.locator('#blindbox-completion').getByRole('button', { name: 'Close', exact: true });
      const box = await action.boundingBox();
      assert(box.width >= 44 && box.height >= 44, `${u.role}: completion hit target ${JSON.stringify(box)}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `${u.role}: no horizontal overflow`);
      await action.click();
      await dialogOf(page).waitFor({ state: 'detached' });
      const reveals = report.blindbox.filter((c) => c.role === u.role).length;
      await open(page);
      await page.getByRole('button', { name: 'Another memory', exact: true }).waitFor({ timeout: 30000 });
      const fresh = report.blindbox.filter((c) => c.role === u.role);
      assert.equal(fresh.at(-1).body.seen.length, 0, `${u.role}: reopening begins an empty round`);
      assert.equal(fresh.length, reveals + 1, `${u.role}: reopening starts one fresh reveal`);
      if (viewport.width > 500) await page.keyboard.press('Escape'); else await page.mouse.click(4, 4);
      await dialogOf(page).waitFor({ state: 'detached' });
      await context.close();
      return found;
    };
    const ownerFound = await part(owner, { width: 1200, height: 900 }, ownerIds.map((_, i) => `Round memory ${i + 1}`));
    const ownerCalls = report.blindbox.filter((c) => c.role === 'owner');
    assert.deepEqual(ownerCalls.slice(0, 5).map((c) => c.body.seen.length), [0, 1, 2, 3, 4], 'each live reveal carries the identities already displayed');
    assert(ownerCalls.every((c) => Array.isArray(c.body.seen) && c.body.seen.every((s) => Object.keys(s).length === 2 && typeof s.ownerId === 'string' && typeof s.id === 'string' && /^[0-9a-f-]{36}$/.test(s.ownerId))), 'live seen payloads are composite identities');
    assert.deepEqual([...ownerFound].sort(), ['Round memory 1', 'Round memory 2', 'Round memory 3', 'Round memory 4'], 'owner set');
    report.checks.push('Owner live round (1200px): the four owned memories revealed exactly once, completion scene, then a fresh empty round on reopen');
    const viewerFound = await part(viewer, { width: 390, height: 844 }, [...ownerIds.map((_, i) => `Round memory ${i + 1}`), 'Viewer shared id']);
    assert(viewerFound.includes('Viewer shared id'), 'a viewer-owned memory reusing an owner id is still revealed');
    report.checks.push('Viewer live round (390px): five accessible composite identities, including the duplicate id owned by the viewer, revealed exactly once');
    await part(stranger, { width: 390, height: 844 }, ['Private memory']);
    report.checks.push('Unrelated account (390px): reveals only its own memory, then completes');
    const ownerSeen = ownerIds.map((id) => ({ ownerId: owner.id, id }));
    const anonymous = await probe(null, { intent: 'surprise', query: '', seen: [] });
    assert.equal(anonymous.status, 401, 'the live route stays authenticated');
    const exhausted = await probe(owner, { intent: 'surprise', query: '', seen: ownerSeen });
    assert.equal(exhausted.status, 200); assert.equal(exhausted.body, 'null', 'a fully seen round answers JSON null, not an error');
    const moodSpent = await probe(owner, { intent: 'comfort', query: 'binh yen', seen: [{ ownerId: owner.id, id: 'qa-round-4' }] });
    const moodBody = JSON.parse(moodSpent.body);
    assert.equal(moodSpent.status, 200);
    assert.equal(moodBody.fallback, true, 'spending the mood matches still returns an unseen surprise');
    assert.notEqual(moodBody.event.id, 'qa-round-4');
    const composite = await probe(viewer, { intent: 'surprise', query: '', seen: ownerSeen });
    const compositeBody = JSON.parse(composite.body);
    assert.equal(compositeBody.event.id, sharedId, 'the viewer own duplicate id stays reachable while the owner id is seen');
    assert.equal(compositeBody.event.resourceOwnerId, viewer.id);
    const unrelated = await probe(stranger, { intent: 'comfort', query: 'binh yen', seen: ownerSeen });
    assert.equal(JSON.parse(unrelated.body).event.id, 'qa-round-private', 'an unrelated seen list hides nothing and exposes nothing');
    const widened = await probe(stranger, { intent: 'surprise', query: '', seen: [{ ownerId: owner.id, id: 'qa-round-1' }] });
    assert.equal(JSON.parse(widened.body).event.resourceOwnerId, stranger.id, 'a caller-supplied identity never widens access');
    const rejected = await probe(owner, { intent: 'surprise', query: '', seen: [{ ownerId: 'not-a-uuid', id: 'qa-round-1' }] });
    assert.equal(rejected.status, 400, 'a malformed identity is rejected');
    const oversized = await probe(owner, { intent: 'surprise', query: '', seen: Array.from({ length: 10001 }, (_, n) => ({ ownerId: owner.id, id: `x${n}` })) });
    assert.equal(oversized.status, 400, 'an over-long round is an explicit error, never a silent truncation');
    report.checks.push('Live HTTP: anonymous 401, exhaustion returns JSON null, mood fallback survives, composite identity holds across owners, a seen list never widens access, malformed and oversized payloads are 400');
    report.passed = true;
  } catch (e) { report.passed = false; report.error = e.stack; process.exitCode = 1; }
  finally {
    for (const c of contexts) await c.close().catch(() => {});
    if (browser) await browser.close();
    await close(web); await close(api);
    const ids = users.map((u) => u.id);
    await pool.query(`DELETE FROM ${qschema}.moments WHERE owner_id=ANY($1::uuid[])`, [ids]);
    await pool.query(`DELETE FROM ${qschema}.tracks WHERE owner_id=ANY($1::uuid[])`, [ids]);
    await pool.query(`DELETE FROM ${qschema}.track_collaborators WHERE owner_id=ANY($1::uuid[]) OR recipient_id=ANY($1::uuid[])`, [ids]);
    await pool.query(`DELETE FROM ${qschema}.sessions WHERE user_id=ANY($1::uuid[])`, [ids]);
    await pool.query(`DELETE FROM ${qschema}.users WHERE id=ANY($1::uuid[])`, [ids]);
    const left = await pool.query(`SELECT (SELECT count(*) FROM ${qschema}.users WHERE id=ANY($1::uuid[]))::int u,(SELECT count(*) FROM ${qschema}.moments WHERE owner_id=ANY($1::uuid[]))::int m,(SELECT count(*) FROM ${qschema}.tracks WHERE owner_id=ANY($1::uuid[]))::int t,(SELECT count(*) FROM ${qschema}.sessions WHERE user_id=ANY($1::uuid[]))::int s`, [ids]);
    report.cleanup = left.rows[0].u === 0 && left.rows[0].m === 0 && left.rows[0].t === 0 && left.rows[0].s === 0;
    report.rows_left = left.rows[0];
    report.ownedServersStopped = (!web || !web.listening) && (!api || !api.listening);
    report.blindbox = report.blindbox.map((c) => ({ role: c.role, intent: c.body.intent, query: c.body.query, seen: c.body.seen.length }));
    await pool.end();
    fs.writeFileSync(path.join(out, `live-round-results${deployed ? '-deployed' : ''}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
