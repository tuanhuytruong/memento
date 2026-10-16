import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { ImageCache, ImageLoadScheduler, invalidateImageObject, imageCache } from '../image-cache.mjs';
import { createImageDelivery, imageEtag } from '../image-delivery.mjs';
import { makeImageVariants, resolveVariant, imageTransformStats, MAX_IMAGE_INPUT_BYTES } from '../image-variants.mjs';
const source = (data, contentLength = data.length) => ({ body: Readable.from([data]), contentLength });
const value = Buffer.from('test');
const load = async () => source(value);
const meta = (key = 'memento_dev/object/thumb.webp', size = 4, variant = 'thumb') => ({ key, size, contentType: 'image/webp', variant });
const tick = () => delay(0);

// Deliberately controlled streams, no R2, DB, user objects or production requests.
test('TTL, LRU eviction, byte and entry caps; errors are not cached', async () => {
  let now = 0, calls = 0;
  const cache = new ImageCache({ maxBytes: 8, maxEntryBytes: 4, maxEntries: 2, ttlMs: 10, now: () => now });
  const get = key => cache.get({ key, size: 4, load: async () => { calls++; return source(value); } });
  assert.equal((await get('a')).cache, 'miss');
  await get('b'); assert.equal((await get('a')).cache, 'hit'); await get('c');
  assert.equal(cache.entries.has('b'), false); assert.equal(cache.stats().bytes, 8);
  now = 10; assert.equal(cache.stats().bytes, 0); assert.equal((await get('a')).cache, 'miss'); assert.equal(calls, 4);
  await assert.rejects(cache.get({ key: 'bad', size: 4, load: async () => { throw Error('fault'); } }), /fault/);
  assert.equal((await cache.get({ key: 'bad', size: 4, load })).cache, 'miss');
  await assert.rejects(cache.get({ key: 'big', size: 5, load }), { code: 'IMAGE_NOT_CACHEABLE' });
  const small = new ImageCache({ maxBytes: 16, maxEntryBytes: 4, maxEntries: 2 });
  for (const key of ['a','b','c']) await small.get({ key, size: 1, load: async () => source(Buffer.from('x')) });
  assert.equal(small.stats().entries, 2); assert.equal(small.stats().bytes, 2);
});

test('singleflight, one waiter cancellation, inflight invalidation prevents resurrection', async () => {
  const cache = new ImageCache(); let finish, calls = 0;
  const slow = async () => { calls++; await new Promise(resolve => { finish = resolve; }); return source(value); };
  const abort = new AbortController();
  const one = cache.get({ key: 'a', size: 4, load: slow, signal: abort.signal });
  const two = cache.get({ key: 'a', size: 4, load: slow });
  await tick(); assert.equal(calls, 1); abort.abort(); await assert.rejects(one);
  finish(); assert.equal((await two).cache, 'coalesced');
  let late, upstreamSignal;
  const old = cache.get({ key: 'b', size: 4, load: async signal => { upstreamSignal = signal; await new Promise(resolve => { late = resolve; }); return source(value); } });
  await tick(); cache.invalidate('b'); await assert.rejects(old, { code: 'IMAGE_INVALIDATED' });
  assert.equal(upstreamSignal.aborted, true);
  assert.equal((await cache.get({ key: 'b', size: 4, load })).cache, 'miss');
  late(); await tick(); assert.equal((await cache.get({ key: 'b', size: 4, load })).cache, 'hit');
  await imageCache.get({ key: 'global-test-key', size: 4, load });
  invalidateImageObject('global-test-key'); assert.equal(imageCache.entries.has('global-test-key'), false);
});

test('all waiters disconnect aborts/destroys body and frees reservations', async () => {
  const cache = new ImageCache(); const controller = new AbortController();
  const stream = new Readable({ read() {} });
  const pending = cache.get({ key: 'a', size: 4, load: async () => ({ body: stream, contentLength: 4 }), signal: controller.signal });
  await tick(); controller.abort(); await assert.rejects(pending); await tick();
  assert.equal(stream.destroyed, true); assert.equal(cache.stats().pendingBytes, 0); assert.equal(cache.stats().active, 0);
});

