// PRIVATE PROCESS CACHE ONLY. Callers MUST authenticate and check current imageAccess
// before EVERY get(), including hits/singleflight joins. Object keys are server validated.
// load(signal) must honor AbortSignal and return { body: Node readable, contentLength? }.
const MiB = 1024 * 1024;
export function imageError(code, message = code) { return Object.assign(new Error(message), { code }); }
function aborted(signal) { return signal?.reason instanceof Error ? signal.reason : imageError('IMAGE_ABORTED'); }
function integer(value, min, max) { return Number.isSafeInteger(value) && value >= min && value <= max; }

// One scheduler should be shared by derivative loads AND streaming bypasses.
export class ImageLoadScheduler {
  constructor({ concurrency = 4, maxQueue = 32, maxPendingBytes = 8 * MiB } = {}) {
    if (!integer(concurrency, 1, 4) || !integer(maxQueue, 0, 32) || !integer(maxPendingBytes, 1, 8 * MiB)) throw new TypeError('Invalid image load bounds');
    Object.assign(this, { concurrency, maxQueue, maxPendingBytes });
    this.active = 0; this.pendingBytes = 0; this.queue = [];
  }
  acquire(bytes = 0, signal) {
    if (!integer(bytes, 0, this.maxPendingBytes)) return Promise.reject(imageError('IMAGE_BUSY'));
    if (signal?.aborted) return Promise.reject(aborted(signal));
    if (this.pendingBytes + bytes > this.maxPendingBytes || (this.active >= this.concurrency && this.queue.length >= this.maxQueue)) return Promise.reject(imageError('IMAGE_BUSY'));
    this.pendingBytes += bytes;
    return new Promise((resolve, reject) => {
      const item = { start: () => {
        signal?.removeEventListener('abort', cancel);
        this.active++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true; this.active--; this.pendingBytes -= bytes;
          this.queue.shift()?.start();
        });
      } };
      const cancel = () => {
        const index = this.queue.indexOf(item);
        if (index < 0) return;
        this.queue.splice(index, 1); this.pendingBytes -= bytes;
        signal?.removeEventListener('abort', cancel); reject(aborted(signal));
      };
      if (this.active < this.concurrency) item.start();
      else { this.queue.push(item); signal?.addEventListener('abort', cancel, { once: true }); }
    });
  }
  stats() { return { active: this.active, queued: this.queue.length, pendingBytes: this.pendingBytes }; }
}

export async function openImage(load, signal) {
  // Keep the scheduler slot until the actual loader settles, even if a buggy
  // adapter ignores abort. Releasing early permits unbounded orphaned SDK loads.
  if (signal.aborted) throw aborted(signal);
  const result = await load(signal);
  if (signal.aborted) { result?.body?.destroy?.(); throw aborted(signal); }
  if (!result?.body || typeof result.body[Symbol.asyncIterator] !== 'function' || typeof result.body.destroy !== 'function') {
    result?.body?.destroy?.(); throw imageError('IMAGE_UPSTREAM_INVALID');
  }
  return result;
}
export function checkLength(contentLength, expected) {
  if (contentLength !== undefined && (!Number.isSafeInteger(contentLength) || contentLength !== expected)) throw imageError('IMAGE_LENGTH_MISMATCH');
}
export async function readImageBounded(load, size, signal) {
  const { body, contentLength } = await openImage(load, signal);
  const cancel = () => body.destroy(aborted(signal));
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) throw aborted(signal);
    checkLength(contentLength, size);
    // One reserved allocation, no chunk list or concat (which doubles peak bytes).
    const output = Buffer.allocUnsafe(size);
    let used = 0;
    for await (const chunk of body) {
      if (!Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) throw imageError('IMAGE_UPSTREAM_INVALID');
      if (chunk.byteLength > size - used) throw imageError('IMAGE_LENGTH_MISMATCH');
      output.set(chunk, used); used += chunk.byteLength;
    }
    if (used !== size || signal.aborted) throw signal.aborted ? aborted(signal) : imageError('IMAGE_LENGTH_MISMATCH');
    return output;
  } finally { signal.removeEventListener('abort', cancel); body.destroy(); }
}

