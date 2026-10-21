// Upload deadline: one attempt may hold the save gate for 30 seconds and no longer.
//
// The bug this guards is a request that never leaves the device: nothing to time out
// on the server, nothing in the nginx log, and a save gate that stays closed forever.
// Timers are mocked, so the assertion is about the contract, not about wall-clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataApi, UPLOAD_DEADLINE_MS, UploadAbortedError } from '../src/lib/api.ts';

const file = new File([new Blob([new Uint8Array(24)], { type: 'image/jpeg' })], 'qa-fixture.jpg', { type: 'image/jpeg' });

/** Answer like a stalled network: the promise settles only when the signal aborts. */
function stallUntilAborted(init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return; // never settles: an upload without a deadline would hang here
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
}

function stubFetch(handler: (init?: RequestInit) => Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => handler(init)) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test('the deadline is 30 seconds', () => {
  assert.equal(UPLOAD_DEADLINE_MS, 30_000);
});

test('a stalled upload fails at the deadline instead of hanging forever', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const restore = stubFetch(stallUntilAborted);
  try {
    const settled = assert.rejects(
      dataApi.uploadImage(file, 'moment-1', 'owner-1', 'upload-1'),
      (error: unknown) => error instanceof UploadAbortedError && error.timeout === true,
    );
    t.mock.timers.tick(UPLOAD_DEADLINE_MS - 1);
    t.mock.timers.tick(1);
    await settled;
  } finally {
    restore();
  }
});

test('a deadline that beats the network is retryable, not a rejected save', () => {
  const timeout = new UploadAbortedError(true);
  const interrupted = new UploadAbortedError(false);
  assert.equal(timeout.name, 'UploadAbortedError');
  assert.equal(timeout.timeout, true);
  assert.equal(interrupted.timeout, false);
  // Both wordings promise a retry: the photo is still on the device.
  assert.match(timeout.message, /retried/i);
  assert.match(interrupted.message, /interrupted/i);
});

test('the caller signal aborts the attempt and is not reported as a timeout', async () => {
  const controller = new AbortController();
  const restore = stubFetch(stallUntilAborted);
  try {
    const pending = dataApi.uploadImage(file, 'moment-1', 'owner-1', 'upload-2', undefined, controller.signal);
    const settled = assert.rejects(pending, (error: unknown) => error instanceof UploadAbortedError && error.timeout === false);
    controller.abort();
    await settled;
  } finally {
    restore();
  }
});

test('an upload that answers inside the deadline resolves normally', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const restore = stubFetch(async () => new Response(JSON.stringify({ image: { id: 'img-1' } }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  }));
  try {
    const uploaded = await dataApi.uploadImage(file, 'moment-1', 'owner-1', 'upload-3');
    assert.equal((uploaded as { image?: { id?: string } }).image?.id, 'img-1');
  } finally {
    restore();
  }
});
