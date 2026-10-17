// Whole-pipeline admission for private postcard export.
// Admission happens BEFORE any source read: overload is rejected with a
// retryable 503 + Retry-After while zero bytes have been fetched from R2.
// A reservation covers the nominal worst-case bytes of the selected photos
// (24MB each, the per-photo read cap) and is released exactly once, after the
// underlying fetch/render work has actually settled — never on the caller's
// timeout alone. The only queue in the system is the renderer's bounded
// two-deep render queue; admission itself never holds pending request bodies.
const CANCELLED = () => Object.assign(new Error('Postcard rendering was cancelled.'), { status: 499, postcard: true });
const BUSY = () => Object.assign(new Error('Another postcard is still being prepared. Please try again in a moment.'), { status: 503, retryAfter: 2, postcard: true });

export function createPostcardPipeline({
  maxInFlight = 2,
  maxPerAccount = 1,
  maxPendingBytes = 96 * 1024 * 1024,
  bytesPerPhoto = 24 * 1024 * 1024,
  maxSourceFetchers = 4,
} = {}) {
  let inFlight = 0;
  let reservedBytes = 0;
  let sourceActive = 0;
  const perAccount = new Map();
  const sourceWaiters = [];

  function stats() {
    return { inFlight, reservedBytes, perAccount: perAccount.size, sourceActive, sourceWaiters: sourceWaiters.length };
  }

  // Global source-fetch budget shared by every in-flight pipeline, so N
  // concurrent renders cannot each open their own unbounded set of reads.
  // Releasing a slot hands it directly to the next waiter when one is queued.
  function releaseSlot() {
    const waiter = sourceWaiters.shift();
    if (waiter) { waiter.resolve(); return; } // handed over: sourceActive unchanged
    sourceActive -= 1;
  }
  async function acquireSourceSlot(signal) {
    if (signal?.aborted) throw CANCELLED();
    if (sourceActive < maxSourceFetchers) { sourceActive += 1; return () => releaseSlot(); }
    return new Promise((resolve, reject) => {
      const waiter = { resolve: null, reject };
      const onAbort = () => {
        const index = sourceWaiters.indexOf(waiter);
        if (index >= 0) sourceWaiters.splice(index, 1);
        reject(CANCELLED());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      waiter.resolve = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve(() => releaseSlot());
      };
      sourceWaiters.push(waiter);
    });
  }

  async function run({ userId, photoCount = 0, signal, work }) {
    if (typeof userId !== 'string' || !userId) throw new Error('Postcard pipeline requires an authorized user');
    if (typeof work !== 'function') throw new Error('Postcard pipeline requires work');
    const reservation = Math.max(0, photoCount) * bytesPerPhoto;
    const held = perAccount.get(userId) || 0;
    // Overload is decided before any source read; nothing is queued here.
    if (inFlight >= maxInFlight || held >= maxPerAccount || reservedBytes + reservation > maxPendingBytes) throw BUSY();
    inFlight += 1;
    reservedBytes += reservation;
    perAccount.set(userId, held + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      inFlight -= 1;
      reservedBytes -= reservation;
      const remaining = (perAccount.get(userId) || 1) - 1;
      if (remaining <= 0) perAccount.delete(userId); else perAccount.set(userId, remaining);
    };
    try {
      return await work({ signal, sourceSlot: () => acquireSourceSlot(signal) });
    } finally {
      // Exactly once, after the underlying work has settled.
      release();
    }
  }

  return { run, stats, acquireSourceSlot };
}
