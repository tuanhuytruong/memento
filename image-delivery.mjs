import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { performance } from 'node:perf_hooks';
import { imageCache, ImageLoadScheduler, imageError, openImage, checkLength } from './image-cache.mjs';
import { VARIANT_CACHE_CONTROL } from './image-variants.mjs';
import { operationalMetrics } from './operational-metrics.mjs';

// AUTHORIZATION BOUNDARY: call ONLY AFTER fresh session auth + imageAccess for
// this request. Even a conditional 304 or cache hit MUST pass both first.
// metadata is server-resolved { key, size, contentType, variant }; variant must
// describe the ACTUAL object, not the requested variant (legacy fallback=original).
// Keys must be immutable and prefix-validated by the caller. Never pass client keys.
// fetchObject(metadata, { signal }) -> { body: Node Readable, contentLength? }.
// AWS adapter: s3.send(command, {abortSignal: signal}), Body + ContentLength.
// onTiming receives aggregate-only numbers/enums; never log keys, URLs or errors.
export function imageEtag({ key, size }) {
  return `"${createHash('sha256').update(JSON.stringify([key, size])).digest('hex')}"`;
}
function matches(header, etag) {
  return typeof header === 'string' && header.length <= 8192 && header.split(',').some(value => value.trim() === '*' || value.trim().replace(/^W\//, '') === etag);
}
function validate(metadata) {
  if (!metadata || typeof metadata.key !== 'string' || metadata.key.length < 1 || metadata.key.length > 1024 || !Number.isSafeInteger(metadata.size) || metadata.size < 1 || !['original', 'thumb', 'display'].includes(metadata.variant) || typeof metadata.contentType !== 'string' || !/^image\/[a-z0-9.+-]+$/i.test(metadata.contentType)) throw imageError('IMAGE_METADATA_INVALID');
}
function end(res, body) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { res.off('finish', finish); res.off('error', fail); res.off('close', close); };
    const finish = () => { cleanup(); resolve(); };
    const fail = error => { cleanup(); reject(error); };
    const close = () => { cleanup(); res.writableFinished ? resolve() : reject(imageError('IMAGE_ABORTED')); };
    res.once('finish', finish); res.once('error', fail); res.once('close', close);
    res.end(body);
  });
}
export function createImageDelivery({ cache = imageCache, fetchObject, enabled = true, timeoutMs = 30000, onTiming = value => operationalMetrics.imageTiming(value) } = {}) {
  if (typeof fetchObject !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new TypeError('Invalid image delivery options');
  // Bounds ALL requests, including uncached originals/oversized objects and slow
  // downstream clients. Queued requests hold metadata, not object bodies.
  const requests = new ImageLoadScheduler();
  async function deliver({ req, res, metadata }) {
    validate(metadata);
    const start = performance.now();
    const controller = new AbortController();
    const { signal } = controller;
    let release, body, status = 'error', cacheStatus = 'bypass', upstreamMs = null;
    const cancel = () => controller.abort(imageError('IMAGE_ABORTED'));
    const close = () => { if (!res.writableFinished) cancel(); };
    req.once('aborted', cancel); res.once('close', close);
    if (req.aborted || res.destroyed) cancel();
    const timer = setTimeout(() => controller.abort(imageError('IMAGE_TIMEOUT')), timeoutMs);
    timer.unref?.();
    const destroy = () => { body?.destroy(signal.reason); if (res.headersSent && !res.destroyed) res.destroy(signal.reason); };
    signal.addEventListener('abort', destroy, { once: true });
    try {
      release = await requests.acquire(0, signal);
      if (signal.aborted) throw signal.reason;
      const etag = imageEtag(metadata);
      res.setHeader('Cache-Control', VARIANT_CACHE_CONTROL);
      res.setHeader('ETag', etag);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (matches(req.headers['if-none-match'], etag)) {
        res.statusCode = 304; await end(res); status = 'not-modified'; return;
      }
      res.setHeader('Content-Type', metadata.contentType);
      const load = async loadSignal => {
        const began = performance.now();
        const result = await fetchObject(metadata, { signal: loadSignal });
        // SDK send resolves at upstream headers, not at first BODY byte.
        upstreamMs = performance.now() - began;
        return result;
      };
      if (enabled && metadata.variant !== 'original' && metadata.size <= cache.maxEntryBytes) {
        const result = await cache.get({ key: metadata.key, size: metadata.size, load, signal });
        if (signal.aborted) throw signal.reason;
        cacheStatus = result.cache;
        res.setHeader('Content-Length', result.body.length);
        await end(res, result.body);
      } else {
        const upstreamRelease = await cache.scheduler.acquire(0, signal);
        try {
          const result = await openImage(load, signal); body = result.body;
          checkLength(result.contentLength, metadata.size);
          res.setHeader('Content-Length', metadata.size);
          let transferred = 0;
          // Stream with backpressure. Never collect oversized/original bodies.
          const limiter = new Transform({ transform(chunk, encoding, done) {
            transferred += chunk.length;
            if (transferred > metadata.size) done(imageError('IMAGE_LENGTH_MISMATCH'));
            else done(null, chunk);
          }, flush(done) { done(transferred === metadata.size ? null : imageError('IMAGE_LENGTH_MISMATCH')); } });
          await pipeline(body, limiter, res, { signal });
        } finally { body?.destroy(); upstreamRelease(); }
      }
      status = 'ok';
    } catch (error) {
      // Parent maps pre-header IMAGE_BUSY/TIMEOUT/upstream failures to 503/502;
      // once streaming begins the only safe failure is closing the response.
      if (res.headersSent && !res.destroyed) res.destroy();
      throw error;
    } finally {
      clearTimeout(timer); release?.();
      req.off('aborted', cancel); res.off('close', close); signal.removeEventListener('abort', destroy);
      try { onTiming({ status, cache: cacheStatus, totalMs: Math.round(performance.now() - start), upstreamHeadersMs: upstreamMs === null ? null : Math.round(upstreamMs) }); } catch { /* metrics cannot break delivery */ }
    }
  }
  return { deliver, invalidate: key => cache.invalidate(key), stats: () => ({ requests: requests.stats(), cache: cache.stats() }) };
}
