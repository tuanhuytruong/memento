// Shared HTTP + cleanup-worker lifecycle for every deployed entrypoint.
// PM2 (pm2-start.mjs) and direct execution (node server.mjs) both drive this
// module, so the leased cleanup worker cannot be silently skipped by a wrapper
// that only imports `app`. Starting twice is a no-op: one worker, one listener.
//
// Shutdown contract (documented bound): stop() immediately stops admitting new
// drain passes, closes the HTTP listener, then waits up to `settleMs` for an
// in-flight drain to settle before the pool is closed. `settled:false` in the
// result means a drain was still running at the bound; its durable manifest
// replays safely after the worker lease expires.
import { startCleanup } from './object-cleanup.mjs';

export const SHUTDOWN_SETTLE_BOUND_MS = 10_000;

export function createRuntime({ app, pool, cleanup, onCleanupError = () => {}, onListenError = null }) {
  if (!app || typeof app.listen !== 'function') throw new Error('runtime requires an express app');
  if (!pool || typeof pool.end !== 'function') throw new Error('runtime requires a database pool');
  if (!cleanup || typeof cleanup.drain !== 'function') throw new Error('runtime requires a cleanup queue');
  let started = null;

  function start({ port, host = '127.0.0.1', log = () => {}, settleMs = SHUTDOWN_SETTLE_BOUND_MS } = {}) {
    if (started) return started;
    // The cleanup worker starts exactly once, through the entrypoint that
    // actually serves traffic, and stops with the same process.
    const cleanupHandle = startCleanup(cleanup, onCleanupError);
    const server = app.listen(port, host, () => log(`Memento API listening on ${host}:${port}`));
    if (onListenError) server.on('error', onListenError);
    let stopping = null;
    started = {
      server,
      get cleanup() { return cleanupHandle; },
      stop({ settleMs: bound = settleMs } = {}) {
        stopping ??= (async () => {
          // 1) no new drain passes are admitted from here on.
          const drain = await cleanupHandle.stop({ settleMs: bound });
          // 2) existing keep-alive connections are drained before the pool closes.
          await new Promise(resolve => server.close(resolve));
          // 3) the pool closes only after the listener is fully closed.
          await pool.end();
          return drain;
        })();
        return stopping;
      },
    };
    return started;
  }

  return { start, get current() { return started; } };
}
