import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIAGNOSTIC_LIMIT,
  STAGE_LABEL_LIMIT,
  createUploadDiagnostics,
  describeUploadTiming,
  parseServerTiming,
  phaseDiagnostic,
} from '../src/lib/uploadDiagnostics.ts';

const disabled = createUploadDiagnostics();
const enabled = () => createUploadDiagnostics({ enabled: true });

test('diagnostics are off by default and record nothing', () => {
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.record(phaseDiagnostic('prepare', 120)), null);
  assert.deepEqual(disabled.snapshot(), []);
});

test('Server-Timing parsing keeps only numeric, well-formed metrics', () => {
  assert.deepEqual(parseServerTiming('up-auth;dur=3.5, up-r2_original;dur=1975.4, up-total;dur=2100'), {
    'up-auth': 3.5,
    'up-r2_original': 1975.4,
    'up-total': 2100,
  });
  assert.equal(parseServerTiming('up-auth;desc="no duration"'), null);
  assert.equal(parseServerTiming('bad name;dur=5'), null);
  assert.equal(parseServerTiming('up-auth;dur=-4'), null);
  assert.equal(parseServerTiming(''), null);
  assert.equal(parseServerTiming(null), null);
  const many = Array.from({ length: 40 }, (_, index) => `up-s${index};dur=${index}`).join(', ');
  assert.equal(Object.keys(parseServerTiming(many) ?? {}).length, STAGE_LABEL_LIMIT);
});

test('an upload diagnostic separates origin work from the unattributed remainder', () => {
  const diagnostic = describeUploadTiming({
    uploadId: '1f7c9e2a-4dd0-4f31-9a1a-9d0b6f4a2c11',
    clientMs: 40000,
    timing: {
      headerMs: 39900,
      bodyMs: 90,
      status: 201,
      serverTiming: 'up-body;dur=1200, up-transform;dur=166, up-r2_original;dur=980, up-total;dur=2400',
      diagnosticId: '6c1d2f0e-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
    },
  });
  assert.equal(diagnostic.kind, 'image-upload');
  assert.equal(diagnostic.clientMs, 40000);
  assert.equal(diagnostic.serverMs, 2400);
  assert.equal(diagnostic.transitMs, 37600);
  assert.equal(diagnostic.status, 201);
  assert.equal(diagnostic.stages?.['up-r2_original'], 980);
});

test('a missing Server-Timing header leaves server and transit unknown, not zero', () => {
  const diagnostic = describeUploadTiming({ clientMs: 5000, timing: { headerMs: 5000, bodyMs: 1, status: 504, serverTiming: null, diagnosticId: null } });
  assert.equal(diagnostic.serverMs, null);
  assert.equal(diagnostic.transitMs, null);
  assert.equal(diagnostic.stages, null);
  assert.equal(diagnostic.status, 504);
});

test('a remainder that rounds negative is clamped instead of reported as transit', () => {
  const diagnostic = describeUploadTiming({ clientMs: 100, timing: { headerMs: 100, bodyMs: 1, status: 201, serverTiming: 'up-total;dur=120', diagnosticId: 'abc' } });
  assert.equal(diagnostic.transitMs, 0);
});

test('the ring is bounded and drops the oldest entries first', () => {
  const diagnostics = enabled();
  for (let index = 0; index < DIAGNOSTIC_LIMIT + 10; index += 1) diagnostics.record(phaseDiagnostic('prepare', index));
  const snapshot = diagnostics.snapshot();
  assert.equal(snapshot.length, DIAGNOSTIC_LIMIT);
  assert.equal(snapshot[0].clientMs, 10);
  assert.equal(snapshot.at(-1)?.clientMs, DIAGNOSTIC_LIMIT + 9);
  assert.equal(diagnostics.limit, DIAGNOSTIC_LIMIT);
});

test('clear() empties the ring on a session change', () => {
  const diagnostics = enabled();
  diagnostics.record(phaseDiagnostic('reconcile', 12));
  assert.equal(diagnostics.snapshot().length, 1);
  diagnostics.clear();
  assert.deepEqual(diagnostics.snapshot(), []);
});

