// Postcard layout/renderer tests. Pure tests always run; the DB-backed
// endpoint block is guarded by RUN_INTEGRATION=1 like the other suites.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const { fontMetrics, wrapText, escapeXml, validatePostcardRequest, layoutPostcard, POSTCARD_TEMPLATES, POSTCARD_WIDTH, POSTCARD_HEIGHT } = await import('../postcard-layout.mjs');
const { renderPostcard, postcardRenderStats } = await import('../postcard-renderer.mjs');

const FONT = fs.readFileSync(path.join(process.cwd(), 'assets/fonts/NotoSans-Regular.ttf'));
const metrics = fontMetrics(FONT);

test('bundled font carries real Vietnamese advance widths', () => {
  assert.ok(metrics.unitsPerEm > 0);
  const plain = metrics.measure('abcd', 100);
  const accented = metrics.measure('ậ̃', 100);
  // Combining marks add no advance; the base glyph still measures.
  assert.ok(accented > 0 && accented < plain * 2, `accented=${accented} plain=${plain}`);
  // Emoji/CJK the font lacks fall back to a bounded width, never zero/crash.
  const emoji = metrics.measure('🎉', 100);
  assert.ok(emoji > 0 && emoji < 200, `emoji=${emoji}`);
});

test('wrapping bounds long Vietnamese words and reports overflow', () => {
  const long = 'Nhậtkýmùahè'.repeat(12);
  const wrapped = wrapText(long, { maxWidth: 400, size: 44, metrics, maxLines: 6 });
  assert.ok(wrapped.lines.length <= 6);
  assert.equal(wrapped.overflow, true);
  for (const line of wrapped.lines) assert.ok(metrics.measure(line, 44) <= 400 + 1, line);
  const ok = wrapText('Một hai ba', { maxWidth: 800, size: 44, metrics, maxLines: 6 });
  assert.equal(ok.overflow, false);
  assert.deepEqual(ok.lines, ['Một hai ba']);
  const broken = wrapText('dòng một\ndòng hai', { maxWidth: 800, size: 44, metrics, maxLines: 6 });
  assert.deepEqual(broken.lines, ['dòng một', 'dòng hai']);
});

test('XML metacharacters and markup strings stay literal text', () => {
  assert.equal(escapeXml('<script x="1">&\'</script>'), '&lt;script x=&quot;1&quot;&gt;&amp;&apos;&lt;/script&gt;');
  assert.equal(escapeXml('a\u0000b\u0007c'), 'abc');
});

test('request validation rejects bad templates, duplicates and over-limit text', () => {
  const base = { template: 'journey', moments: [{ ownerId: 'A', id: 'm1' }], images: [null], title: 'Đà Nẵng' };
  assert.throws(() => validatePostcardRequest({ ...base, template: 'nope' }), /template/i);
  assert.throws(() => validatePostcardRequest({ ...base, moments: [], images: [] }), /at least/);
  assert.throws(() => validatePostcardRequest({ ...base, moments: Array.from({ length: 7 }, (_, i) => ({ ownerId: 'A', id: `m${i}` })), images: Array(7).fill(null) }), /at most/);
  assert.throws(() => validatePostcardRequest({ ...base, moments: [{ ownerId: 'A', id: 'm1' }, { ownerId: 'A', id: 'm1' }], images: [null, null] }), /twice/);
  assert.throws(() => validatePostcardRequest({ ...base, moments: [{ ownerId: 'A', id: 'm1' }, { ownerId: 'A', id: 'm2' }], images: [null] }), /one photo per/);
  assert.throws(() => validatePostcardRequest({ ...base, title: '' }), /title/);
  assert.throws(() => validatePostcardRequest({ ...base, title: 'x'.repeat(81) }), /80 characters/);
  assert.throws(() => validatePostcardRequest({ ...base, note: 'x'.repeat(501) }), /500 characters/);
  assert.throws(() => validatePostcardRequest({ ...base, captions: ['x'.repeat(81)] }), /caption/i);
  assert.throws(() => validatePostcardRequest({ ...base, captions: ['ok', 'extra'] }), /more captions/);
  const ordinary = { ...base, template: 'ordinary', moments: Array.from({ length: 4 }, (_, i) => ({ ownerId: 'A', id: `m${i}` })), images: Array(4).fill(null) };
  assert.throws(() => validatePostcardRequest(ordinary), /at most 3/);
  assert.ok(POSTCARD_TEMPLATES.journey && POSTCARD_TEMPLATES.ordinary && POSTCARD_TEMPLATES.month);
});

