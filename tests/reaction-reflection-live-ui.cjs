// Authenticated DEV PostgreSQL browser journey for reaction/reflection UX. No synthetic API responses or R2.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
(async () => {
  require('dotenv').config({ path: '.env.local', quiet: true });
  assert.equal(process.env.DB_SCHEMA, 'memento_dev');
  const { pool, qschema, hashSession } = await import('../memento-db.mjs');
  const out = path.resolve('.hermes/evidence/reaction-reflection-live'); fs.mkdirSync(out, { recursive: true });
  const report = { synthetic: false, scope: 'Authenticated Chromium through deployed DEV hostname/nginx/PM2 against DEV PostgreSQL; disposable user/track/moment/perspective/reaction; no R2.', checks: [], requests: [], pageerrors: [], cleanup: false };
  const owner = { id: crypto.randomUUID(), username: `qa_reaction_${crypto.randomBytes(6).toString('hex')}`, token: crypto.randomBytes(32).toString('hex') };
  const track = `qa_track_${crypto.randomBytes(6).toString('hex')}`;
  const moment = `qa_moment_${crypto.randomBytes(6).toString('hex')}`;
  let browser;
  const contexts = [];
  try {
    await pool.query(`INSERT INTO ${qschema}.users(id,username,password_hash) VALUES($1,$2,$3)`, [owner.id, owner.username, 'unused-qa-fixture']);
    await pool.query(`INSERT INTO ${qschema}.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')`, [hashSession(owner.token), owner.id]);
    const trackDoc = { id: track, title: 'Reaction live QA', description: 'Temporary fixture', color: 'indigo', icon: 'Heart', tags: [], createdAt: '2026-10-15', updatedAt: '2026-10-15' };
    await pool.query(`INSERT INTO ${qschema}.tracks(owner_id,id,document) VALUES($1,$2,$3)`, [owner.id, track, trackDoc]);
    const momentDoc = { id: moment, resourceOwnerId: owner.id, eventId: track, title: 'Reaction reflection live QA', date: '2026-10-15', time: null, description: 'Original content remains unchanged.', idea: null, location: null, tags: [], images: [], emotion: 'joy', emotionIntensity: 2, isMilestone: false, version: 1, createdAt: '2026-10-15', updatedAt: '2026-10-15' };
    await pool.query(`INSERT INTO ${qschema}.moments(owner_id,id,event_id,document) VALUES($1,$2,$3,$4)`, [owner.id, moment, track, momentDoc]);
    const base = 'https://memento-dev.srv.io.vn';
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell', args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' }); contexts.push(context);
    await context.addCookies([{ name: 'memento_session', value: owner.token, url: base, httpOnly: true, sameSite: 'Lax', secure: true }]);
    const page = await context.newPage(); page.on('pageerror', error => report.pageerrors.push(error.message));
    page.on('response', response => { const url = new URL(response.url()); if (url.pathname.startsWith('/api/')) report.requests.push({ method: response.request().method(), path: url.pathname, status: response.status() }); });
    await page.goto(base);
    await page.locator(`[id="event-card-${owner.id}:${moment}"]`).waitFor();
    await page.locator(`[id="event-card-${owner.id}:${moment}"] h3`).click();
    const detail = page.locator('#event-detail-card'); await detail.waitFor();
    const react = detail.getByRole('button', { name: /React ❤️/ });
    const start = Date.now(); await react.click();
    await page.waitForFunction(() => [...document.querySelectorAll('#event-detail-card button[aria-label^="React ❤️"]')].some(button => button.getAttribute('aria-pressed') === 'true'));
    const paintMs = Date.now() - start; assert(paintMs < 1000, `optimistic paint exceeded 1s: ${paintMs}ms`);
    await page.waitForFunction(() => !document.querySelector('#event-detail-card button[aria-label^="React ❤️"]')?.disabled);
    assert.equal(await react.getAttribute('aria-pressed'), 'true');
    const reflection = detail.getByRole('button', { name: 'Bây giờ nghĩ lại…', exact: true }); await reflection.click();
    const composer = page.getByRole('dialog', { name: 'Bây giờ nghĩ lại…' }); await composer.waitFor();
    const textarea = composer.locator('textarea'); await textarea.waitFor(); await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA'); assert.equal(await textarea.evaluate(el => document.activeElement === el), true);
    await textarea.fill('Verified reflection on DEV'); await composer.getByRole('button', { name: 'Save', exact: true }).click();
    await detail.locator('ol li').filter({ hasText: 'Verified reflection on DEV' }).waitFor();
    assert.equal((await detail.locator('h1').innerText()).trim(), 'Reaction reflection live QA');
    assert.equal((await detail.locator('h1').innerText()).trim(), momentDoc.title, 'original title unchanged');
    const dbReaction = await pool.query(`SELECT emoji FROM ${qschema}.moment_reactions WHERE user_id=$1 AND moment_owner_id=$2 AND moment_id=$3`, [owner.id, owner.id, moment]);
    assert.equal(dbReaction.rowCount, 1);
    const dbPerspective = await pool.query(`SELECT kind,body FROM ${qschema}.moment_perspectives WHERE moment_owner_id=$1 AND moment_id=$2 AND author_id=$3`, [owner.id, moment, owner.id]);
    assert.equal(dbPerspective.rowCount, 1); assert.equal(dbPerspective.rows[0].kind, 'reflection'); assert.equal(dbPerspective.rows[0].body, 'Verified reflection on DEV');
    report.checks.push(`real DEV reaction row persisted; optimistic click painted in ${paintMs}ms`);
    report.checks.push('real DEV reflection saved through authenticated API and PostgreSQL; source story unchanged; composer focused');
    assert.deepEqual(report.pageerrors, []); report.passed = true;
  } catch (error) { report.passed = false; report.error = error.stack; process.exitCode = 1; }
  finally {
    for (const context of contexts) await context.close().catch(() => {});
    if (browser) await browser.close();
    if (owner.id) await pool.query(`DELETE FROM ${qschema}.users WHERE id=$1`, [owner.id]);
    const count = await pool.query(`SELECT count(*)::int AS count FROM ${qschema}.users WHERE id=$1`, [owner.id]); report.cleanup = count.rows[0].count === 0;
    assert.equal(report.cleanup, true, 'temporary user cascades deleted');
    await pool.end(); fs.writeFileSync(path.join(out, 'live-results.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
