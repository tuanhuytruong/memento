// Runtime lifecycle unit tests with injected fakes: no database, no storage.
// They prove the deployed entrypoints start/stop the leased cleanup worker
// exactly once and respect the documented shutdown bound.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../runtime-lifecycle.mjs';
import { startCleanup } from '../object-cleanup.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const bounded = (promise, ms = 5000) => Promise.race([promise, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('deterministic barrier timeout')), ms); timer.unref(); })]);

function fakeDeps({ drainImpl = async () => ({ claimed: 0, completed: 0, failed: 0 }) } = {}) {
  const events = [];
  const cleanup = { drain: drainImpl, enqueue: async () => null, abandon: async () => {}, attach: async () => {} };
  const pool = { end: async () => { events.push('pool-end'); } };
  const app = {
    listen(port, host, callback) {
      events.push('listen');
      const server = { close(cb) { events.push('server-close'); cb?.(); } };
      queueMicrotask(callback);
      return server;
    },
  };
  return { events, cleanup, pool, app };
}

test('start begins the cleanup worker and listener; a second start is a no-op', async () => {
  let drains = 0;
  const { events, cleanup, pool, app } = fakeDeps({ drainImpl: async () => { drains += 1; return { claimed: 0, completed: 0, failed: 0 }; } });
  const runtime = createRuntime({ app, pool, cleanup });
  const first = runtime.start({ port: 0 });
  const second = runtime.start({ port: 0 });
  assert.equal(first, second, 'start must return the same instance');
  await bounded(new Promise(resolve => { const check = () => (drains >= 1 ? resolve() : setImmediate(check)); check(); }));
  assert.equal(events.filter(e => e === 'listen').length, 1, 'exactly one listener');
  assert.ok(runtime.current === first);
  await first.stop({ settleMs: 1000 });
  assert.ok(events.indexOf('server-close') < events.indexOf('pool-end'), 'listener closes before the pool');
});

test('stop waits for an in-flight drain within the bound, then closes in order', async () => {
  const drainStarted = deferred(), resumeDrain = deferred();
  const { events, cleanup, pool, app } = fakeDeps({ drainImpl: async () => { drainStarted.resolve(); await resumeDrain.promise; return { claimed: 1, completed: 1, failed: 0 }; } });
  const runtime = createRuntime({ app, pool, cleanup });
  const started = runtime.start({ port: 0 });
  await bounded(drainStarted.promise);
  const stopping = started.stop({ settleMs: 3000 });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(!events.includes('server-close'), 'in-flight drain is awaited before closing');
  resumeDrain.resolve();
  const result = await bounded(stopping);
  assert.deepEqual(result, { settled: true, passed: true });
  assert.ok(events.indexOf('server-close') < events.indexOf('pool-end'));
});

test('a wedged drain is reported unsettled at the bound and never blocks the pool forever', async () => {
  const drainStarted = deferred();
  const { events, cleanup, pool, app } = fakeDeps({ drainImpl: async () => { drainStarted.resolve(); await new Promise(() => {}); } });
  const runtime = createRuntime({ app, pool, cleanup });
  const started = runtime.start({ port: 0 });
  await bounded(drainStarted.promise);
  const result = await bounded(started.stop({ settleMs: 120 }), 3000);
  assert.equal(result.settled, false, 'a still-running drain must be reported, not hidden');
  assert.ok(events.includes('server-close') && events.includes('pool-end'), 'shutdown still completes');
});

test('startCleanup stops admitting drains after stop and is idempotent', async () => {
  let drains = 0;
  const queue = { drain: async () => { drains += 1; return { claimed: 0, completed: 0, failed: 0 }; } };
  const handle = startCleanup(queue, () => { throw new Error('onError must not run for a healthy queue'); });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(drains, 1, 'the first pass runs immediately');
  const first = await handle.stop({ settleMs: 500 });
  assert.equal(first.settled, true);
  const second = await handle.stop({ settleMs: 500 });
  assert.equal(second.settled, true);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(drains, 1, 'no drain pass is admitted after stop');
});

test('a failing drain reports through onError and stop still settles', async () => {
  const errored = deferred();
  const queue = { drain: async () => { throw new Error('storage offline'); } };
  const handle = startCleanup(queue, () => errored.resolve());
  await bounded(errored.promise);
  const result = await handle.stop({ settleMs: 500 });
  assert.equal(result.settled, true);
});


test('background sampling never overlaps and stop fences future ticks', async () => {
  const entered = deferred(), released = deferred(); let calls = 0;
  const deps = fakeDeps();
  const runtime = createRuntime({ ...deps, backgroundIntervalMs: 5, backgroundTick: async () => { calls++; entered.resolve(); await released.promise; } });
  const running = runtime.start({ port: 0 });
  const keepAlive = setInterval(() => {}, 100);
  try { await bounded(entered.promise); } finally { clearInterval(keepAlive); };

  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(calls, 1);
  const stopping = running.stop({ settleMs: 500 });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert(!deps.events.includes('pool-end'));
  released.resolve(); await bounded(stopping);
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(calls, 1);
});