test('declared mismatch, oversized chunk, short body never enter cache', async () => {
  for (const [label, data, length] of [['declared', value, 10], ['actual', Buffer.alloc(1024 * 1024), 4], ['short', Buffer.from('x'), 4]]) {
    const cache = new ImageCache(); const stream = Readable.from([data]);
    await assert.rejects(cache.get({ key: label, size: 4, load: async () => ({ body: stream, contentLength: length }) }), { code: 'IMAGE_LENGTH_MISMATCH' });
    assert.equal(stream.destroyed, true); assert.equal(cache.stats().bytes, 0); assert.equal(cache.stats().pendingBytes, 0);
  }
});

test('scheduler enforces 4 active, 32 queue and finite pending byte reservations', async () => {
  const scheduler = new ImageLoadScheduler({ maxPendingBytes: 36 });
  const active = await Promise.all(Array.from({ length: 4 }, () => scheduler.acquire(1)));
  const queued = Array.from({ length: 32 }, () => scheduler.acquire(1));
  assert.deepEqual(scheduler.stats(), { active: 4, queued: 32, pendingBytes: 36 });
  await assert.rejects(scheduler.acquire(0), { code: 'IMAGE_BUSY' });
  const queueRelease = []; for (const release of active) release();
  for (let i = 0; i < queued.length; i++) { const release = await queued[i]; queueRelease.push(release); release(); }
  assert.deepEqual(scheduler.stats(), { active: 0, queued: 0, pendingBytes: 0 });
  const bytes = new ImageLoadScheduler({ maxPendingBytes: 8 });
  const release = await bytes.acquire(8);
  await assert.rejects(bytes.acquire(1), { code: 'IMAGE_BUSY' }); release();
  const a = await bytes.acquire(0); const b = await bytes.acquire(0); const c = await bytes.acquire(0); const d = await bytes.acquire(0);
  const abort = new AbortController(); const waiting = bytes.acquire(2, abort.signal); abort.abort(); await assert.rejects(waiting);
  [a,b,c,d].forEach(fn => fn()); assert.equal(bytes.stats().pendingBytes, 0);
});

test('bounded cache memory under load; noncooperative loaders retain scarce slots', async () => {
  const cache = new ImageCache({ maxBytes: 8, maxEntryBytes: 4, maxWaiters: 8, scheduler: new ImageLoadScheduler({ maxPendingBytes: 16 }) });
  const finish = [];
  const slow = async () => { await new Promise(resolve => finish.push(resolve)); return source(value); };
  const pending = Array.from({ length: 8 }, (_, index) => cache.get({ key: `k${index}`, size: 4, load: slow }).catch(error => error.code));
  await tick();
  assert.equal(cache.stats().active, 4); assert.equal(cache.stats().pendingBytes, 16);
  await assert.rejects(cache.get({ key: 'overflow', size: 4, load: slow }), { code: 'IMAGE_BUSY' });
  cache.clear(); assert.equal(cache.stats().active, 4); // aborted noncooperative loads are NOT replaced
  for (const resolve of finish) resolve(); await Promise.all(pending); await tick();
  assert.equal(cache.stats().active, 0); assert.equal(cache.stats().pendingBytes, 0); assert.equal(cache.stats().bytes, 0);
});

test('singleflight subscriber retention and waiter count stay bounded after repeated disconnects', async () => {
  const cache = new ImageCache({ maxWaiters: 4 }); let finish;
  const anchor = cache.get({ key: 'a', size: 4, load: async () => { await new Promise(resolve => { finish = resolve; }); return source(value); } });
  await tick();
  for (let i = 0; i < 200; i++) {
    const controller = new AbortController();
    const waiter = cache.get({ key: 'a', size: 4, load, signal: controller.signal });
    controller.abort(); await assert.rejects(waiter);
    assert.equal(cache.inflight.get('a').subscribers.size, 1);
    assert.equal(cache.stats().waiters, 1);
  }
  const waiters = Array.from({ length: 3 }, () => cache.get({ key: 'a', size: 4, load }));
  await assert.rejects(cache.get({ key: 'a', size: 4, load }), { code: 'IMAGE_BUSY' });
  finish(); await Promise.all([anchor, ...waiters]); assert.equal(cache.stats().waiters, 0);
});

