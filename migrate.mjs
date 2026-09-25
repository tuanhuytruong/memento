import dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_FILE || '.env.local' });
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const schema = process.env.DB_SCHEMA;
if (schema !== 'memento' && schema !== 'memento_dev') {
  throw new Error('Refusing migration: DB_SCHEMA must be memento or memento_dev');
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const quotedSchema = `"${schema}"`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
try {
  const target = await pool.query(
    `SELECT current_database() AS db, EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name=$1) AS schema_exists`,
    [schema],
  );
  if (target.rows[0].db !== 'dwh' || !target.rows[0].schema_exists) {
    throw new Error('Refusing migration: connected database/schema did not match the configured target');
  }
  await pool.query('SELECT pg_advisory_lock(hashtext($1))', [`${schema}:migrations`]);
  await pool.query(`CREATE TABLE IF NOT EXISTS ${quotedSchema}.schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const files = (await fs.readdir(dir)).filter(x => /^\d+[-_].+\.sql$/.test(x)).sort();
  for (const file of files) {
    const exists = await pool.query(`SELECT 1 FROM ${quotedSchema}.schema_migrations WHERE version=$1`, [file]);
    if (exists.rowCount) { console.log(`${file}: already applied`); continue; }
    // Migration files are authored with the safe DEV schema placeholder; substitute only its quoted identifier.
    const sql = (await fs.readFile(path.join(dir, file), 'utf8')).replaceAll('"memento_dev"', quotedSchema);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(`INSERT INTO ${quotedSchema}.schema_migrations(version) VALUES($1)`, [file]);
      await client.query('COMMIT');
      console.log(`${file}: applied to dwh.${schema}`);
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }
} finally {
  await pool.query('SELECT pg_advisory_unlock(hashtext($1))', ['memento_dev:migrations']).catch(() => {});
  await pool.end();
}
