import pg from 'pg';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { instrumentPool } from './operational-metrics.mjs';

dotenv.config({ path: process.env.ENV_FILE || '.env.local', quiet: true });

export const schema = process.env.DB_SCHEMA;
if (schema !== 'memento' && schema !== 'memento_dev') {
  throw new Error('DB_SCHEMA must be either memento or memento_dev');
}
export const qschema = `"${schema}"`;

// Conservative, configurable budgets. Acquisition is bounded at the pool so a
// request flood cannot wait forever for a slot; statement and idle-transaction
// deadlines keep a wedged session from pinning a client. /health stays
// independent of all of these.
const intEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};
export const DB_BUDGETS = {
  acquireTimeoutMs: intEnv('DB_ACQUIRE_TIMEOUT_MS', 5000),
  statementTimeoutMs: intEnv('DB_STATEMENT_TIMEOUT_MS', 20000),
  idleTransactionTimeoutMs: intEnv('DB_IDLE_TX_TIMEOUT_MS', 20000),
  lockTimeoutMs: intEnv('DB_LOCK_TIMEOUT_MS', 10000),
};
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: DB_BUDGETS.acquireTimeoutMs,
  statement_timeout: DB_BUDGETS.statementTimeoutMs,
  idle_in_transaction_session_timeout: DB_BUDGETS.idleTransactionTimeoutMs,
});
instrumentPool(pool);
export const hashInvite = value => crypto.createHash('sha256').update(value).digest('hex');
export const hashSession = value => crypto.createHmac('sha256', process.env.SESSION_SECRET).update(value).digest('hex');
export const id = () => crypto.randomUUID();
export async function createInvite(expiresInDays = 30) {
  const code = `mem_${crypto.randomBytes(24).toString('base64url')}`;
  await pool.query(`INSERT INTO ${qschema}.invites(code_hash, expires_at) VALUES ($1, now() + ($2 * interval '1 day'))`, [hashInvite(code), expiresInDays]);
  return code;
}