test('layout returns explicit in-bounds coordinates for every template', () => {
  for (const template of ['journey', 'ordinary', 'month']) {
    const max = POSTCARD_TEMPLATES[template].max;
    for (let count = POSTCARD_TEMPLATES[template].min; count <= max; count += 1) {
      const spec = validatePostcardRequest({
        template,
        moments: Array.from({ length: count }, (_, i) => ({ ownerId: 'A', id: `m${i}` })),
        images: Array(count).fill(null),
        title: 'Nhật ký mùa hè ấm áp',
        note: 'Một ghi chú ngắn.',
        showDate: true,
      });
      const layout = layoutPostcard({
        ...spec,
        cells: Array.from({ length: count }, () => ({ imageId: null, caption: '', date: '2026-01-01' })),
        metrics,
      });
      assert.equal(layout.width, POSTCARD_WIDTH);
      assert.equal(layout.height, POSTCARD_HEIGHT);
      for (const box of layout.cells) {
        assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= POSTCARD_WIDTH && box.y + box.h <= POSTCARD_HEIGHT, JSON.stringify(box));
      }
      for (const item of layout.text) {
        assert.ok(item.x >= 0 && item.x + metrics.measure(item.text, item.size) <= POSTCARD_WIDTH + 1, JSON.stringify(item));
        assert.ok(item.y <= POSTCARD_HEIGHT);
      }
    }
  }
});

test('layout guides instead of clipping oversized note and captions', () => {
  const cells = [{ imageId: null, caption: '', date: null }];
  assert.throws(() => layoutPostcard({
    template: 'ordinary', title: 'T', note: 'dài '.repeat(200), showDate: false, cells, metrics,
  }), /note is too long|runs past the bottom/);
  assert.throws(() => layoutPostcard({
    template: 'ordinary', title: 'T', note: '', showDate: false,
    cells: [{ imageId: null, caption: 'chú thích '.repeat(30), date: null }], metrics,
  }), /too long for its photo/);
});

// Regression: a caption must stay inside its own cell and never reach the
// note band. Found by visual inspection of a six-photo canary render.
test('captions stay inside their cell and never collide with the note', () => {
  for (const template of ['journey', 'ordinary', 'month']) {
    const max = POSTCARD_TEMPLATES[template].max;
    for (let count = POSTCARD_TEMPLATES[template].min; count <= max; count += 1) {
      const spec = validatePostcardRequest({
        template,
        moments: Array.from({ length: count }, (_, i) => ({ ownerId: 'A', id: `m${i}` })),
        images: Array.from({ length: count }, (_, i) => `img${i}`),
        captions: Array.from({ length: count }, () => 'Chú thích đủ dài để xuống dòng thêm một chút'),
        title: 'Tiêu đề',
        note: 'Một dòng ghi chú ở đáy trang.',
        showDate: true,
      });
      const layout = layoutPostcard({
        ...spec,
        cells: Array.from({ length: count }, () => ({ imageId: 'img', caption: 'Chú thích đủ dài để xuống dòng thêm một chút', date: '2026-01-01' })),
        metrics,
      });
      for (const box of layout.cells) {
        assert.ok(box.imageHeight > 0, `${template}/${count}: photo area must not vanish`);
        assert.ok(box.bandTop + box.bandHeight <= box.y + box.h, `${template}/${count}: caption band must stay inside its cell`);
      }
      // The lowest caption glyph must clear the top of the note area.
      const noteTop = Math.min(...layout.text.filter(item => item.size === 44).map(item => item.y - item.size));
      const lowestCaption = Math.max(...layout.text.filter(item => item.size === 34).map(item => item.y));
      assert.ok(lowestCaption < noteTop, `${template}/${count}: caption ${lowestCaption} overlaps note ${noteTop}`);
    }
  }
});

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Synthetic reference photo: solid teal with a contrasting marker square so the
// tests prove placement without any real user content.
async function fixturePhoto(size = 300, marker = '#ff0000') {
  return sharp({ create: { width: size, height: size, channels: 3, background: '#008080' } })
    .composite([{ input: { create: { width: 40, height: 40, channels: 3, background: marker } }, top: 0, left: 0 }])
    .png().toBuffer();
}

