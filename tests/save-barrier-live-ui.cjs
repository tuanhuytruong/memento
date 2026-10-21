// Save barriers for a new entry with a photo, on the deployed DEV build.
//
// The moment write, the photo upload and the feed reconciliation are held one at a
// time with Playwright route interception, so the narrated progress, the blocked
// dismissal, the preserved Idempotency-Key and the retry after a failed photo can all
// be observed in a real browser. The photo body is a generated fixture.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const base = process.env.MEMENTO_DEV_BASE || 'https://memento-dev.srv.io.vn';

(async () => {
  require('dotenv').config({ path: '.env.local', quiet: true });
  const { pool, qschema, hashSession } = await import('../memento-db.mjs');
  assert.equal(process.env.DB_SCHEMA, 'memento_dev', 'this harness only targets DEV');

  const out = path.resolve(process.env.MEMENTO_UI_ARTIFACTS || '.hermes/evidence/save-barrier');
  fs.mkdirSync(out, { recursive: true });
  const report = { syntheticPhotos: true, base, checks: [], uploads: [], responses: [], trail: [], pageerrors: [], cleanup: false };
  const check = (label) => { report.checks.push(label); console.log('CHECK', label); };

  const photo = await require('sharp')({ create: { width: 1200, height: 1600, channels: 3, background: { r: 168, g: 158, b: 200 } } })
    .jpeg({ quality: 92 }).toBuffer();

  const owner = { id: crypto.randomUUID(), username: `qa_barrier_${crypto.randomBytes(5).toString('hex')}`, token: crypto.randomBytes(32).toString('hex') };
  const track = 'qa-barrier';
  let browser;
  let page;
  try {
    const passwordHash = await require('bcryptjs').hash(crypto.randomBytes(18).toString('hex'), 12);
    await pool.query(`INSERT INTO ${qschema}.users(id,username,password_hash) VALUES($1,$2,$3)`, [owner.id, owner.username, passwordHash]);
    await pool.query(`INSERT INTO ${qschema}.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')`, [hashSession(owner.token), owner.id]);
    await pool.query(`INSERT INTO ${qschema}.tracks(owner_id,id,document) VALUES($1,$2,$3)`, [owner.id, track, {
      id: track, title: 'QA barrier', description: 'Temporary authenticated browser metadata', color: 'indigo', icon: 'Heart', tags: [], createdAt: '2026-10-20', updatedAt: '2026-10-20',
    }]);

    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell',
      args: ['--no-sandbox'],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'memento_session', value: owner.token, url: base, httpOnly: true, sameSite: 'Lax' }]);
    page = await context.newPage();
    page.on('pageerror', (error) => report.pageerrors.push(error.message));
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith('/api/')) report.trail.push(`${request.method()} ${pathname}`);
    });
    page.on('response', (response) => {
      const pathname = new URL(response.url()).pathname;
      if (response.request().method() !== 'POST' || (pathname !== '/api/images' && pathname !== '/api/moments')) return;
      response.allHeaders().then((headers) => {
        report.responses.push({ pathname, status: response.status(), serverTiming: headers['server-timing'] || null, diagnosticId: headers['x-upload-diagnostic-id'] || null });
      }).catch(() => {});
    });

    const armed = new Set();
    const held = { write: [], image: [], query: [] };
    let failNextImage = false;
    const hold = (kind) => armed.add(kind);
    const disarm = (kind) => armed.delete(kind);
    const heldCount = (kind) => held[kind].length;

    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const method = request.method();
      if (pathname.startsWith('/api/images/') && method === 'GET') return route.fulfill({ status: 200, contentType: 'image/jpeg', body: photo });
      const kind = method === 'POST' && pathname === '/api/moments' ? 'write'
        : method === 'POST' && pathname === '/api/images' ? 'image'
        : method === 'POST' && pathname === '/api/moments/query' ? 'query' : null;
      if (!kind) return route.continue();
      if (kind === 'image') report.uploads.push({ key: request.headers()['idempotency-key'] || null, bytes: (request.postDataBuffer() || Buffer.alloc(0)).length });
      if (kind === 'image' && failNextImage) {
        failNextImage = false;
        report.uploads.at(-1).outcome = 'failed-by-fixture';
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'fixture upload failure' }) });
      }
      if (!armed.has(kind)) { if (kind === 'image') report.uploads.at(-1).outcome = 'passed'; return route.continue(); }
      if (kind === 'image') report.uploads.at(-1).outcome = 'held';
      await new Promise((resolve) => held[kind].push({ route, resolve }));
    });

    const release = async (kind) => {
      const next = held[kind].shift();
      assert.ok(next, `no held ${kind} request to release`);
      const done = next.route.continue();
      next.resolve();
      await done.catch(() => {});
    };
    // A progress phase is announced before its fetch leaves, so wait for the arrival.
    const waitHeld = async (kind) => {
      for (let attempt = 0; attempt < 300; attempt += 1) {
        if (held[kind].length) return;
        await page.waitForTimeout(50);
      }
      throw new Error(`no held ${kind} request arrived; trail ${report.trail.slice(-12).join(' -> ')}`);
    };

    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.innerText.includes('QA barrier'));

    const dialog = page.getByRole('dialog', { name: 'New memory' });
    await page.locator('#floating-memory-actions').click();
    await page.locator('#memory-actions').getByRole('button', { name: 'New entry', exact: true }).click();
    await dialog.waitFor({ state: 'visible' });
    await dialog.locator('#event-title-input').fill('QA barrier photo save');
    await dialog.locator('input[type="file"]').setInputFiles([{ name: 'qa-barrier-1.jpg', mimeType: 'image/jpeg', buffer: photo }]);
    await page.waitForFunction(() => {
      const node = document.querySelector('[role="dialog"][aria-label="New memory"]');
      return !!node && node.querySelectorAll('button[aria-label="Remove image"]').length === 1;
    }, null, { timeout: 20000 });
    check('composer: the prepared photo is attached before saving');

    const progress = dialog.getByRole('status').filter({ hasText: /Holding on|Gathering|Placing|Giving/ }).first();
    const saveButton = dialog.locator('#save-event-button');
    const cancelButton = dialog.locator('#cancel-event-button');
    const closeButton = dialog.locator('button[aria-label="Close memory composer"]');
    await page.waitForFunction(() => {
      const button = document.querySelector('#save-event-button');
      return !!button && !button.disabled && button.textContent.includes('Add to Timeline');
    }, null, { timeout: 20000 });

    // Barrier 1: the moment write is in flight. The photo queue is armed too, so the
    // upload cannot slip past while the write is held.
    hold('write');
    hold('image');
    await saveButton.click();
    await progress.getByText('Holding on to this moment…').waitFor({ state: 'visible' });
    await waitHeld('write');
    assert.equal(await dialog.isVisible(), true, 'the composer must stay open during the write');
    assert.equal(await saveButton.isDisabled(), true, 'a second save must be blocked while saving');
    assert.equal(await cancelButton.isDisabled(), true, 'Cancel must be blocked while saving');
    assert.equal(await closeButton.isDisabled(), true, 'the close control must be blocked while saving');
    assert.equal(heldCount('write'), 1, 'exactly one moment write is in flight');
    await page.screenshot({ path: path.join(out, 'barrier-1-writing.png') });
    check('barrier writing: narrated progress, composer open, duplicate save and every dismissal control disabled');
    await release('write');
    disarm('write');

    // Barrier 2: the photo upload is in flight.
    await progress.getByText('Placing each photo with care…').waitFor({ state: 'visible', timeout: 20000 });
    await dialog.getByText(/Placing photo 1 of 1 with care…/).waitFor({ state: 'visible', timeout: 20000 });
    await waitHeld('image');
    assert.equal(await dialog.isVisible(), true, 'the composer must stay open during the upload');
    assert.equal(await closeButton.isDisabled(), true, 'dismissal stays blocked during the upload');
    const firstKey = report.uploads[0].key;
    assert.ok(firstKey, 'the upload carried an Idempotency-Key');
    await page.screenshot({ path: path.join(out, 'barrier-2-photo-upload.png') });
    check('barrier photo: the composer narrates "Placing photo 1 of 1" and blocks dismissal');

    // After the photo is acknowledged the app must reconcile the feed before closing.
    await release('image');
    disarm('image');
    await dialog.waitFor({ state: 'detached', timeout: 30000 }).catch(async () => {
      await page.screenshot({ path: path.join(out, 'barrier-3-stuck.png') });
      throw new Error('the composer never closed after the photo upload completed');
    });
    const imageIndex = report.trail.indexOf('POST /api/images');
    const reconcileIndex = report.trail.lastIndexOf('POST /api/moments/query');
    assert.ok(imageIndex >= 0 && reconcileIndex > imageIndex, `the feed must be reconciled after the upload: ${report.trail.join(' -> ')}`);
    const card = page.locator('[id^="event-card-"]').filter({ hasText: 'QA barrier photo save' }).first();
    await card.waitFor({ state: 'visible' });
    await card.locator('img').first().waitFor({ state: 'visible', timeout: 15000 });
    await page.screenshot({ path: path.join(out, 'barrier-3-reconciled.png') });
    check('completion: the composer closes after the upload and the feed reconciliation, and the card shows the photo');

    const stored = await pool.query(`SELECT count(*)::int AS images FROM ${qschema}.images WHERE owner_id=$1`, [owner.id]);
    const moments = await pool.query(`SELECT id FROM ${qschema}.moments WHERE owner_id=$1 AND event_id=$2`, [owner.id, track]);
    assert.equal(stored.rows[0].images, 1, `expected 1 stored image, found ${stored.rows[0].images}`);
    assert.equal(moments.rowCount, 1, 'the blocked duplicate save must not create a second moment');
    check('stored state: one moment with one private image');

    // Phase 2: an upload that fails on arrival must surface a retry that keeps its key.
    const uploadsBeforeFailure = report.uploads.length;
    failNextImage = true;
    const retryDialog = page.getByRole('dialog', { name: 'New memory' });
    await page.locator('#floating-memory-actions').click();
    await page.locator('#memory-actions').getByRole('button', { name: 'New entry', exact: true }).click();
    await retryDialog.waitFor({ state: 'visible' });
    await retryDialog.locator('#event-title-input').fill('QA barrier failed photo');
    await retryDialog.locator('input[type="file"]').setInputFiles([{ name: 'qa-barrier-2.jpg', mimeType: 'image/jpeg', buffer: photo }]);
    await page.waitForFunction(() => {
      const node = document.querySelector('[role="dialog"][aria-label="New memory"]');
      return !!node && node.querySelectorAll('button[aria-label="Remove image"]').length === 1;
    }, null, { timeout: 20000 });
    await page.waitForFunction(() => {
      const button = document.querySelector('#save-event-button');
      return !!button && !button.disabled;
    }, null, { timeout: 20000 });
    await retryDialog.locator('#save-event-button').click();

    const retryButton = retryDialog.locator('#retry-save-event');
    await retryButton.waitFor({ state: 'visible', timeout: 25000 });
    assert.match(await retryDialog.getByRole('alert').first().innerText(), /retry/i);
    assert.equal(await page.locator('[id^="event-card-"]').filter({ hasText: 'QA barrier failed photo' }).count(), 0, 'a failed upload must not claim completion');
    assert.equal(await retryDialog.isVisible(), true, 'the composer stays open after a failed photo');
    const failedUpload = report.uploads[uploadsBeforeFailure];
    assert.equal(failedUpload.outcome, 'failed-by-fixture');
    await page.screenshot({ path: path.join(out, 'barrier-4-photo-failed.png') });
    check('barrier failure: a failed photo keeps the composer open with a retry control and no premature completion');

    await retryButton.click();
    await retryDialog.waitFor({ state: 'detached', timeout: 30000 });
    const attempts = report.uploads.slice(uploadsBeforeFailure);
    assert.equal(attempts.length, 2, `expected a failed attempt and one retry, saw ${attempts.length}`);
    assert.equal(attempts[0].outcome, 'failed-by-fixture');
    assert.equal(attempts[1].key, attempts[0].key, 'the retry must reuse the same Idempotency-Key');
    const afterRetry = await pool.query(`SELECT count(*)::int AS images FROM ${qschema}.images WHERE owner_id=$1`, [owner.id]);
    assert.equal(afterRetry.rows[0].images, 2, `expected one stored image per moment, found ${afterRetry.rows[0].images}`);
    await page.locator('[id^="event-card-"]').filter({ hasText: 'QA barrier failed photo' }).first().waitFor({ state: 'visible' });
    check(`idempotency: the failed photo retried with its original key ${attempts[0].key.slice(0, 8)}… and stored exactly once`);

    const timed = report.responses.filter((response) => response.pathname === '/api/images' && response.status < 300);
    assert.ok(timed.length >= 1, 'the upload returned a success response');
    for (const response of timed) {
      assert.match(response.serverTiming || '', /up-total;dur=/, `every successful upload reports up-total: ${JSON.stringify(response)}`);
      assert.ok(response.diagnosticId, 'every upload returns an opaque diagnostic id');
      for (const metric of response.serverTiming.split(',')) {
        const label = metric.split(';')[0].trim();
        if (!label || label === 'cfExtPri') continue;
        assert.match(label, /^up-(auth|admission|body|preflight|transform|staging|r2_original|r2_thumb|r2_display|r2\.original|r2\.thumb|r2\.display|commit|respond|total)$/, `unexpected stage label ${label}`);
      }
    }
    check(`diagnostics: upload responses expose closed stage labels only — ${timed[0].serverTiming}`);

    assert.equal(report.pageerrors.length, 0, `page errors: ${JSON.stringify(report.pageerrors)}`);
    check('no browser page errors during the full save barrier journey');
  } catch (error) {
    try {
      if (page) {
        await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
        const text = await page.getByRole('dialog').first().innerText().catch(() => '<no dialog>');
        console.error('DIALOG', text.replace(/\n+/g, ' | ').slice(0, 500));
        console.error('TRAIL', report.trail.slice(-16).join(' -> '));
      }
    } catch {}
    throw error;
  } finally {
    if (browser) await browser.close().catch(() => {});
    try {
      await pool.query(`DELETE FROM ${qschema}.users WHERE id=$1`, [owner.id]);
      const remaining = await pool.query(`SELECT (SELECT count(*) FROM ${qschema}.moments WHERE owner_id=$1) AS moments, (SELECT count(*) FROM ${qschema}.images WHERE owner_id=$1) AS images`, [owner.id]);
      report.cleanup = Number(remaining.rows[0].moments) === 0 && Number(remaining.rows[0].images) === 0;
      assert.equal(report.cleanup, true, 'disposable rows must be gone');
      check('cleanup: disposable user, track, moment and image rows removed from DEV');
    } finally {
      fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
      await pool.end().catch(() => {});
    }
  }
  console.log(`\nSAVE BARRIER: ${report.checks.length} checks passed`);
})().catch((error) => { console.error('SAVE BARRIER FAILED:', error.message); process.exitCode = 1; });
