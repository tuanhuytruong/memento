// Upload admission tests with injected fakes: prove overload is denied before
// any body buffering, reservations are held until the handler settles, and
// disconnects during buffering free capacity while mid-storage ones do not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createUploadAdmission } from '../upload-admission.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const bounded = (promise, ms = 5000) => Promise.race([promise, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('deterministic barrier timeout')), ms); timer.unref(); })]);

function fakeReq(userId = 'u1') {
  const req = new EventEmitter();
  req.user = { id: userId };
  req.destroy = reason => { req.destroyed = reason; };
  return req;
}
function fakeRes() {
  const res = new EventEmitter();
  res.headers = {};
  res.setHeader = (key, value) => { res.headers[key] = value; };
  res.status = code => { res.statusCode = code; return res; };
  res.json = body => { res.body = body; return res; };
  return res;
}
function admit(admission, req, res) {
  let error = null; let passed = false;
  admission.admit(req, res, e => { if (e) error = e; else passed = true; });
  return { error, passed };
}

test('overload is denied immediately with retryable 503 and reserves nothing', () => {
  const admission = createUploadAdmission({ maxConcurrent: 1, reservationBytes: 100, maxReservedBytes: 1000 });
  const first = fakeReq('u1'); const firstRes = fakeRes();
  assert.ok(admit(admission, first, firstRes).passed);
  assert.deepEqual(admission.stats(), { active: 1, reservedBytes: 100, perAccount: 1 });
  const deniedReq = fakeReq('u2'); const deniedRes = fakeRes();
  const denied = admit(admission, deniedReq, deniedRes);
  assert.equal(denied.passed, false, 'second account is denied while the slot is held');
  assert.equal(deniedRes.statusCode, 503);
  assert.equal(deniedRes.headers['Retry-After'], '2');
  assert.equal(deniedRes.headers['Cache-Control'], 'no-store');
  assert.equal(admission.stats().reservedBytes, 100, 'a denied request reserves nothing');
  assert.equal(deniedReq.releaseUploadSlot, undefined, 'denied request gets no slot handle');
});

test('per-account cap and byte cap are independent of the global cap', () => {
  const admission = createUploadAdmission({ maxConcurrent: 4, perAccountConcurrent: 1, reservationBytes: 100, maxReservedBytes: 250 });
  assert.ok(admit(admission, fakeReq('u1'), fakeRes()).passed);
  const sameAccount = admit(admission, fakeReq('u1'), fakeRes());
  assert.equal(sameAccount.passed, false, 'same account cannot hold two uploads');
  assert.ok(admit(admission, fakeReq('u2'), fakeRes()).passed, 'another account is admitted');
  const overBytes = admit(admission, fakeReq('u3'), fakeRes());
  assert.equal(overBytes.passed, false, 'byte cap rejects before reservation');
  assert.equal(admission.stats().reservedBytes, 200);
});

test('handler-owned release frees capacity exactly once, including on failure', () => {
  const admission = createUploadAdmission();
  const req = fakeReq('u1'); const res = fakeRes();
  assert.ok(admit(admission, req, res).passed);
  assert.equal(admission.stats().active, 1);
  // The handler runs (uploadHandlerStarted) and settles; double release is safe.
  req.uploadHandlerStarted = true;
  req.releaseUploadSlot();
  req.releaseUploadSlot();
  assert.deepEqual(admission.stats(), { active: 0, reservedBytes: 0, perAccount: 0 });
  // Negative drift must be impossible even if release is called again late.
  req.releaseUploadSlot();
  assert.equal(admission.stats().active, 0);
});

test('disconnect during buffering frees the reservation; after handler start it does not', () => {
  const admission = createUploadAdmission();
  // Case 1: client goes away before the handler ever starts.
  const buffering = fakeReq('u1'); const bufferingRes = fakeRes();
  assert.ok(admit(admission, buffering, bufferingRes).passed);
  assert.equal(admission.stats().active, 1);
  bufferingRes.emit('close');
  assert.equal(admission.stats().active, 0, 'buffering-phase disconnect frees capacity');
  // Case 2: client goes away while storage work is still in flight.
  const storage = fakeReq('u2'); const storageRes = fakeRes();
  assert.ok(admit(admission, storage, storageRes).passed);
  storage.uploadHandlerStarted = true;
  storageRes.emit('close');
  assert.equal(admission.stats().active, 1, 'mid-storage disconnect keeps the reservation until the handler settles');
  storage.releaseUploadSlot();
  assert.equal(admission.stats().active, 0);
});

test('a stalled body is destroyed so a reservation cannot be pinned forever', async () => {
  const admission = createUploadAdmission({ slowBodyMs: 60 });
  const req = fakeReq('u1'); const res = fakeRes();
  assert.ok(admit(admission, req, res).passed);
  await bounded(new Promise(resolve => setTimeout(resolve, 120)));
  assert.ok(req.destroyed, 'stalled body socket is destroyed');
  assert.match(req.destroyed.code, /UPLOAD_BODY_STALLED/);
  // The disconnect path then frees the reservation.
  res.emit('close');
  assert.equal(admission.stats().active, 0);
});

test('a completed body clears the stall guard before the handler runs', async () => {
  const admission = createUploadAdmission({ slowBodyMs: 60 });
  const req = fakeReq('u1'); const res = fakeRes();
  assert.ok(admit(admission, req, res).passed);
  req.emit('end'); // body fully buffered: handler path now owns the slot
  await bounded(new Promise(resolve => setTimeout(resolve, 120)));
  assert.equal(req.destroyed, undefined, 'no stall destroy after the body completed');
  req.uploadHandlerStarted = true;
  req.releaseUploadSlot();
  assert.equal(admission.stats().active, 0);
});

test('unauthenticated admission is an error, never an implicit slot', () => {
  const admission = createUploadAdmission();
  const req = fakeReq(); req.user = undefined;
  const result = admit(admission, req, fakeRes());
  assert.ok(result.error, 'missing authentication must fail the request');
  assert.equal(admission.stats().active, 0);
});
