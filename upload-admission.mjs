// Upload admission: bounded concurrency and byte reservation BEFORE Multer
// buffers the request body. Per-file caps and per-minute quotas do not bound
// aggregate concurrent buffering across requests, so admission runs after
// authentication but before `upload.single`.
//
// Contract:
// - Overload is denied immediately (503 + Retry-After), never parked in a
//   socket queue that keeps reading an unbounded pending body.
// - Each admitted upload reserves the maximum allowed file size (10 MiB).
//   The reservation is held until the route releases it — that is, until the
//   associated transform/storage work has settled. A disconnect during
//   buffering (before the handler starts) releases immediately; a disconnect
//   during storage does not free capacity early because the handler owns the
//   release from the moment it starts.
// - A stalled body is destroyed after `slowBodyMs` so buffering cannot pin a
//   reservation forever. fields/parts/header payloads stay bounded by the
//   Multer limits configured on the shared instance in server.mjs.
export function createUploadAdmission({
  // Two per account: the current client uploads sequentially, but a duplicated
  // submission racing its own Idempotency-Key must still be admitted, or the
  // replay contract (one 200 + one 201) could never resolve. Global cap and
  // byte reservations still bound aggregate buffering.
  maxConcurrent = 4,
  perAccountConcurrent = 2,
  maxReservedBytes = 64 * 1024 * 1024,
  reservationBytes = 10 * 1024 * 1024,
  slowBodyMs = 60_000,
} = {}) {
  let active = 0;
  let reservedBytes = 0;
  const perAccount = new Map();

  function stats() { return { active, reservedBytes, perAccount: perAccount.size }; }

  // Express middleware: only the upload route reaches this, after auth.
  function admit(req, res, next) {
    try {
      const userId = req.user?.id;
      if (!userId) return next(new Error('Upload admission requires authentication'));
      const held = perAccount.get(userId) || 0;
      if (active >= maxConcurrent || held >= perAccountConcurrent || reservedBytes + reservationBytes > maxReservedBytes) {
        res.setHeader('Retry-After', '2');
        res.setHeader('Cache-Control', 'no-store');
        return res.status(503).json({ error: 'Another upload is still being processed. Please try again in a moment.' });
      }
      active += 1;
      reservedBytes += reservationBytes;
      perAccount.set(userId, held + 1);
      let released = false;
      req.releaseUploadSlot = () => {
        if (released) return;
        released = true;
        active -= 1;
        reservedBytes -= reservationBytes;
        const remaining = (perAccount.get(userId) || 1) - 1;
        if (remaining <= 0) perAccount.delete(userId); else perAccount.set(userId, remaining);
      };
      // Before the handler starts, a disconnect or stalled body frees the
      // reservation. After it starts, the handler's own finally owns release,
      // so a mid-storage disconnect cannot free capacity still in use.
      const abortDuringBuffering = () => { if (!req.uploadHandlerStarted) req.releaseUploadSlot(); };
      res.once('close', abortDuringBuffering);
      const idleTimer = setTimeout(() => req.destroy(Object.assign(new Error('Upload body stalled.'), { code: 'UPLOAD_BODY_STALLED' })), slowBodyMs);
      idleTimer.unref?.();
      // The body is fully buffered once the request stream ends; from here the
      // handler path owns the reservation, so the stall guard is no longer needed.
      req.once('end', () => clearTimeout(idleTimer));
      res.once('close', () => clearTimeout(idleTimer));
      return next();
    } catch (error) { return next(error); }
  }

  return { admit, stats };
}
