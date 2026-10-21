// Local-first photos on the deployed DEV build.
//
// The incident this covers: a photo upload stalls after the moment is already saved
// (the owner switched apps on Chrome iOS). The photo must stay on the device, show on
// its card immediately, resume by itself on the next open with the same
// Idempotency-Key, and land exactly once. A repeat visit must not re-download the
// variants, and a photo that failed must never trap the next save.
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

  const out = path.resolve(process.env.MEMENTO_UI_ARTIFACTS || '.hermes/evidence/local-photo-first');
  fs.mkdirSync(out, { recursive: true });
  const report = { base, checks: [], uploads: [], imageReads: [], trail: [], pageerrors: [], cleanup: false };
  const check = (label) => { report.checks.push(label); console.log('CHECK', label); };

  // A patterned fixture, so a local preview is visibly a photo and not a colour block.
  const fixtureSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440">
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1d3557"/><stop offset="55%" stop-color="#457b9d"/><stop offset="100%" stop-color="#e9c46a"/>
    </linearGradient></defs>
    <rect width="1080" height="1440" fill="url(#sky)"/>
    <circle cx="820" cy="300" r="150" fill="#f4a261" opacity="0.9"/>
    <path d="M0 1130 L300 900 L560 1120 L820 880 L1080 1080 L1080 1440 L0 1440 Z" fill="#14213d" opacity="0.92"/>
    <rect x="70" y="70" width="380" height="70" rx="16" fill="#ffffff" opacity="0.55"/>
  </svg>`;
  const photo = await require('sharp')(Buffer.from(fixtureSvg)).jpeg({ quality: 90 }).toBuffer();

  const owner = { id: crypto.randomUUID(), username: `qa_local_${crypto.randomBytes(5).toString('hex')}`, token: crypto.randomBytes(32).toString('hex') };
  const track = 'qa-local-first';
  let browser;
  let page;
  try {
    const passwordHash = await require('bcryptjs').hash(crypto.randomBytes(18).toString('hex'), 12);
    await pool.query(`INSERT INTO ${qschema}.users(id,username,password_hash) VALUES($1,$2,$3)`, [owner.id, owner.username, passwordHash]);
    await pool.query(`INSERT INTO ${qschema}.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '2 hours')`, [hashSession(owner.token), owner.id]);
    await pool.query(`INSERT INTO ${qschema}.tracks(owner_id,id,document) VALUES($1,$2,$3)`, [owner.id, track, {
      id: track, title: 'QA local first', description: 'Temporary authenticated browser metadata', color: 'sky', icon: 'Heart', tags: [], createdAt: '2026-10-20', updatedAt: '2026-10-20',
    }]);

    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell',
      args: ['--no-sandbox'],
    });
    const context = await browser.newContext({ viewport: { width: 430, height: 900 }, reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'memento_session', value: owner.token, url: base, httpOnly: true, sameSite: 'Lax' }]);
    page = await context.newPage();
    page.on('pageerror', (error) => report.pageerrors.push(error.message));
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith('/api/')) report.trail.push(`${request.method()} ${pathname}`);
      if (request.method() === 'GET' && pathname.startsWith('/api/images/')) report.imageReads.push(pathname);
    });

    // One gate for the upload POST: closed means "the network swallowed it", exactly
    // like a suspended tab. Failed uploads are driven separately by a fixture 500.
    let holdImage = false;
    const heldImages = [];
    let failNextImage = false;
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const method = request.method();
      if (method !== 'POST' || pathname !== '/api/images') return route.continue();
      const entry = { key: request.headers()['idempotency-key'] || null, bytes: (request.postDataBuffer() || Buffer.alloc(0)).length, outcome: 'passed' };
      report.uploads.push(entry);
      if (failNextImage) {
        failNextImage = false;
        entry.outcome = 'failed-by-fixture';
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'fixture upload failure' }) });
      }
      if (!holdImage) return route.continue();
      entry.outcome = 'held';
      await new Promise((resolve) => heldImages.push({ route, resolve }));
    });
    const releaseHeldImages = async () => {
      for (const held of heldImages.splice(0)) {
        await held.route.continue().catch(() => {});
        held.resolve();
      }
    };
    const waitHeldImage = async (label) => {
      for (let attempt = 0; attempt < 300; attempt += 1) {
        if (heldImages.length) return;
        await page.waitForTimeout(50);
      }
      throw new Error(`no held upload arrived for ${label}; trail ${report.trail.slice(-12).join(' -> ')}`);
    };

    const cardFor = (title) => page.locator('[id^="event-card-"]').filter({ hasText: title }).first();
    const openComposer = async () => {
      await page.locator('#floating-memory-actions').click();
      await page.locator('#memory-actions').getByRole('button', { name: 'New entry', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'New memory' });
      await dialog.waitFor({ state: 'visible' });
      return dialog;
    };
    const attachPhoto = async (dialog, title, fileName) => {
      await dialog.locator('#event-title-input').fill(title);
      await dialog.locator('input[type="file"]').setInputFiles([{ name: fileName, mimeType: 'image/jpeg', buffer: photo }]);
      await page.waitForFunction(() => {
        const node = document.querySelector('[role="dialog"][aria-label="New memory"]');
        return !!node && node.querySelectorAll('button[aria-label="Remove image"]').length === 1;
      }, null, { timeout: 20000 });
    };
    const waitSaveEnabled = () => page.waitForFunction(() => {
      const button = document.querySelector('#save-event-button');
      return !!button && !button.disabled;
    }, null, { timeout: 20000 });

    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.innerText.includes('QA local first'));

    /* ---------------- stage 1: the photo survives the app being switched away ---------------- */
    holdImage = true;
    const dialog = await openComposer();
    await attachPhoto(dialog, 'QA local resume', 'qa-local-1.jpg');
    await waitSaveEnabled();
    await dialog.locator('#save-event-button').click();
    await waitHeldImage('the first save');
    const pendingUpload = report.uploads.at(-1);
    assert.ok(pendingUpload.key, 'the first attempt carried an Idempotency-Key');
    check('first save: the moment write completed and the upload is in flight under its own idempotency key');

    // Leaving the tab is what the owner did on iOS. The browser drops the request; the
    // moment row is already stored, so only the photo is still owed.
    await releaseHeldImages();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.innerText.includes('QA local first'));

    const resumed = async () => {
      for (let attempt = 0; attempt < 400; attempt += 1) {
        const match = report.uploads.find((entry, index) => index > 0 && entry.key === pendingUpload.key);
        if (match) return match;
        await page.waitForTimeout(50);
      }
      return null;
    };
    const resumeEntry = await resumed();
    assert.ok(resumeEntry, `the pending photo must resume after the reload; trail ${report.trail.slice(-12).join(' -> ')}`);
    check(`resume: reopening the app re-sent the same upload (key ${pendingUpload.key.slice(0, 8)}…) instead of losing the photo`);

    const resumeCard = cardFor('QA local resume');
    await resumeCard.waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForFunction(() => {
      const card = [...document.querySelectorAll('[id^="event-card-"]')].find((node) => node.innerText.includes('QA local resume'));
      return !!card && !!card.querySelector('img[src^="blob:"]');
    }, null, { timeout: 20000 });
    check('local-first: the card paints the photo from the device while the upload is still in flight');

    const chip = resumeCard.getByRole('status').filter({ hasText: /Photo (queued|not sent yet)|Uploading photo/ }).first();
    await chip.waitFor({ state: 'visible', timeout: 15000 });
    const chipText = (await chip.innerText()).trim();
    assert.match(chipText, /Photo|Uploading/, `the chip must state the real state, saw ${chipText}`);
    check(`honesty: the pending photo carries the chip "${chipText}" instead of claiming it is saved`);
    await resumeCard.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, 'resume-pending-photo.png') });
    await resumeCard.screenshot({ path: path.join(out, 'resume-pending-card.png') });

    await releaseHeldImages();
    await page.waitForFunction(() => {
      const card = [...document.querySelectorAll('[id^="event-card-"]')].find((node) => node.innerText.includes('QA local resume'));
      if (!card) return false;
      const chipNode = [...card.querySelectorAll('[role="status"]')].find((node) => /Photo (queued|not sent yet)|Uploading photo/.test(node.innerText));
      return !chipNode;
    }, null, { timeout: 40000 });
    check('completion: the chip disappears only once the server acknowledged the photo');

    const storedImages = await pool.query(`SELECT count(*)::int AS images FROM ${qschema}.images WHERE owner_id=$1`, [owner.id]);
    assert.equal(storedImages.rows[0].images, 1, `the resumed photo must be stored exactly once, found ${storedImages.rows[0].images}`);
    check('idempotency: the resumed upload stored exactly one image row');

    /* ---------------- stage 2: a repeat visit reads the cache ---------------- */
    await resumeCard.locator('img').first().waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const card = [...document.querySelectorAll('[id^="event-card-"]')].find((node) => node.innerText.includes('QA local resume'));
      const image = card && card.querySelector('img');
      return !!image && image.complete && image.naturalWidth > 0;
    }, null, { timeout: 20000 });
    const readsBefore = report.imageReads.length;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const card = [...document.querySelectorAll('[id^="event-card-"]')].find((node) => node.innerText.includes('QA local resume'));
      const image = card && card.querySelector('img');
      return !!image && image.complete && image.naturalWidth > 0;
    }, null, { timeout: 25000 });
    const readsAfter = report.imageReads.length - readsBefore;
    assert.equal(readsAfter, 0, `a repeat visit must not re-download cached variants, saw ${readsAfter} request(s): ${report.imageReads.slice(-4).join(', ')}`);
    check('cache: the second visit renders the photo with zero /api/images requests');
    await page.screenshot({ path: path.join(out, 'cache-hit-reload.png') });

    /* ---------------- stage 3: a failed photo never traps the next save ---------------- */
    // From here the network behaves: only the fixture rejection may stop a photo.
    holdImage = false;
    await releaseHeldImages();
    failNextImage = true;
    const failing = await openComposer();
    await attachPhoto(failing, 'QA local failed', 'qa-local-2.jpg');
    await waitSaveEnabled();
    await failing.locator('#save-event-button').click();
    await failing.locator('#retry-save-event').waitFor({ state: 'visible', timeout: 30000 });
    check('failure: an upload rejected by the server keeps the composer open with a retry control');

    // Dismissing the composer must leave the photo owed, not lost: the app-level banner
    // is the way back, and the next save is not blocked by the dead attempt.
    await failing.locator('#cancel-event-button').click();
    // Closing a composer with text in it asks about the draft first.
    const discard = page.getByRole('button', { name: 'Discard changes' }).first();
    await page.waitForFunction(() => {
      const guard = [...document.querySelectorAll('button')].some((node) => node.textContent === 'Discard changes');
      return guard || !document.querySelector('#event-modal-backdrop');
    }, null, { timeout: 15000 });
    if (await discard.isVisible().catch(() => false)) await discard.click();
    await failing.waitFor({ state: 'detached', timeout: 20000 });
    const banner = page.getByRole('button', { name: 'Retry photo upload' }).first();
    await banner.waitFor({ state: 'visible', timeout: 20000 });
    assert.equal(await page.getByText('Finish or retry the previous photo upload').count(), 0, 'the old blocking banner must be gone');
    check('recovery: the owed photo surfaces as a wearable banner instead of a blocking error');
    await page.screenshot({ path: path.join(out, 'banner-retry-photo.png') });

    await banner.click();
    await page.waitForFunction(() => {
      const card = [...document.querySelectorAll('[id^="event-card-"]')].find((node) => node.innerText.includes('QA local failed'));
      const image = card && card.querySelector('img');
      return !!image && image.complete && image.naturalWidth > 0;
    }, null, { timeout: 40000 });
    const failedUploads = report.uploads.filter((entry) => entry.key && entry.outcome === 'failed-by-fixture');
    assert.equal(failedUploads.length, 1, 'exactly one fixture failure was injected');
    const retried = report.uploads.filter((entry) => entry.key === failedUploads[0].key);
    assert.equal(retried.length, 2, `the retry must reuse the same key, saw ${retried.length} attempts`);
    assert.equal(await page.getByRole('button', { name: 'Retry photo upload' }).count(), 0, 'the banner clears once nothing is owed');
    check('retry: the banner retry reused the original idempotency key and cleared itself');
    await page.screenshot({ path: path.join(out, 'failed-photo-recovered.png') });

    const totals = await pool.query(`SELECT count(*)::int AS images FROM ${qschema}.images WHERE owner_id=$1`, [owner.id]);
    assert.equal(totals.rows[0].images, 2, `two moments, two photos, no duplicates: found ${totals.rows[0].images}`);
    check('stored state: two moments hold exactly two photos after a stall and a failure');

    assert.equal(report.pageerrors.length, 0, `page errors: ${JSON.stringify(report.pageerrors)}`);
    check('no browser page errors across the local-first journey');
  } catch (error) {
    try {
      if (page) {
        await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
        console.error('TRAIL', report.trail.slice(-18).join(' -> '));
        console.error('UPLOADS', JSON.stringify(report.uploads));
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
  console.log(`\nLOCAL FIRST: ${report.checks.length} checks passed`);
})().catch((error) => { console.error('LOCAL FIRST FAILED:', error.message); process.exitCode = 1; });
