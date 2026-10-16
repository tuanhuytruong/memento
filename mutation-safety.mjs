// All domain writes take this schema/owner lock BEFORE checking current access.
// Never perform object storage I/O inside these short transactions.
export const asyncHandler = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch(next);
export class ApiError extends Error {
  constructor(status, message, details = {}) { super(message); this.status = status; this.details = details; }
}
export async function transaction(pool, work, ownerId, schema) {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    if (ownerId) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${schema}:owner:${ownerId}`]);
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
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
