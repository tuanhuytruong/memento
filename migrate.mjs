import dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_FILE || '.env.local' });
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

if (process.env.DB_SCHEMA !== 'memento_dev') throw new Error('Refusing migration: DB_SCHEMA must be exactly memento_dev');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
try {
  const target = await pool.query(`SELECT current_database() AS db, EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name='memento_dev') AS schema_exists`);
  if (target.rows[0].db !== 'dwh' || !target.rows[0].schema_exists) throw new Error('Refusing migration: connected database/schema did not match approved dev target');
  await pool.query('SELECT pg_advisory_lock(hashtext($1))', ['memento_dev:migrations']);
  await pool.query(`CREATE TABLE IF NOT EXISTS "memento_dev".schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const files = (await fs.readdir(dir)).filter(x => /^\d+[-_].+\.sql$/.test(x)).sort();
  for (const file of files) {
    const exists = await pool.query(`SELECT 1 FROM "memento_dev".schema_migrations WHERE version=$1`, [file]);
    if (exists.rowCount) { console.log(`${file}: already applied`); continue; }
    const sql = await fs.readFile(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(`INSERT INTO "memento_dev".schema_migrations(version) VALUES($1)`, [file]);
      await client.query('COMMIT');
      console.log(`${file}: applied to dwh.memento_dev`);
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }
} finally {
  await pool.query('SELECT pg_advisory_unlock(hashtext($1))', ['memento_dev:migrations']).catch(() => {});
  await pool.end();
}
