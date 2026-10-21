import { performance } from 'node:perf_hooks';

// Closed labels and fixed histograms only. Never accept request URLs, identities,
// errors or arbitrary labels. Snapshots are operator-local, never an HTTP API.
const BOUNDS = Object.freeze([5, 20, 50, 100, 250, 1000, 5000, 30000]);
const ROUTES = new Set(['/health', '/api/moments/query', '/api/moments/overview', '/api/moments/resurfacing', '/api/moments', '/api/moments/:id', '/api/images', '/api/images/:id', '/api/postcards/render']);
const COUNTERS = new Set(['image.hit', 'image.miss', 'image.coalesced', 'image.bypass', 'image.ok', 'image.error', 'image.not-modified', 'budget.rejected']);
const GAUGES = new Set(['db.total', 'db.idle', 'db.waiting', 'image.active', 'image.queued', 'image.inflight', 'image.waiters', 'image.bytes', 'render.active', 'render.queued', 'cleanup.pending', 'cleanup.oldestSeconds', 'expiry.sessions', 'expiry.invites']);
export function createOperationalMetrics({ now = () => performance.now() } = {}) {
  const counters = Object.create(null), gauges = Object.create(null), durations = Object.create(null);
  function observe(name, value) {
    if (!Number.isFinite(value) || value < 0) return;
    const h = durations[name] ??= { count: 0, sumMs: 0, buckets: Array(BOUNDS.length + 1).fill(0) };
    h.count++; h.sumMs += value; h.buckets[BOUNDS.findIndex(bound => value <= bound) < 0 ? BOUNDS.length : BOUNDS.findIndex(bound => value <= bound)]++;
  }
  function increment(name) { if (COUNTERS.has(name)) counters[name] = (counters[name] || 0) + 1; }
  function gauge(name, value) { if (GAUGES.has(name) && Number.isFinite(Number(value)) && Number(value) >= 0) gauges[name] = Number(value); }
  return {
    increment, gauge,
    dbWait(ms, ok) { observe(ok ? 'db.acquire.ok' : 'db.acquire.error', ms); },
    imageTiming(value) {
      if (!value || typeof value !== 'object') return;
      increment(`image.${value.cache}`); increment(`image.${value.status}`);
      observe('image.total', value.totalMs); observe('image.upstreamHeaders', value.upstreamHeadersMs === null ? NaN : value.upstreamHeadersMs);
    },
    middleware(req, res, next) {
      const start = now(); let done = false;
      const finish = () => {
        if (done) return; done = true; res.off('finish', finish); res.off('close', finish);
        // Route path is Express's template, never req.path/originalUrl.
        const route = ROUTES.has(req.route?.path) ? req.route.path : 'other';
        const method = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) ? req.method : 'other';
        const status = res.writableFinished ? `${Math.max(1, Math.min(5, Math.floor(res.statusCode / 100)))}xx` : 'disconnect';
        observe(`route.${method}.${route}.${status}`, now() - start);
      };
      res.once('finish', finish); res.once('close', finish); next();
    },
    snapshot() { return structuredClone({ version: 1, durationBoundsMs: BOUNDS, counters, gauges, durations }); },
  };
}
export const operationalMetrics = createOperationalMetrics();

// pg's pool.query internally calls connect(callback). Keep both forms intact,
// measure real acquisition (not query time), and do not retain client/SQL data.
export function instrumentPool(pool, metrics = operationalMetrics) {
  const connect = pool.connect;
  pool.connect = function (callback) {
    const start = performance.now();
    if (typeof callback === 'function') return connect.call(this, (error, client, release) => {
      metrics.dbWait(performance.now() - start, !error); callback(error, client, release);
    });
    return connect.call(this).then(client => { metrics.dbWait(performance.now() - start, true); return client; }, error => { metrics.dbWait(performance.now() - start, false); throw error; });
  };
  return pool;
}

// Explicit operator invocation, bounded one-statement multi-process claim/delete.
// Active sessions cannot qualify. Invites are audited only: no expiry index and
// consumed invite records may be useful for audit, so retention is not invented.
export async function cleanupExpiredSessions(pool, qschema, limit = 100) {
  if (!['"memento_dev"', '"memento"'].includes(qschema)) throw new TypeError('Invalid schema');
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new TypeError('Invalid cleanup limit');
  const result = await pool.query(`WITH expired AS (SELECT token_hash FROM ${qschema}.sessions WHERE expires_at <= now() ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT $1) DELETE FROM ${qschema}.sessions s USING expired e WHERE s.token_hash=e.token_hash AND s.expires_at <= now()`, [limit]);
  return result.rowCount;
}
export async function sampleOperationalState({ pool, qschema, imageDelivery, renderStats, metrics = operationalMetrics }) {
  if (!['"memento_dev"', '"memento"'].includes(qschema)) throw new TypeError('Invalid schema');
  for (const [key, value] of Object.entries({ total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount })) metrics.gauge(`db.${key}`, value);
  const image = imageDelivery?.stats().cache;
  for (const key of ['active', 'queued', 'inflight', 'waiters', 'bytes']) if (image) metrics.gauge(`image.${key}`, image[key]);
  for (const key of ['active', 'queued']) if (renderStats) metrics.gauge(`render.${key}`, renderStats()[key]);
  const { rows: [row] } = await pool.query(`SELECT (SELECT count(*) FROM ${qschema}.object_cleanup_jobs)::float AS pending, (SELECT coalesce(extract(epoch FROM now()-min(created_at)),0) FROM ${qschema}.object_cleanup_jobs)::float AS oldest, (SELECT count(*) FROM ${qschema}.sessions WHERE expires_at <= now())::float AS sessions, (SELECT count(*) FROM ${qschema}.invites WHERE expires_at <= now())::float AS invites`);
  metrics.gauge('cleanup.pending', row.pending); metrics.gauge('cleanup.oldestSeconds', row.oldest); metrics.gauge('expiry.sessions', row.sessions); metrics.gauge('expiry.invites', row.invites);
  return metrics.snapshot();
}
