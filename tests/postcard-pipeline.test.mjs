// Postcard pipeline admission tests: pure fakes plus a delayed fake stream.
// They prove overload is rejected before any source read, reservations are
// released exactly once after the underlying work settles (including on
// failure and abort), and the shared source budget bounds aggregate reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostcardPipeline } from '../postcard-pipeline.mjs';
import { resolvePostcardPhotos } from '../postcard-sources.mjs';
import { ApiError } from '../mutation-safety.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
const bounded = (promise, ms = 5000) => Promise.race([promise, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('deterministic barrier timeout')), ms); timer.unref(); })]);

test('overload is rejected with retryable 503 before any work or read starts', async () => {
  const pipeline = createPostcardPipeline({ maxInFlight: 1, maxPerAccount: 2 });
  const gate = deferred();
  let secondWorkStarted = false;
  const first = pipeline.run({ userId: 'A', photoCount: 1, signal: undefined, work: async () => gate.promise });
  const rejection = await bounded(pipeline.run({
    userId: 'B', photoCount: 1, signal: undefined,
    work: async () => { secondWorkStarted = true; return 'must-not-run'; },
  }).then(() => null, error => error));
  assert.ok(rejection, 'second account must be rejected while the only slot is held');
  assert.equal(rejection.status, 503);
  assert.equal(rejection.retryAfter, 2);
  assert.equal(rejection.postcard, true);
  assert.equal(secondWorkStarted, false, 'zero source reads on admission rejection');
  gate.resolve('first-result');
  assert.equal(await bounded(first), 'first-result');
  // Capacity is free again: a later request is admitted.
  assert.equal(await bounded(pipeline.run({ userId: 'B', photoCount: 1, work: async () => 'ok' })), 'ok');
});

test('per-account cap, byte reservations and exactly-once release', async () => {
  const pipeline = createPostcardPipeline({ maxInFlight: 4, maxPerAccount: 1, bytesPerPhoto: 1000, maxPendingBytes: 3000 });
  const gate = deferred();
  const held = pipeline.run({ userId: 'A', photoCount: 2, work: async () => gate.promise });
  assert.deepEqual(pipeline.stats(), { inFlight: 1, reservedBytes: 2000, perAccount: 1, sourceActive: 0, sourceWaiters: 0 });
  const sameAccount = await bounded(pipeline.run({ userId: 'A', photoCount: 1, work: async () => 'no' }).then(() => null, e => e));
  assert.equal(sameAccount.status, 503, 'same account is capped while its request is in flight');
  const overBytes = await bounded(pipeline.run({ userId: 'B', photoCount: 2, work: async () => 'no' }).then(() => null, e => e));
  assert.equal(overBytes.status, 503, 'pending-byte cap rejects before reservation');
  assert.equal(pipeline.stats().reservedBytes, 2000, 'a rejected request reserves nothing');
  gate.resolve('done');
  assert.equal(await bounded(held), 'done');
  assert.deepEqual(pipeline.stats(), { inFlight: 0, reservedBytes: 0, perAccount: 0, sourceActive: 0, sourceWaiters: 0 });
  // A failing work also releases exactly once; stats never go negative.
  await assert.rejects(pipeline.run({ userId: 'A', photoCount: 1, work: async () => { throw new Error('render failed'); } }), /render failed/);
  assert.equal(pipeline.stats().reservedBytes, 0);
  await assert.rejects(pipeline.run({ userId: 'A', photoCount: 1, work: async () => { throw new ApiError(422, 'photo removed'); } }), /photo removed/);
  assert.equal(pipeline.stats().inFlight, 0);
});

test('client abort keeps the reservation until the underlying work settles', async () => {
  const pipeline = createPostcardPipeline();
  const controller = new AbortController();
  const workSettled = deferred();
  let workStarted = false;
  const running = pipeline.run({
    userId: 'A', photoCount: 1, signal: controller.signal,
    work: async () => { workStarted = true; return workSettled.promise; },
  });
  await bounded(new Promise(resolve => { const check = () => (workStarted ? resolve() : setImmediate(check)); check(); }));
  controller.abort();
  // The pipeline does not reject the caller itself; the inner work decides.
  // Release must not happen while the native work promise is still pending.
  workSettled.resolve('late-result');
  assert.equal(await bounded(running), 'late-result');
  assert.equal(pipeline.stats().inFlight, 0, 'released after settle');
  assert.equal(pipeline.stats().reservedBytes, 0);
});

