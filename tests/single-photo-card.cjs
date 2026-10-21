// Single-photo timeline card: real browser, real DEV bundle, synthetic photo bytes.
//
// Geometry, variant selection, keyboard access and the failed-photo placeholder are
// asserted here. Photo bodies are generated fixtures served through route
// interception, so nothing is written to R2 and no user content is read.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FIXTURES = {
  portrait: { width: 1200, height: 1600, color: { r: 170, g: 160, b: 205 } },
  landscape: { width: 1600, height: 1200, color: { r: 150, g: 190, b: 170 } },
  square: { width: 1400, height: 1400, color: { r: 200, g: 175, b: 150 } },
  panorama: { width: 2400, height: 800, color: { r: 160, g: 170, b: 200 } },
};

(async () => {
  require('dotenv').config({ path: '.env.local', quiet: true });
  const { pool, qschema, hashSession } = await import('../memento-db.mjs');
  assert.equal(process.env.DB_SCHEMA, 'memento_dev', 'this harness only targets DEV');

  // The API rejects an Origin that disagrees with the forwarded protocol, so the harness
  // goes through the public DEV hostname exactly like a real visitor.
  const base = process.env.MEMENTO_DEV_BASE || 'https://memento-dev.srv.io.vn';
  const out = path.resolve(process.env.MEMENTO_UI_ARTIFACTS || '.hermes/evidence/single-photo-card');
  fs.mkdirSync(out, { recursive: true });
  const report = { synthetic: true, base, checks: [], requests: [], failures: [], pageerrors: [], cleanup: false };
  const check = (label) => { report.checks.push(label); console.log('CHECK', label); };

  const shoebox = {};
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    shoebox[name] = await require('sharp')({ create: { width: fixture.width, height: fixture.height, channels: 3, background: fixture.color } }).jpeg({ quality: 82 }).toBuffer();
  }

  const owner = { id: crypto.randomUUID(), username: `qa_photo_${crypto.randomBytes(5).toString('hex')}`, token: crypto.randomBytes(32).toString('hex') };
  const track = 'qa-single-photo';
  const photoIds = {
    portrait: crypto.randomUUID(), landscape: crypto.randomUUID(), square: crypto.randomUUID(), panorama: crypto.randomUUID(),
    multiA: crypto.randomUUID(), multiB: crypto.randomUUID(), multiC: crypto.randomUUID(), broken: crypto.randomUUID(),
  };
  // Moment id -> the fixture its image request is answered with.
  const servedAs = {};
  let browser;
  try {
    const passwordHash = await require('bcryptjs').hash(crypto.randomBytes(18).toString('hex'), 12);
    await pool.query(`INSERT INTO ${qschema}.users(id,username,password_hash) VALUES($1,$2,$3)`, [owner.id, owner.username, passwordHash]);
    await pool.query(`INSERT INTO ${qschema}.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')`, [hashSession(owner.token), owner.id]);
    await pool.query(`INSERT INTO ${qschema}.tracks(owner_id,id,document) VALUES($1,$2,$3)`, [owner.id, track, {
      id: track, title: 'QA single photo', description: 'Temporary authenticated browser metadata', color: 'indigo', icon: 'Heart', tags: [], createdAt: '2026-10-20', updatedAt: '2026-10-20',
    }]);
    const moments = [
      { id: 'qa-photo-portrait', title: 'QA portrait photo', images: [photoIds.portrait], fixture: 'portrait' },
      { id: 'qa-photo-landscape', title: 'QA landscape photo', images: [photoIds.landscape], fixture: 'landscape' },
      { id: 'qa-photo-square', title: 'QA square photo', images: [photoIds.square], fixture: 'square' },
      { id: 'qa-photo-panorama', title: 'QA panorama photo', images: [photoIds.panorama], fixture: 'panorama' },
      { id: 'qa-photo-multi', title: 'QA multi photo', images: [photoIds.multiA, photoIds.multiB, photoIds.multiC], fixture: 'landscape' },
      { id: 'qa-photo-none', title: 'QA text only', images: [], fixture: null },
      { id: 'qa-photo-broken', title: 'QA broken photo', images: [photoIds.broken], fixture: 'portrait' },
    ];
    for (const moment of moments) {
      await pool.query(`INSERT INTO ${qschema}.moments(owner_id,id,event_id,document) VALUES($1,$2,$3,$4)`, [owner.id, moment.id, track, {
        id: moment.id, eventId: track, title: moment.title, description: 'QA fixture', date: '2026-10-20', tags: ['qa-photo'], images: [], isMilestone: false, createdAt: '2026-10-20', updatedAt: '2026-10-20',
      }]);
      for (const imageId of moment.images) {
        if (moment.fixture) servedAs[imageId] = moment.fixture;
        await pool.query(`INSERT INTO ${qschema}.images(id,owner_id,moment_id,object_key,content_type,size) VALUES($1,$2,$3,$4,'image/jpeg',$5)`,
          [imageId, owner.id, moment.id, `qa-harness/${imageId}/original`, 4096]);
      }
    }
    check('fixtures: 7 disposable moments and 7 private image rows created in DEV');

    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell',
      args: ['--no-sandbox'],
    });

    const variantFor = (url) => new URL(url).searchParams.get('variant') || 'original';
    const imageIdOf = (url) => path.basename(new URL(url).pathname);

    async function openContext(deviceScaleFactor, failBroken = false) {
      // The failure is lifted after the placeholder appears so the retry can be observed recovering.
      const state = { failBroken };
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor, reducedMotion: 'reduce' });
      await context.addCookies([{ name: 'memento_session', value: owner.token, url: base, httpOnly: true, sameSite: 'Lax' }]);
      const page = await context.newPage();
      page.on('pageerror', (error) => report.pageerrors.push({ deviceScaleFactor, message: error.message }));
      await page.route('**/api/images/**', async (route) => {
        const url = route.request().url();
        const imageId = imageIdOf(url);
        report.requests.push({ variant: variantFor(url), imageId });
        if (state.failBroken && imageId === photoIds.broken) return route.fulfill({ status: 500, contentType: 'text/plain', body: 'fixture failure' });
        const fixture = servedAs[imageId];
        if (!fixture) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'unknown fixture' });
        return route.fulfill({ status: 200, contentType: 'image/jpeg', body: shoebox[fixture] });
      });
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelectorAll('[id^="event-card-"]').length >= 7);
      return { context, page, state };
    }

    const card = (page, title) => page.locator('[id^="event-card-"]').filter({ hasText: title }).first();
    const frameOf = (page, title) => card(page, title).getByRole('button', { name: 'Open photo preview' }).first();

    async function geometry(page, title) {
      return frameOf(page, title).evaluate((node) => {
        const frame = node.getBoundingClientRect();
        const inner = node.firstElementChild.getBoundingClientRect();
        const image = node.querySelector('img');
        const box = image.getBoundingClientRect();
        const style = getComputedStyle(image);
        return {
          frame: { width: frame.width, height: frame.height },
          inner: { width: inner.width, height: inner.height },
          image: { width: box.width, height: box.height },
          objectFit: style.objectFit,
          loading: image.getAttribute('loading'),
        };
      });
    }

    for (const [width, height] of [[320, 780], [390, 844], [768, 1024], [1440, 900]]) {
      for (const dpr of [1, 2]) {
        const { context, page } = await openContext(dpr);
        try {
          await page.setViewportSize({ width, height });
          await page.evaluate(async () => { await document.fonts.ready; });
          await page.waitForTimeout(150);
          for (const [title, fixture] of [['QA portrait photo', 'portrait'], ['QA landscape photo', 'landscape'], ['QA square photo', 'square'], ['QA panorama photo', 'panorama']]) {
            const measured = await geometry(page, title);
            assert.ok(measured.frame.width <= 360.5, `${title} @${width}px: frame ${measured.frame.width}px exceeds 360px`);
            assert.ok(measured.frame.width > 0 && measured.frame.height > 0, `${title} @${width}px: frame must have area`);
            const ratio = measured.inner.width / measured.inner.height;
            assert.ok(Math.abs(ratio - 4 / 3) < 0.02, `${title} @${width}px: preview frame ratio ${ratio.toFixed(3)} is not 4:3`);
            assert.equal(measured.objectFit, 'cover', `${title} @${width}px: preview must crop, not distort`);
            assert.equal(measured.loading, 'lazy', `${title} @${width}px: preview stays lazy`);
            const variants = report.requests.filter((request) => request.imageId === photoIds[fixture]).map((request) => request.variant);
            assert.ok(variants.includes('display'), `${title} @${width}px: expected a display derivative, saw ${JSON.stringify(variants)}`);
            assert.ok(!variants.includes('original'), `${title} @${width}px: the card must not fetch the original`);
          }
          const single = await card(page, 'QA portrait photo').boundingBox();
          const multi = await card(page, 'QA multi photo').boundingBox();
          const plain = await card(page, 'QA text only').boundingBox();
          assert.ok(Math.abs(single.width - multi.width) <= 1, `${width}px: single-photo card width ${single.width} diverged from multi ${multi.width}`);
          assert.ok(Math.abs(single.width - plain.width) <= 1, `${width}px: single-photo card width ${single.width} diverged from text-only ${plain.width}`);
          const multiVariants = report.requests.filter((request) => request.imageId === photoIds.multiA).map((request) => request.variant);
          assert.ok(multiVariants.length === 0 || multiVariants.every((variant) => variant !== 'original'), 'multi-photo grid must not fetch originals');
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          assert.ok(overflow <= 1, `${width}px: horizontal overflow of ${overflow}px`);
          const dialog = page.getByRole('dialog', { name: 'Photo preview' });
          assert.equal(await dialog.count(), 0, `${width}px: no preview is open before interaction`);
          check(`${width}px dpr${dpr}: bounded 4:3 single-photo previews, display derivative, no original fetch, no overflow`);
          await page.screenshot({ path: path.join(out, `cards-${width}-dpr${dpr}.png`), fullPage: false });
          await page.locator('[id^="event-card-"]').filter({ hasText: 'QA portrait photo' }).first().scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(out, `single-portrait-${width}-dpr${dpr}.png`) });
        } finally {
          await context.close();
        }
      }
    }

    // Keyboard and pointer both reach the pre-existing lightbox, at index 0.
    {
      const { context, page } = await openContext(1);
      try {
        const frame = frameOf(page, 'QA portrait photo');
        await frame.focus();
        assert.equal(await frame.evaluate((node) => document.activeElement === node), true, 'the single-photo preview must be focusable');
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog', { name: 'Photo preview' });
        await dialog.waitFor({ state: 'visible' });
        assert.equal(await dialog.locator('#lightbox-next-button').isDisabled(), true, 'a single photo has no next image');
        assert.equal(await dialog.locator('#lightbox-prev-button').isDisabled(), true, 'a single photo has no previous image');
        check('keyboard: Enter on the focused preview opens the existing photo preview at index 0');
        await dialog.locator('#lightbox-close-button').click();
        await dialog.waitFor({ state: 'detached' });
        await frame.click();
        await dialog.waitFor({ state: 'visible' });
        const contain = await dialog.locator('img').first().evaluate((image) => getComputedStyle(image).objectFit);
        assert.notEqual(contain, 'cover', 'the lightbox shows the whole photo, not a crop');
        check(`pointer: click opens the same preview, full photo shown (object-fit ${contain})`);
        await page.screenshot({ path: path.join(out, 'lightbox-single.png') });
        await dialog.locator('#lightbox-close-button').click();
        await dialog.waitFor({ state: 'detached' });
      } finally {
        await context.close();
      }
    }

    // Failed photo keeps the reserved frame, then a retry recovers without a reload.
    {
      const { context, page, state } = await openContext(1, true);
      try {
        const broken = card(page, 'QA broken photo');
        await broken.scrollIntoViewIfNeeded();
        const retry = broken.getByRole('button', { name: 'Retry photo' });
        await retry.waitFor({ state: 'visible', timeout: 15000 });
        assert.match(await broken.getByRole('status').first().innerText(), /Photo unavailable/);
        check('failure: an unavailable photo shows the placeholder and a retry control, no layout collapse');
        state.failBroken = false;
        await retry.click();
        await broken.locator('img').first().waitFor({ state: 'visible' });
        check('retry: the placeholder recovers after an explicit retry');
      } finally {
        await context.close();
      }
    }

    const variantsOf = (ids) => [...new Set(report.requests.filter((request) => ids.includes(request.imageId)).map((request) => request.variant))].sort();
    const singleIds = [photoIds.portrait, photoIds.landscape, photoIds.square, photoIds.panorama];
    const multiIds = [photoIds.multiA, photoIds.multiB, photoIds.multiC];
    assert.deepEqual(variantsOf(singleIds), ['display'], `single-photo previews requested ${JSON.stringify(variantsOf(singleIds))}`);
    assert.ok(!variantsOf(multiIds).includes('original'), 'the multi-photo grid must not fetch originals');
    assert.ok(!variantsOf([...singleIds, ...multiIds]).includes('original'), 'no card preview may fetch an original');
    check(`variants: single-photo ${variantsOf(singleIds).join(', ')}; multi grid ${variantsOf(multiIds).join(', ') || 'not requested'}; no originals`);
    assert.equal(report.pageerrors.length, 0, `page errors: ${JSON.stringify(report.pageerrors)}`);
    check('no browser page errors across all viewports');
  } finally {
    if (browser) await browser.close().catch(() => {});
    try {
      await pool.query(`DELETE FROM ${qschema}.users WHERE id=$1`, [owner.id]);
      const remaining = await pool.query(`SELECT (SELECT count(*) FROM ${qschema}.moments WHERE owner_id=$1) AS moments, (SELECT count(*) FROM ${qschema}.images WHERE owner_id=$1) AS images`, [owner.id]);
      report.cleanup = Number(remaining.rows[0].moments) === 0 && Number(remaining.rows[0].images) === 0;
      assert.equal(report.cleanup, true, 'disposable rows must be gone');
      check('cleanup: disposable user, moments and image rows removed from DEV');
    } catch (error) {
      report.failures.push(`cleanup: ${error.message}`);
      throw error;
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await pool.end().catch(() => {});
  }
  console.log(`\nSINGLE-PHOTO CARD: ${report.checks.length} checks passed`);
})().catch((error) => { console.error('SINGLE-PHOTO CARD FAILED:', error.message); process.exitCode = 1; });