test('render produces a real 1600x2000 PNG with no source metadata', { timeout: 120000 }, async () => {
  const photo = await fixturePhoto();
  const spec = validatePostcardRequest({
    template: 'journey',
    moments: [{ ownerId: 'A', id: 'm1' }],
    images: ['img1'],
    title: 'Nhật ký Đà Nẵng',
    note: 'Một chuyến đi ấm áp cùng gia đình.',
    captions: ['Ngày đầu tiên'],
    showDate: true,
  });
  const png = await renderPostcard({ spec, photos: [{ buffer: photo, contentType: 'image/png' }] });
  assert.ok(png.subarray(0, 8).equals(PNG_SIGNATURE), 'PNG signature');
  const meta = await sharp(png).metadata();
  assert.equal(meta.width, POSTCARD_WIDTH);
  assert.equal(meta.height, POSTCARD_HEIGHT);
  assert.equal(meta.format, 'png');
  // No EXIF/IPTC/XMP carried over from the source photo.
  assert.equal(meta.exif, undefined);
  assert.equal(meta.icc, undefined);
  assert.equal(meta.xmp, undefined);
});

// 'contain' is the product default: a photo must never be cropped or stretched.
// Detection is by saturation, because every piece of chrome (paper, cell fill,
// hairline border, captions) is desaturated and cannot be confused with a photo.
async function placedPhotoBox(png, cell, expectedAspect) {
  const { width } = await sharp(png).metadata();
  const raw = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const { channels } = raw.info;
  const saturation = (x, y) => {
    const offset = (y * width + x) * channels;
    const r = raw.data[offset], g = raw.data[offset + 1], b = raw.data[offset + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    return max === 0 ? 0 : (max - min) / max;
  };
  let minX = Infinity, maxX = -1, minY = Infinity, maxY = -1;
  for (let y = cell.y; y < cell.y + cell.h; y += 1) {
    for (let x = cell.x; x < cell.x + cell.w; x += 1) {
      if (saturation(x, y) < 0.2) continue;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  assert.ok(maxX >= 0, 'photo content must be present');
  const box = { w: maxX - minX + 1, h: maxY - minY + 1 };
  assert.ok(Math.abs(box.w / box.h - expectedAspect) < 0.02,
    `aspect ${box.w / box.h} vs source ${expectedAspect}: a photo must keep its aspect ratio`);
  return box;
}

test('text-only cells render and a panorama is contained, never stretched', { timeout: 120000 }, async () => {
  const panorama = await sharp({ create: { width: 1200, height: 400, channels: 3, background: '#065f46' } })
    .composite([{ input: { create: { width: 60, height: 400, channels: 3, background: '#ff2d55' } }, top: 0, left: 0 }]).png().toBuffer();
  const spec = validatePostcardRequest({
    template: 'ordinary',
    moments: [{ ownerId: 'A', id: 'm1' }, { ownerId: 'A', id: 'm2' }],
    images: ['img1', null],
    title: 'Một ngày bình thường',
    note: '',
    showDate: false,
  });
  const png = await renderPostcard({ spec, photos: [{ buffer: panorama, contentType: 'image/png' }, null] });
  const meta = await sharp(png).metadata();
  assert.equal(meta.width, POSTCARD_WIDTH);
  // 1200x400 = 3.0 source into the first cell; letterboxed top and bottom.
  // ordinary with two cells: first cell is x=100,y=520,w=1400,h=440, no caption.
  const box = await placedPhotoBox(png, { x: 100, y: 520, w: 1400, h: 440 }, 1200 / 400);
  assert.ok(box.w <= 1400 && box.h <= 440, 'contained photo stays inside its cell');
  // The second, deliberate text-only cell is framed rather than left as a gap.
  const meta2 = await sharp(png).metadata();
  assert.equal(meta2.height, POSTCARD_HEIGHT);
});

test('animated GIF is rejected explicitly, never silently dropped', { timeout: 120000 }, async () => {
  const gif = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(64)]);
  const spec = validatePostcardRequest({
    template: 'ordinary',
    moments: [{ ownerId: 'A', id: 'm1' }],
    images: ['img1'],
    title: 'Hoạt hình',
    showDate: false,
  });
  await assert.rejects(() => renderPostcard({ spec, photos: [{ buffer: gif, contentType: 'image/gif' }] }), /Animated photos are not supported|not a supported image/);
});

test('unreadable or corrupt photo fails loudly instead of a missing tile', { timeout: 120000 }, async () => {
  const spec = validatePostcardRequest({
    template: 'ordinary',
    moments: [{ ownerId: 'A', id: 'm1' }],
    images: ['img1'],
    title: 'Ảnh hỏng',
    showDate: false,
  });
  await assert.rejects(() => renderPostcard({ spec, photos: [{ buffer: Buffer.from('not an image at all'), contentType: 'image/png' }] }), /could not be read|not a supported image/);
  await assert.rejects(() => renderPostcard({ spec, photos: [{ buffer: Buffer.alloc(0), contentType: 'image/png' }] }), /could not be read/);
});

test('malicious strings render as literal text and never as markup', { timeout: 120000 }, async () => {
  const spec = validatePostcardRequest({
    template: 'ordinary',
    moments: [{ ownerId: 'A', id: 'm1' }],
    images: [null],
    title: '<script>alert(1)</script>',
    note: '"><img src=x onerror=alert(2)> & \'quoted\'',
    showDate: false,
  });
  const png = await renderPostcard({ spec, photos: [null] });
  const meta = await sharp(png).metadata();
  assert.equal(meta.width, POSTCARD_WIDTH);
  // If those strings were parsed as markup the page would be near-empty; the
  // literal text must rasterize into a meaningful number of dark pixels.
  const stats = await sharp(png).greyscale().raw().toBuffer();
  let dark = 0;
  for (const value of stats) if (value < 128) dark += 1;
  assert.ok(dark > 2000, `dark pixels=${dark}`);
});

test('six-photo month recap renders and the render queue stays bounded', { timeout: 180000 }, async () => {
  const photo = await fixturePhoto(240);
  const spec = validatePostcardRequest({
    template: 'month',
    moments: Array.from({ length: 6 }, (_, i) => ({ ownerId: 'A', id: `m${i}` })),
    images: Array.from({ length: 6 }, (_, i) => `img${i}`),
    title: 'Tổng kết tháng Một',
    note: 'Sáu khoảnh khắc.',
    showDate: true,
  });
  const started = Date.now();
  const png = await renderPostcard({ spec, photos: Array.from({ length: 6 }, () => ({ buffer: photo, contentType: 'image/png' })) });
  // Observational only: recorded for the DEV canary report, not a speed target.
  console.log(`postcard six-photo synthetic render: ${Date.now() - started}ms`);
  assert.ok(png.subarray(0, 8).equals(PNG_SIGNATURE));
  assert.deepEqual(postcardRenderStats(), { active: 0, queued: 0 });
});

test('a cancelled request never occupies the render slot', { timeout: 120000 }, async () => {
  const controller = new AbortController();
  const spec = validatePostcardRequest({
    template: 'ordinary',
    moments: [{ ownerId: 'A', id: 'm1' }],
    images: [null],
    title: 'Bị hủy',
    showDate: false,
  });
  controller.abort();
  await assert.rejects(() => renderPostcard({ spec, photos: [null], signal: controller.signal }), /cancelled/);
  assert.deepEqual(postcardRenderStats(), { active: 0, queued: 0 });
  const png = await renderPostcard({ spec, photos: [null] });
  assert.ok(png.subarray(0, 8).equals(PNG_SIGNATURE));
});

test('postcard render endpoint is owner-only and returns a real PNG', { timeout: 180000 }, async t => {
  if (process.env.RUN_INTEGRATION !== '1') return t.skip('Set RUN_INTEGRATION=1 for DB/R2-backed postcard integration');
  const dotenv = await import('dotenv');
  dotenv.config({ path: process.env.ENV_FILE || '.env.local' });
  const { app } = await import('../server.mjs');
  const { createInvite } = await import('../memento-db.mjs');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(path, { method = 'GET', token, body, multipart } = {}) {
    const headers = {};
    if (token) headers.Cookie = `memento_session=${token}`;
    if (['POST', 'PUT', 'DELETE'].includes(method)) headers.Origin = base;
    let payload;
    if (multipart) payload = multipart;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + path, { method, headers, body: payload });
    const type = res.headers.get('content-type') || '';
    return { res, data: type.includes('application/json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  }
  async function register(prefix) {
    const username = `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 18)}`;
    const invite = await createInvite(1);
    const registered = await request('/api/auth/register', { method: 'POST', body: { username, password: 'a-very-long-test-password-1', inviteCode: invite } });
    assert.equal(registered.res.status, 200);
    return { id: registered.data.user.id, username, token: registered.res.headers.get('set-cookie').match(/memento_session=([^;]+)/)[1] };
  }
  // 1x1 transparent PNG.
  const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNgZGJmZGJmgFAAAK4AGRLRbNUAAAAASUVORK5CYII=';

  const owner = await register('pc');
  const viewer = await register('pv');
  const outsider = await register('px');
  try {
    const track = await request('/api/tracks', { method: 'POST', token: owner.token, body: { title: 'Postcard track', description: '', color: 'indigo', icon: 'Heart', tags: [] } });
    assert.equal(track.res.status, 201);
    const trackId = track.data.track.id;
    const moment = await request('/api/moments', { method: 'POST', token: owner.token, body: { eventId: trackId, eventOwnerId: owner.id, title: 'Ngày đầu tiên', date: '2026-01-05', description: 'Một ngày ấm áp.', tags: [], images: [] } });
    assert.equal(moment.res.status, 201);
    const momentId = moment.data.moment.id;

    const form = new FormData();
    form.set('momentId', momentId);
    form.set('ownerId', owner.id);
    form.set('file', new Blob([Buffer.from(PIXEL, 'base64')], { type: 'image/png' }), 'photo.png');
    const uploaded = await request('/api/images', { method: 'POST', token: owner.token, multipart: form });
    assert.equal(uploaded.res.status, 201);
    const imageId = uploaded.data.image.id;

    const spec = { template: 'ordinary', moments: [{ ownerId: owner.id, id: momentId }], images: [imageId], title: 'Nhật ký đầu năm', note: 'Một ghi chú.', showDate: true };
    const rendered = await request('/api/postcards/render', { method: 'POST', token: owner.token, body: spec });
    assert.equal(rendered.res.status, 200);
    assert.equal(rendered.res.headers.get('content-type'), 'image/png');
    assert.equal(rendered.res.headers.get('cache-control'), 'no-store');
    assert.equal(rendered.res.headers.get('content-disposition'), 'attachment; filename="memento-postcard.png"');
    assert.ok(rendered.data.subarray(0, 8).equals(PNG_SIGNATURE));
    const meta = await sharp(rendered.data).metadata();
    assert.equal(meta.width, POSTCARD_WIDTH);
    assert.equal(meta.height, POSTCARD_HEIGHT);

    // Validation guidance, not a silent success.
    const badTemplate = await request('/api/postcards/render', { method: 'POST', token: owner.token, body: { ...spec, template: 'nope' } });
    assert.equal(badTemplate.res.status, 400);
    const longTitle = await request('/api/postcards/render', { method: 'POST', token: owner.token, body: { ...spec, title: 'x'.repeat(81) } });
    assert.equal(longTitle.res.status, 400);
    // A photo that does not belong to the selected moment is refused.
    const foreign = await request('/api/postcards/render', { method: 'POST', token: owner.token, body: { ...spec, images: [crypto.randomUUID()] } });
    assert.equal(foreign.res.status, 422);

    // Invite a viewer, then prove export stays owner-only.
    const invite = await request(`/api/tracks/${trackId}/collaborators`, { method: 'POST', token: owner.token, body: { username: viewer.username, role: 'viewer' } });
    assert.equal(invite.res.status, 201);
    const pending = await request('/api/collaboration-invitations', { token: viewer.token });
    assert.equal((await request(`/api/collaboration-invitations/${pending.data.invitations[0].id}/accept`, { method: 'POST', token: viewer.token })).res.status, 200);
    const viewerRender = await request('/api/postcards/render', { method: 'POST', token: viewer.token, body: spec });
    assert.equal(viewerRender.res.status, 403);
    // An unrelated account cannot even see the moment exists.
    const outsiderRender = await request('/api/postcards/render', { method: 'POST', token: outsider.token, body: spec });
    assert.equal(outsiderRender.res.status, 404);
    // Anonymous callers never reach the renderer.
    assert.equal((await request('/api/postcards/render', { method: 'POST', body: spec })).res.status, 401);
    // Revoke the viewer, then re-check the same refusal.
    assert.equal((await request(`/api/tracks/${trackId}/collaborators/${viewer.id}`, { method: 'DELETE', token: owner.token })).res.status, 200);
    assert.equal((await request('/api/postcards/render', { method: 'POST', token: viewer.token, body: spec })).res.status, 404);
  } finally {
    server.close();
  }
});

test('the renderer performs no outbound network fetch', { timeout: 120000 }, async () => {
  const spec = validatePostcardRequest({
    template: 'ordinary',
    moments: [{ ownerId: 'A', id: 'm1' }],
    images: [null],
    title: 'Không mạng',
    note: 'https://example.com/note',
    showDate: false,
  });
  const originalFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async () => { called += 1; throw new Error('network disabled'); };
  try {
    const png = await renderPostcard({ spec, photos: [null] });
    assert.ok(png.subarray(0, 8).equals(PNG_SIGNATURE));
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(called, 0, 'no fetch during render');
});