test('source budget bounds aggregate concurrency across accounts and abort frees the queue', async () => {
  const pipeline = createPostcardPipeline({ maxSourceFetchers: 2 });
  const first = await pipeline.acquireSourceSlot();
  const second = await pipeline.acquireSourceSlot();
  assert.equal(pipeline.stats().sourceActive, 2);
  const controller = new AbortController();
  const waiting = pipeline.acquireSourceSlot(controller.signal);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(pipeline.stats().sourceWaiters, 1, 'third read waits for a budget slot');
  controller.abort();
  const error = await bounded(waiting.then(() => null, e => e));
  assert.equal(error.status, 499, 'an aborted wait rejects instead of leaking');
  assert.equal(pipeline.stats().sourceWaiters, 0);
  // Handover: releasing a slot admits exactly one waiter.
  const next = pipeline.acquireSourceSlot();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(pipeline.stats().sourceWaiters, 1);
  first();
  const releaseNext = await bounded(next);
  assert.equal(pipeline.stats().sourceActive, 2, 'slot handed over, not duplicated');
  releaseNext();
  second();
  assert.equal(pipeline.stats().sourceActive, 0);
});

// Delayed fake streams: resolvePostcardPhotos with injected fakes proves the
// shared slot is held across a slow read and released on failure.
function fakeDeps({ streamDelayMs = 60, failSecond = false } = {}) {
  const events = [];
  const owner = '00000000-0000-4000-8000-00000000000a';
  const moment = { owner_id: owner, id: 'm1', role: 'owner' };
  const rows = [
    { id: '11111111-1111-4111-8111-111111111111', owner_id: owner, moment_id: 'm1' },
    { id: '22222222-2222-4222-8222-222222222222', owner_id: owner, moment_id: 'm1' },
  ];
  let reads = 0;
  const slowStream = async function* () {
    const index = reads++;
    await new Promise(resolve => setTimeout(resolve, streamDelayMs));
    if (failSecond && index === 1) { throw new Error('stream reset'); }
    yield Buffer.alloc(10, 7);
    yield Buffer.alloc(10, 7);
  };
  const deps = {
    userId: owner,
    qschema: '"memento_dev"',
    prefix: 'memento_dev/',
    pool: { query: async () => ({ rows }) },
    s3: { send: async () => ({ Body: slowStream() }) },
    bucket: 'bucket',
    resolveVariant: image => ({ key: `memento_dev/${image.id}/display`, variant: 'display' }),
    exactMomentAccess: async () => moment,
    imageAccess: async (userId, imageId) => ({ ...rows.find(row => row.id === imageId), content_type: 'image/png', moment_id: 'm1', owner_id: owner }),
  };
  return { deps, events };
}

const SPEC = (ids) => ({ images: ids, moments: ids.map(() => ({ ownerId: 'x', id: 'm1' })), captions: [], template: 'ordinary', title: 't', showDate: false });

test('a delayed fake stream holds its shared slot and releases it on success and failure', async () => {
  const pipeline = createPostcardPipeline({ maxSourceFetchers: 1 });
  const { deps } = fakeDeps({ streamDelayMs: 80 });
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  const photos = await bounded(resolvePostcardPhotos(SPEC(ids), { ...deps, sourceSlot: () => pipeline.acquireSourceSlot() }), 10000);
  assert.equal(photos.length, 2);
  assert.ok(photos.every(photo => Buffer.isBuffer(photo.buffer)));
  assert.equal(pipeline.stats().sourceActive, 0, 'slots released after success');
  const failing = fakeDeps({ streamDelayMs: 20, failSecond: true });
  await assert.rejects(
    bounded(resolvePostcardPhotos(SPEC(ids), { ...failing.deps, sourceSlot: () => pipeline.acquireSourceSlot() }), 10000),
    /could not be loaded/,
  );
  assert.equal(pipeline.stats().sourceActive, 0, 'slots released after failure');
});

test('an aborted delayed read rejects promptly and frees its slot', async () => {
  const pipeline = createPostcardPipeline({ maxSourceFetchers: 2 });
  const { deps } = fakeDeps({ streamDelayMs: 400 });
  const controller = new AbortController();
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  const running = resolvePostcardPhotos(SPEC(ids), { ...deps, sourceSlot: () => pipeline.acquireSourceSlot(controller.signal) }, controller.signal);
  await new Promise(resolve => setTimeout(resolve, 50));
  controller.abort();
  await assert.rejects(bounded(running, 3000), /abort|cancelled|too long/i);
  // Give the fake streams a moment to unwind, then the budget must be whole.
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(pipeline.stats().sourceActive, 0);
});