test('records carry only bounded, allow-listed fields', () => {
  const diagnostics = enabled();
  const recorded = diagnostics.record({
    kind: 'image-upload',
    uploadId: 'not a valid id ❤️',
    clientMs: 1200,
    serverMs: null,
    transitMs: null,
    status: 12345,
    diagnosticId: 'x'.repeat(200),
    stages: { 'up-auth': 3, bad_label_is_far_too_long_for_a_metric_name_and_must_be_dropped: 4, 'up-total': -1 },
  });
  assert.ok(recorded);
  assert.equal(recorded.uploadId, null, 'a non-identifier upload id is dropped');
  assert.equal(recorded.diagnosticId, null, 'an over-long diagnostic id is dropped');
  assert.equal(recorded.status, null, 'an impossible status is dropped');
  assert.deepEqual(recorded.stages, { 'up-auth': 3 });
  const serialised = JSON.stringify(recorded);
  for (const forbidden of ['caption', 'filename', 'objectKey', 'token', 'http']) {
    assert.equal(serialised.includes(forbidden), false, `record must not carry ${forbidden}`);
  }
});

test('an unknown kind is refused so private payloads cannot ride in as a new label', () => {
  const diagnostics = enabled();
  // @ts-expect-error the kind vocabulary is closed on purpose
  assert.equal(diagnostics.record({ kind: 'caption-dump', clientMs: 1 }), null);
});

test('snapshot is a copy: mutating it cannot corrupt the ring', () => {
  const diagnostics = enabled();
  diagnostics.record(describeUploadTiming({ clientMs: 900, timing: { headerMs: 900, bodyMs: 1, status: 201, serverTiming: 'up-total;dur=400', diagnosticId: 'diag' } }));
  const snapshot = diagnostics.snapshot();
  snapshot[0].clientMs = 999999;
  if (snapshot[0].stages) snapshot[0].stages['up-total'] = 1;
  assert.equal(diagnostics.snapshot()[0].clientMs, 900);
  assert.equal(diagnostics.snapshot()[0].stages?.['up-total'], 400);
});

test('the local-first lifecycle is recorded with closed labels only', () => {
  const diagnostics = enabled();
  for (const kind of ['upload-start', 'upload-abort-timeout', 'upload-abort-session', 'upload-failed', 'upload-resume', 'upload-committed'] as const) {
    const record = diagnostics.record(phaseDiagnostic(kind, 0, 'upload-abc123'));
    assert.ok(record, `${kind} must be accepted`);
    assert.equal(record?.kind, kind);
    assert.equal(record?.uploadId, 'upload-abc123');
    // Nothing about the photo itself: no name, no size, no caption.
    assert.equal(JSON.stringify(record).includes('jpg'), false);
  }
  assert.equal(diagnostics.snapshot().length, 6);
  // An id that is not a plain token is dropped, and the record keeps its label.
  const unsafe = diagnostics.record(phaseDiagnostic('upload-abort-timeout', 0, '../../etc/passwd'));
  assert.equal(unsafe?.kind, 'upload-abort-timeout');
  assert.equal(unsafe?.uploadId, null, 'an unsafe correlation id is dropped instead of stored');
});

test('an aborted attempt and a committed attempt are distinguishable in the snapshot', () => {
  const diagnostics = enabled();
  diagnostics.record(phaseDiagnostic('upload-abort-timeout', 0, 'one'));
  diagnostics.record(describeUploadTiming({ uploadId: 'one', clientMs: 30_010, timing: { headerMs: 30_000, bodyMs: 2, status: 0, serverTiming: null, diagnosticId: null } }));
  diagnostics.record(phaseDiagnostic('upload-committed', 0, 'two'));
  const kinds = diagnostics.snapshot().map((entry) => entry.kind);
  assert.deepEqual(kinds, ['upload-abort-timeout', 'image-upload', 'upload-committed']);
});