export class ImageCache {
  constructor({ maxBytes = 32 * MiB, maxEntryBytes = 2 * MiB, ttlMs = 120000, maxEntries = 1024, maxWaiters = 128, timeoutMs = 30000, now = Date.now, scheduler = new ImageLoadScheduler() } = {}) {
    if (!integer(maxBytes, 1, 32 * MiB) || !integer(maxEntryBytes, 1, Math.min(maxBytes, 2 * MiB)) || !integer(ttlMs, 1, 120000) || !integer(maxEntries, 1, 1024) || !integer(maxWaiters, 1, 128) || !integer(timeoutMs, 1, 30000)) throw new TypeError('Invalid image cache bounds');
    Object.assign(this, { maxBytes, maxEntryBytes, ttlMs, maxEntries, maxWaiters, timeoutMs, now, scheduler });
    this.entries = new Map(); this.inflight = new Map(); this.bytes = 0; this.waiters = 0;
  }
  remove(key) { const entry = this.entries.get(key); if (entry) { this.bytes -= entry.body.length; this.entries.delete(key); } }
  prune() { for (const [key, entry] of this.entries) if (entry.expires <= this.now()) this.remove(key); }
  invalidate(key) {
    this.remove(key);
    const job = this.inflight.get(key);
    if (job) { this.inflight.delete(key); job.controller.abort(imageError('IMAGE_INVALIDATED')); }
  }
  clear() { for (const key of new Set([...this.entries.keys(), ...this.inflight.keys()])) this.invalidate(key); }
  stats() { this.prune(); return { bytes: this.bytes, entries: this.entries.size, inflight: this.inflight.size, waiters: this.waiters, ...this.scheduler.stats() }; }
  async get({ key, size, load, signal }) {
    if (typeof key !== 'string' || key.length < 1 || key.length > 1024 || !integer(size, 1, this.maxEntryBytes)) throw imageError('IMAGE_NOT_CACHEABLE');
    if (signal?.aborted) throw aborted(signal);
    this.prune();
    const entry = this.entries.get(key);
    if (entry && entry.body.length === size) {
      this.entries.delete(key); this.entries.set(key, entry);
      return { body: entry.body, cache: 'hit' }; // Read-only buffer; caller MUST NOT mutate.
    }
    if (entry) this.remove(key);
    if (this.waiters >= this.maxWaiters) throw imageError('IMAGE_BUSY');
    let job = this.inflight.get(key);
    const status = job ? 'coalesced' : 'miss';
    if (job && job.size !== size) throw imageError('IMAGE_LENGTH_MISMATCH');
    if (!job) {
      const controller = new AbortController();
      job = { controller, size, waiters: 0, subscribers: new Set(), done: false };
      this.inflight.set(key, job);
      const cancel = () => settle(aborted(controller.signal));
      const settle = (error, body) => {
        if (job.done) return;
        job.done = true; job.error = error; job.body = body;
        controller.signal.removeEventListener('abort', cancel);
        for (const notify of job.subscribers) notify();
        job.subscribers.clear();
      };
      controller.signal.addEventListener('abort', cancel, { once: true });
      this.fill(key, job, load).then(body => settle(null, body), error => settle(error));
    }
    this.waiters++; job.waiters++;
    try {
      // Removable subscribers, not Promise.then per waiter: a noncooperative
      // stalled loader cannot retain an unlimited history of aborted callers.
      const body = await new Promise((resolve, reject) => {
        const cleanup = () => { job.subscribers.delete(notify); signal?.removeEventListener('abort', cancel); };
        const notify = () => { cleanup(); job.error ? reject(job.error) : resolve(job.body); };
        const cancel = () => { cleanup(); reject(aborted(signal)); };
        if (signal?.aborted) cancel();
        else if (job.done) notify();
        else { job.subscribers.add(notify); signal?.addEventListener('abort', cancel, { once: true }); }
      });
      if (job.controller.signal.aborted) throw aborted(job.controller.signal);
      return { body, cache: status };
    } finally {
      this.waiters--; job.waiters--;
      if (job.waiters === 0 && this.inflight.get(key) === job) {
        this.inflight.delete(key); job.controller.abort(imageError('IMAGE_ABORTED'));
      }
    }
  }
  async fill(key, job, load) {
    const signal = job.controller.signal;
    const timer = setTimeout(() => job.controller.abort(imageError('IMAGE_TIMEOUT')), this.timeoutMs);
    timer.unref?.();
    let release;
    try {
      release = await this.scheduler.acquire(job.size, signal);
      if (signal.aborted) throw aborted(signal);
      const body = await readImageBounded(load, job.size, signal);
      if (signal.aborted || this.inflight.get(key) !== job) throw imageError('IMAGE_INVALIDATED');
      this.prune();
      while (this.bytes + body.length > this.maxBytes || this.entries.size >= this.maxEntries) this.remove(this.entries.keys().next().value);
      this.entries.set(key, { body, expires: this.now() + this.ttlMs }); this.bytes += body.length;
      return body;
    } finally {
      clearTimeout(timer); release?.();
      if (this.inflight.get(key) === job) this.inflight.delete(key);
    }
  }
}

export const imageCache = new ImageCache();
// Call for EACH original/thumb/display key when deletion is committed and in cleanup retries.
export const invalidateImageObject = key => imageCache.invalidate(key);