test('load timeout settles callers without opening unlimited abandoned loads', async () => {
  const cache = new ImageCache({ timeoutMs: 10 }); let finish;
  const pending = cache.get({ key: 'a', size: 4, load: async () => { await new Promise(resolve => { finish = resolve; }); return source(value); } });
  const assertion = assert.rejects(pending, { code: 'IMAGE_TIMEOUT' });
  await delay(20); await assertion; assert.equal(cache.stats().active, 1);
  finish(); await tick(); assert.equal(cache.stats().active, 0);
});

async function withService(options, run) {
  let allowed = true, authChecks = 0;
  const service = createImageDelivery(options);
  const server = createServer(async (req, res) => {
    authChecks++;
    if (!allowed) { res.statusCode = 403; res.end(); return; }
    try { await service.deliver({ req, res, metadata: req.url === '/original' ? meta('original', 4, 'original') : req.url === '/big' ? meta('big', 9, 'display') : meta() }); }
    catch (error) { if (!res.headersSent && !res.destroyed) { res.statusCode = 502; res.end(error.code); } }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run({ base: `http://127.0.0.1:${server.address().port}`, service, deny: () => { allowed = false; }, checks: () => authChecks }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('HTTP: warm cache, conditional 304 after auth, revocation wins, safe timings', async () => {
  let calls = 0; const timings = [];
  await withService({ cache: new ImageCache(), fetchObject: async () => { calls++; return source(value); }, onTiming: entry => timings.push(entry) }, async ({ base, deny, checks }) => {
    let response = await fetch(base); assert.equal(await response.text(), 'test');
    assert.equal(response.headers.get('cache-control'), 'private, max-age=300, must-revalidate');
    const etag = response.headers.get('etag'); assert.equal(etag, imageEtag(meta()));
    response = await fetch(base); assert.equal(await response.text(), 'test'); assert.equal(calls, 1);
    response = await fetch(base, { headers: { 'if-none-match': `W/${etag}` } }); assert.equal(response.status, 304); assert.equal(calls, 1);
    deny(); response = await fetch(base, { headers: { 'if-none-match': etag } }); assert.equal(response.status, 403); assert.equal(calls, 1); assert.equal(checks(), 4);
    assert.deepEqual(timings.map(entry => entry.status), ['ok', 'ok', 'not-modified']);
    assert.deepEqual(Object.keys(timings[0]).sort(), ['cache','status','totalMs','upstreamHeadersMs']);
  });
});

test('HTTP: originals/oversized bypass buffering/cache; stream limits checked', async () => {
  const cache = new ImageCache({ maxBytes: 8, maxEntryBytes: 4 }); let calls = 0;
  await withService({ cache, fetchObject: async metadata => { calls++; return source(Buffer.alloc(metadata.size, 'a')); } }, async ({ base }) => {
    for (const route of ['/original','/original','/big','/big']) { const response = await fetch(base + route); assert.equal(response.status, 200); await response.arrayBuffer(); }
    assert.equal(calls, 4); assert.equal(cache.stats().entries, 0);
  });
  await withService({ cache: new ImageCache(), fetchObject: async () => source(value, 5) }, async ({ base }) => {
    const response = await fetch(base); assert.equal(response.status, 502); assert.equal(await response.text(), 'IMAGE_LENGTH_MISMATCH');
  });
});

test('HTTP disconnect tears down uncached upstream body', async () => {
  const cache = new ImageCache(); let stream, began;
  const started = new Promise(resolve => { began = resolve; });
  await withService({ cache, fetchObject: async () => {
    stream = new Readable({ read() {} }); stream.push(Buffer.from('t')); began(); return { body: stream, contentLength: 4 };
  } }, async ({ base, service }) => {
    const abort = new AbortController(); const request = fetch(base + '/original', { signal: abort.signal });
    await started; abort.abort(); await assert.rejects(request);
    for (let i = 0; i < 20 && !stream.destroyed; i++) await delay(5);
    assert.equal(stream.destroyed, true); assert.equal(service.stats().cache.active, 0);
  });
});

test('variant orientation, animation fallback, malformed and pixel/input limits', async () => {
  const jpeg = await sharp({ create: { width: 40, height: 20, channels: 3, background: 'red' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const result = await makeImageVariants(jpeg, 'image/jpeg');
  assert.equal(result.width, 20); assert.equal(result.height, 40);
  const output = await sharp(result.thumb.body).metadata(); assert.equal(output.width, 20); assert.equal(output.height, 40);
  const frames = Buffer.alloc(2 * 2 * 2 * 4, 255);
  frames.fill(0, 0, 16); // Different frames; identical ones are coalesced by libwebp.
  const webp = await sharp(frames, { raw: { width: 2, height: 4, channels: 4, pageHeight: 2 } }).webp({ loop: 0, delay: [100,100] }).toBuffer();
  assert.equal((await sharp(webp, { animated: true }).metadata()).pages, 2);
  const animation = await makeImageVariants(webp, 'image/webp'); assert.equal(animation.thumb, null); assert.equal(animation.display, null); assert.equal(animation.height, 2);
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  assert.equal((await makeImageVariants(gif, 'image/gif')).thumb, null);
  await assert.rejects(makeImageVariants(Buffer.from('not image'), 'image/jpeg'), { code: 'IMAGE_INVALID' });
  await assert.rejects(makeImageVariants(Buffer.alloc(MAX_IMAGE_INPUT_BYTES + 1), 'image/jpeg'), { code: 'IMAGE_TOO_LARGE' });
  const huge = await sharp({ create: { width: 7000, height: 6000, channels: 3, background: 'white' } }).png().toBuffer();
  await assert.rejects(makeImageVariants(huge, 'image/png'), { code: 'IMAGE_TOO_LARGE' });
  assert.deepEqual(imageTransformStats(), { active: 0, queued: 0, pendingBytes: 0 });
});

test('variant transform admission bounds concurrent decode and queued input bytes', async () => {
  const jpeg = await sharp({ create: { width: 1500, height: 1500, channels: 3, background: 'red' } }).jpeg().toBuffer();
  const jobs = Array.from({ length: 12 }, () => makeImageVariants(jpeg, 'image/jpeg'));
  const results = Promise.allSettled(jobs);
  assert.ok(imageTransformStats().active <= 2); assert.ok(imageTransformStats().queued <= 4); assert.ok(imageTransformStats().pendingBytes <= 48 * 1024 * 1024);
  const settled = await results; assert.equal(settled.filter(result => result.status === 'rejected' && result.reason.code === 'IMAGE_TRANSFORM_BUSY').length, 6);
  assert.deepEqual(imageTransformStats(), { active: 0, queued: 0, pendingBytes: 0 });
});


test('HTTP pre-header timeout keeps response available for mapped 503', async () => {
  const service=createImageDelivery({timeoutMs:20,cache:new ImageCache(),fetchObject:async()=>{await delay(60);return source(value);}});
  const server=createServer(async(req,res)=>{try{await service.deliver({req,res,metadata:meta()});}catch(error){assert.equal(res.headersSent,false);assert.equal(res.destroyed,false);res.statusCode=error.code==='IMAGE_TIMEOUT'?503:502;res.end(error.code);}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{const r=await fetch(`http://127.0.0.1:${server.address().port}`);assert.equal(r.status,503);assert.equal(await r.text(),'IMAGE_TIMEOUT');}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('resolver normalizes PostgreSQL bigint and actual fallback variant for delivery', async()=>{
 const row={object_key:'memento_dev/original',size:'4',content_type:'image/jpeg',thumb_object_key:'memento_dev/thumb',thumb_size:'4'};
 const fallback=resolveVariant(row,'display');assert.equal(fallback.variant,'original');assert.equal(fallback.size,4);
 const thumbnail=resolveVariant(row,'thumb');assert.equal(thumbnail.variant,'thumb');assert.equal(thumbnail.size,4);
 const service=createImageDelivery({fetchObject:async()=>source(value),cache:new ImageCache()});
 const server=createServer(async(req,res)=>{await service.deliver({req,res,metadata:req.url==='/fallback'?fallback:thumbnail});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{for(const path of ['/fallback','/thumb']){const r=await fetch(`http://127.0.0.1:${server.address().port}${path}`);assert.equal(r.status,200);assert.equal(await r.text(),'test');}}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
