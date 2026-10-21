import test from 'node:test';
import assert from 'node:assert/strict';
import { createUploadTiming, outcomeForResponse, logUploadDiagnostic, UPLOAD_STAGES, UPLOAD_OUTCOMES } from '../upload-timing.mjs';

function harness() {
  const clock = { t: 100 };
  const records = [];
  const timing = createUploadTiming({
    now: () => clock.t,
    randomUUID: () => 'diag-0001',
    log: record => records.push(record),
  });
  const advance = ms => { clock.t += ms; };
  return { clock, records, timing, advance };
}

test('a stage that was never reached stays absent instead of reporting 0 ms', () => {
  const { timing, advance, records } = harness();
  timing.begin('auth');
  advance(12);
  timing.end('auth');
  const record = timing.finish({ outcome: 'completed', statusCode: 201 });
  assert.deepEqual(record.stages, { auth: 12 });
  assert.equal('transform' in record.stages, false, 'unreached stage must not appear');
  assert.equal(Object.values(record.stages).includes(0), false, 'no stage is fabricated as zero');
  assert.equal(records.length, 1);
});

test('a stage that was begun is settled at the terminal boundary', () => {
  const { timing, advance } = harness();
  timing.begin('respond');
  advance(4);
  assert.deepEqual(timing.pendingStages, ['respond']);
  const record = timing.finish({ outcome: 'completed', statusCode: 201 });
  assert.equal(record.stages.respond, 4);
  assert.deepEqual(timing.pendingStages, []);
});

test('repeated spans of one stage accumulate', () => {
  const { timing, advance } = harness();
  for (const ms of [5, 7]) {
    timing.begin('preflight');
    advance(ms);
    timing.end('preflight');
  }
  const record = timing.finish();
  assert.equal(record.stages.preflight, 12);
});

test('only one terminal record is emitted, even when finish is called twice', () => {
  const { timing, records } = harness();
  const first = timing.finish({ outcome: 'completed', statusCode: 201 });
  const second = timing.finish({ outcome: 'failed', statusCode: 500 });
  assert.ok(first);
  assert.equal(second, null);
  assert.equal(records.length, 1);
  assert.equal(records[0].outcome, 'completed');
});

test('outcome mapping distinguishes completed, replayed, rejected and disconnect', () => {
  const finished = (statusCode, hint = null) => outcomeForResponse({ writableFinished: true, statusCode }, hint);
  assert.equal(finished(201), 'completed');
  assert.equal(finished(200, 'replayed'), 'replayed');
  assert.equal(finished(409), 'rejected');
  assert.equal(finished(503), 'rejected');
  assert.equal(outcomeForResponse({ writableFinished: false, statusCode: 0 }), 'disconnect');
  assert.equal(outcomeForResponse(undefined), 'disconnect');
});

test('a disconnect record keeps the stages that were reached', () => {
  const { timing, advance, records } = harness();
  timing.begin('body');
  advance(900);
  timing.end('body');
  timing.begin('transform');
  advance(50);
  const record = timing.finish({ outcome: outcomeForResponse({ writableFinished: false, statusCode: 0 }) });
  assert.equal(record.outcome, 'disconnect');
  assert.equal(record.status, null);
  assert.equal(record.stages.body, 900);
  assert.equal(record.stages.transform, 50);
  assert.equal(records.length, 1);
});

test('unknown stage and outcome labels are rejected', () => {
  const { timing } = harness();
  assert.throws(() => timing.begin('r2'), TypeError);
  assert.throws(() => timing.mark('client-note', 5), TypeError);
  assert.throws(() => timing.markOutcome('exploded'), TypeError);
  assert.throws(() => timing.finish({ outcome: 'melted' }), TypeError);
  assert.equal(UPLOAD_STAGES.includes('r2'), false);
  assert.equal(UPLOAD_OUTCOMES.includes('melted'), false);
});

test('the record carries no payload, identity or error text', () => {
  const { timing, advance } = harness();
  timing.begin('transform');
  advance(166);
  timing.end('transform');
  timing.note('original', 322187);
  timing.note('thumb', 12980);
  timing.note('display', 84690);
  timing.note('received', 1700000);
  const record = timing.finish({ outcome: 'completed', statusCode: 201 });
  assert.deepEqual(Object.keys(record).sort(), ['bytes', 'diagnosticId', 'event', 'outcome', 'stages', 'status', 'totalMs']);
  assert.deepEqual(record.bytes, { original: 322187, thumb: 12980, display: 84690, received: 1700000 });
  const line = logUploadDiagnostic(record, () => {});
  for (const forbidden of ['error', 'stack', 'filename', 'objectKey', 'http', 'token', 'ownerId', 'momentId', 'caption']) {
    assert.equal(line.includes(forbidden), false, `diagnostic line must not contain ${forbidden}`);
  }
});

test('byte counts ignore unknown labels and invalid numbers', () => {
  const { timing } = harness();
  timing.note('secret', 10);
  timing.note('original', -1);
  timing.note('thumb', 1.5);
  timing.note('display', 'not-a-number');
  assert.deepEqual(timing.finish().bytes, {});
});

test('mark records a duration measured elsewhere without inventing a span', () => {
  const { timing } = harness();
  timing.mark('r2.original', 1975.4);
  timing.mark('r2.thumb', 210);
  const record = timing.finish();
  assert.equal(record.stages['r2.original'], 1975.4);
  assert.equal(record.stages['r2.thumb'], 210);
  assert.equal('auth' in record.stages, false);
});

test('Server-Timing lists only reached stages plus a partial total', () => {
  const { timing, advance } = harness();
  timing.begin('auth');
  advance(3);
  timing.end('auth');
  timing.mark('r2.original', 1975.4);
  advance(10);
  const header = timing.serverTimingHeader();
  assert.equal(header, 'up-auth;dur=3, up-r2_original;dur=1975.4, up-total;dur=13');
  for (const metric of header.split(',')) {
    const name = metric.trim().split(';')[0];
    assert.match(name, /^[A-Za-z][A-Za-z0-9_-]{0,39}$/, `${name} must be a valid Server-Timing token`);
  }
  assert.equal(/up-transform/.test(header), false, 'unreached stage is not advertised');
});

test('measureAsync and measureSync time their work and still propagate failures', async () => {
  const { timing, advance } = harness();
  const value = await timing.measureAsync('commit', async () => { advance(30); return 'ok'; });
  assert.equal(value, 'ok');
  assert.equal(timing.snapshot().stages.commit, 30);
  assert.equal(timing.measureSync('staging', () => { advance(2); return 7; }), 7);
  await assert.rejects(timing.measureAsync('transform', async () => { advance(8); throw new Error('sharp exploded'); }));
  const record = timing.finish({ outcome: 'failed', statusCode: 500 });
  assert.equal(record.stages.transform, 8, 'a failed span is still measured');
  assert.equal(JSON.stringify(record).includes('sharp exploded'), false);
});

test('a throwing log sink cannot fail the request', () => {
  const clock = { t: 0 };
  const timing = createUploadTiming({ now: () => clock.t, log: () => { throw new Error('sink down'); }, onFinish: () => { throw new Error('hook down'); } });
  const record = timing.finish({ outcome: 'completed', statusCode: 201 });
  assert.equal(record.outcome, 'completed');
});

test('snapshot is a copy, so callers cannot mutate recorded timings', () => {
  const { timing, advance } = harness();
  timing.begin('auth');
  advance(5);
  timing.end('auth');
  const first = timing.snapshot();
  first.stages.auth = 999;
  assert.equal(timing.snapshot().stages.auth, 5);
});
