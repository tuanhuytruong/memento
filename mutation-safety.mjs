// All domain writes take this schema/owner lock BEFORE checking current access.
// Never perform object storage I/O inside these short transactions.
import { DB_BUDGETS } from './memento-db.mjs';

export const asyncHandler = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch(next);
export class ApiError extends Error {
  constructor(status, message, details = {}) { super(message); this.status = status; this.details = details; }
}
// Known-not-committed failures are retryable: the transaction never reached
// COMMIT, so the client may safely replay the same request. Everything else
// stays an opaque dependency failure, because a connection drop around COMMIT
// leaves an ambiguous outcome that must not be blindly replayed.
const NOT_COMMITTED_CODES = new Set(['55P03', '57014']);
export async function transaction(pool, work, ownerId, schema, budgets = DB_BUDGETS) {
  let client;
  let phase = 'acquire';
  try {
    phase = 'acquire';
    client = await pool.connect();
    await client.query('BEGIN');
    phase = 'lock';
    // Bound the owner-lock wait so a hot owner cannot pin a pool slot forever.
    // SET cannot take a bind parameter, so the value is a validated integer.
    const lockTimeoutMs = Math.max(1, Math.min(600000, Number(budgets.lockTimeoutMs) || 10000) | 0);
    await client.query(`SET LOCAL lock_timeout = ${lockTimeoutMs}`);
    if (ownerId) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${schema}:owner:${ownerId}`]);
    phase = 'work';
    const value = await work(client);
    phase = 'commit';
    await client.query('COMMIT');
    return value;
  } catch (error) {
    // ROLLBACK after a failed COMMIT is a best-effort cleanup, never a claim
    // about whether COMMIT landed; that ambiguity is preserved for the caller.
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (phase === 'commit' && error && typeof error === 'object') {
      error.ambiguousCommit = true;
    } else if (phase === 'lock' && error?.code === '55P03') {
      error.retryableTimeout = true;
    } else if (NOT_COMMITTED_CODES.has(error?.code)) {
      error.retryableTimeout = true;
    }
    throw error;
  } finally { client?.release(); }
}
export async function authorizedMutation({ pool, schema, userId, resourceId, access, work }) {
  // Probe only discovers the immutable owner, never grants authority to write.
  const probe = await access(userId, resourceId);
  if (!probe) throw new ApiError(404, 'Resource not found');
  return transaction(pool, async client => {
    const current = await access(userId, resourceId, client);
    if (!current || current.owner_id !== probe.owner_id) throw new ApiError(404, 'Resource not found');
    return work(client, current);
  }, probe.owner_id, schema);
}
export function expectedVersion(req) {
  const header = req.get('if-match');
  const value = header == null ? req.body?.expectedVersion : (/^"?([1-9]\d*)"?$/.exec(header)?.[1]);
  if (header == null && typeof value !== 'number') throw new ApiError(428, 'Numeric expectedVersion or If-Match is required');
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1) throw new ApiError(428, 'expectedVersion or If-Match is required');
  return version;
}
