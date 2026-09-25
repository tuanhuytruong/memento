import pg from 'pg';
import crypto from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: process.env.ENV_FILE || '.env.local', quiet: true });

export const schema = process.env.DB_SCHEMA;
if (schema !== 'memento' && schema !== 'memento_dev') {
  throw new Error('DB_SCHEMA must be either memento or memento_dev');
}
export const qschema = `"${schema}"`;
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10, idleTimeoutMillis: 30000 });
export const hashInvite = value => crypto.createHash('sha256').update(value).digest('hex');
export const hashSession = value => crypto.createHmac('sha256', process.env.SESSION_SECRET).update(value).digest('hex');
export const id = () => crypto.randomUUID();
export async function createInvite(expiresInDays = 30) {
  const code = `mem_${crypto.randomBytes(24).toString('base64url')}`;
  await pool.query(`INSERT INTO ${qschema}.invites(code_hash, expires_at) VALUES ($1, now() + ($2 * interval '1 day'))`, [hashInvite(code), expiresInDays]);
  return code;
}
