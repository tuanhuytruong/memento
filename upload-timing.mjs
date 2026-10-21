// Stage timing for the authenticated image upload route.
//
// Contract:
// - Closed stage labels only. A client cannot submit a label, and no request
//   payload, object key, identity, filename, IP or raw error text is recorded.
// - A stage that was never reached is ABSENT from the record. It is never
//   reported as 0 ms, because "not measured" and "instant" are different facts.
// - Exactly one structured terminal record per request: success, denial, error
//   and client-disconnect paths all funnel through finish().
// - Server-Timing exposes the same closed labels so a browser can subtract
//   origin-side work from its own fetch timings. Neither side can measure
//   transit before the request reaches this process.
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

export const UPLOAD_STAGES = Object.freeze([
  'auth',
  'admission',
  'body',
  'preflight',
  'transform',
  'staging',
  'r2.original',
  'r2.thumb',
  'r2.display',
  'commit',
  'respond',
]);
export const UPLOAD_OUTCOMES = Object.freeze(['completed', 'replayed', 'rejected', 'failed', 'disconnect']);
const STAGES = new Set(UPLOAD_STAGES);
const OUTCOMES = new Set(UPLOAD_OUTCOMES);
const BYTE_LABELS = new Set(['received', 'original', 'thumb', 'display']);
const round = value => Math.round(value * 1000) / 1000;

function assertStage(name) {
  if (!STAGES.has(name)) throw new TypeError(`Unknown upload stage: ${String(name)}`);
  return name;
}

export function createUploadTiming({
  now = () => performance.now(),
  randomUUID = () => crypto.randomUUID(),
  log = () => {},
  onFinish = null,
} = {}) {
  const diagnosticId = randomUUID();
  const startedAt = now();
  const durations = new Map();
  const open = new Map();
  const bytes = new Map();
  let hintedOutcome = null;
  let finished = false;

  function add(name, ms) {
    assertStage(name);
    if (!Number.isFinite(ms) || ms < 0) return;
    durations.set(name, (durations.get(name) ?? 0) + ms);
  }
  function begin(name) {
    assertStage(name);
    if (!finished && !open.has(name)) open.set(name, now());
  }
  function end(name) {
    assertStage(name);
    const started = open.get(name);
    if (started === undefined) return;
    open.delete(name);
    add(name, now() - started);
  }
  function mark(name, ms) {
    add(name, ms);
  }
  async function measureAsync(name, work) {
    begin(name);
    try {
      return await work();
    } finally {
      end(name);
    }
  }
  function measureSync(name, work) {
    begin(name);
    try {
      return work();
    } finally {
      end(name);
    }
  }
  function note(label, value) {
    if (!BYTE_LABELS.has(label)) return;
    const size = Number(value);
    if (Number.isInteger(size) && size >= 0) bytes.set(label, size);
  }
  function snapshot() {
    return {
      diagnosticId,
      stages: Object.fromEntries([...durations].map(([name, ms]) => [name, round(ms)])),
      bytes: Object.fromEntries(bytes),
    };
  }
  // Partial total: elapsed when the response starts writing. Serialization and
  // the network write happen after this instant, so up-total is a lower bound.
  function elapsed() {
    return round(now() - startedAt);
  }
  function serverTimingHeader() {
    const metrics = UPLOAD_STAGES
      .filter(name => durations.has(name))
      .map(name => `up-${name.replace('.', '_')};dur=${round(durations.get(name))}`);
    metrics.push(`up-total;dur=${elapsed()}`);
    return metrics.join(', ');
  }
  function markOutcome(name) {
    if (!OUTCOMES.has(name)) throw new TypeError(`Unknown upload outcome: ${String(name)}`);
    hintedOutcome = name;
  }
  function finish({ outcome = 'completed', statusCode = null } = {}) {
    if (finished) return null;
    if (!OUTCOMES.has(outcome)) throw new TypeError(`Unknown upload outcome: ${String(outcome)}`);
    finished = true;
    // A stage that had already begun really was in flight; it settles here.
    for (const name of [...open.keys()]) end(name);
    const { stages, bytes: byteCounts } = snapshot();
    const record = {
      event: 'upload.diagnostic',
      diagnosticId,
      outcome,
      status: Number.isInteger(statusCode) ? statusCode : null,
      totalMs: elapsed(),
      stages,
      bytes: byteCounts,
    };
    try {
      log(record);
    } catch {
      // Diagnostics must never fail a request.
    }
    if (onFinish) {
      try {
        onFinish(record);
      } catch {
        // Same: observation is never allowed to break the upload path.
      }
    }
    return record;
  }

  return {
    diagnosticId,
    begin,
    end,
    mark,
    measureAsync,
    measureSync,
    note,
    snapshot,
    elapsed,
    serverTimingHeader,
    markOutcome,
    finish,
    get finished() {
      return finished;
    },
    get pendingStages() {
      return [...open.keys()];
    },
    get hintedOutcome() {
      return hintedOutcome;
    },
  };
}

// Terminal outcome for an Express response. A response that never finished is a
// client disconnect: exactly the case the completion-only nginx access log
// cannot see, and the case a "pending forever" report looks like.
export function outcomeForResponse(res, hint = null) {
  if (!res || !res.writableFinished) return 'disconnect';
  const status = Number(res.statusCode) || 0;
  if (status >= 400) return 'rejected';
  return hint === 'replayed' ? 'replayed' : 'completed';
}

export function logUploadDiagnostic(record, write = line => console.log(line)) {
  const line = JSON.stringify(record);
  write(line);
  return line;
}
