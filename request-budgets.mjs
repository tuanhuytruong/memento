import { operationalMetrics } from './operational-metrics.mjs';
// Separate bounded budgets: image navigation cannot consume saved-content writes.
// req.user must already be set before account() runs. IP is abuse protection only.
export function createRequestBudgets({ now = Date.now, maxKeys = 10000, windowMs = 60000, limits = {} } = {}) {
  const caps = { auth: 20, abuse: 1800, image: 480, read: 240, write: 120, export: 60, render: 12, ...limits };
  const buckets = new Map();
  const reject = (res, until) => {
    operationalMetrics.increment('budget.rejected');
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((until - now()) / 1000))));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
  };
  let count = 0;
  function consume(kind, identity, res, next) {
    const time = now();
    if (++count % 128 === 0 || buckets.size >= maxKeys) for (const [key, value] of buckets) if (value.until <= time) buckets.delete(key);
    const key = `${kind}:${identity}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.until <= time) {
      if (buckets.size >= maxKeys && !bucket) return reject(res, time + windowMs);
      bucket = { count: 0, until: time + windowMs }; buckets.set(key, bucket);
    }
    if (++bucket.count > caps[kind]) return reject(res, bucket.until);
    return next();
  }
  return {
    abuse(req, res, next) { return consume('abuse', req.ip || 'unknown', res, next); },
    auth(req, res, next) { return consume('auth', req.ip || 'unknown', res, next); },
    account(req, res, next) {
      if (!req.user?.id) return next(new Error('Account budget requires authentication'));
      const image = ['GET', 'HEAD'].includes(req.method) && /^\/api\/images\/[^/]+$/.test(req.path);
      // Rendering decodes multiple photos per request, so it gets its own small
      // budget instead of sharing the saved-content write allowance.
      if (req.method === 'POST' && req.path === '/api/postcards/render') return consume('render', req.user.id, res, next);
      if (req.method === 'POST' && /^\/api\/export\/(start|page|finalize)$/.test(req.path)) return consume('export', req.user.id, res, next);
      const readPost = req.method === 'POST' && ['/api/moments/browse/months', '/api/moments/browse/preview', '/api/moments/seek', '/api/moments/query', '/api/moments/facets', '/api/moments/resurfacing', '/api/discovery/blindbox', '/api/discovery/postcard-picker'].includes(req.path);
      return consume(image ? 'image' : readPost || ['GET', 'HEAD'].includes(req.method) ? 'read' : 'write', req.user.id, res, next);
    },
    stats() { return { keys: buckets.size, maxKeys }; },
  };
}
