// Database budget tests. Classification cases run pure; the exhaustion and
// lock/timeout cases need a real PostgreSQL and are gated by RUN_INTEGRATION=1.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import dotenv from 'dotenv';
import { transaction } from '../mutation-safety.mjs';

test('a failed COMMIT is reported as an ambiguous outcome, never as retryable', async () => {
  const client = {
    released: false,
    async query(sql) {
      if (sql === 'COMMIT') throw Object.assign(new Error('connection reset during commit'), { code: 'ECONNRESET' });
      return { rows: [], rowCount: 1 };
    },
    release() { this.released = true; },
  };
  const pool = { connect: async () => client };
  const error = await transaction(pool, async () => 'value', 'owner-1', 'memento_dev', { lockTimeoutMs: 100 })
    .then(() => null, e => e);
  assert.equal(error.code, 'ECONNRESET');
  assert.equal(error.ambiguousCommit, true, 'a commit-phase failure is ambiguous');
  assert.notEqual(error.retryableTimeout, true, 'ambiguous outcome must not be advertised as retryable');
  assert.equal(client.released, true, 'the client is always released');
});

test('a lock timeout is a retryable known-not-committed failure and keeps unrelated owners available', async () => {
  const seen = [];
  const client = {
    released: false,
    async query(sql, args) {
      seen.push(sql);
      if (sql.startsWith('SET LOCAL lock_timeout')) return { rows: [], rowCount: 1 };
      if (sql.includes('pg_advisory_xact_lock')) throw Object.assign(new Error('lock not available'), { code: '55P03' });
      return { rows: [], rowCount: 1 };
    },
    release() { this.released = true; },
  };
  const pool = { connect: async () => client };
  const error = await transaction(pool, async () => 'value', 'owner-hot', 'memento_dev', { lockTimeoutMs: 50 })
    .then(() => null, e => e);
  assert.equal(error.code, '55P03');
  assert.equal(error.retryableTimeout, true, 'lock wait timeout never reached COMMIT');
  assert.ok(seen.some(sql => sql.startsWith('SET LOCAL lock_timeout')), 'the lock wait is bounded explicitly');
  assert.equal(client.released, true);
});

test('acquisition failure is bounded and released, with the original error preserved', async () => {
  const pool = { connect: async () => { throw Object.assign(new Error('timeout exceeded when trying to connect'), { code: 'ETIMEDOUT' }); } };
  const error = await transaction(pool, async () => 'value', 'owner-1', 'memento_dev').then(() => null, e => e);
  assert.equal(error.code, 'ETIMEDOUT');
  assert.notEqual(error.ambiguousCommit, true, 'never acquired: no commit ambiguity');
});

test('ROLLBACK failure never masks the original error', async () => {
  const client = {
    released: false,
    async query(sql) {
      if (sql === 'ROLLBACK') throw new Error('rollback failed');
      return { rows: [], rowCount: 1 };
    },
    release() { this.released = true; },
  };
  const pool = { connect: async () => client };
  const error = await transaction(pool, async () => { throw Object.assign(new Error('work exploded'), { code: '23514' }); }, 'owner-1', 'memento_dev', { lockTimeoutMs: 50 })
    .then(() => null, e => e);
  assert.equal(error.message, 'work exploded');
  assert.equal(client.released, true);
});

test('real PostgreSQL: a held owner lock times out boundedly while an unrelated owner proceeds', { timeout: 60000 }, async t => {
  if (process.env.RUN_INTEGRATION !== '1') return t.skip('RUN_INTEGRATION=1 required');
  dotenv.config({ path: process.env.ENV_FILE || '.env.local' });
  const { DB_BUDGETS } = await import('../memento-db.mjs');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 2000 });
  const holder = await pool.connect();
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['memento_dev:owner:locked-owner']);
    const held = transaction(pool, async () => 'never', 'locked-owner', 'memento_dev', { ...DB_BUDGETS, lockTimeoutMs: 300 });
    const hot = await assert.rejects(held, error => error.code === '55P03' && error.retryableTimeout === true);
    assert.equal(hot, undefined);
    // An unrelated owner takes a different advisory key and must not queue.
    const started = Date.now();
    const value = await transaction(pool, async client => {
      const probe = await client.query('SELECT 1 AS ok');
      return probe.rows[0].ok;
    }, 'other-owner', 'memento_dev', { ...DB_BUDGETS, lockTimeoutMs: 3000 });
    assert.equal(value, 1);
    assert.ok(Date.now() - started < 2000, 'unrelated owner must not wait on the hot lock');
  } finally {
    await holder.query('ROLLBACK').catch(() => {});
    holder.release();
    await pool.end().catch(() => {});
  }
});

test('real PostgreSQL: an exhausted isolated pool fails within the acquisition bound and recovers', { timeout: 60000 }, async t => {
  if (process.env.RUN_INTEGRATION !== '1') return t.skip('RUN_INTEGRATION=1 required');
  dotenv.config({ path: process.env.ENV_FILE || '.env.local' });
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 400 });
  const squatter = await pool.connect();
  try {
    const started = Date.now();
    const error = await transaction(pool, async () => 'never', 'owner-1', 'memento_dev', { lockTimeoutMs: 100 })
      .then(() => null, e => e);
    const waited = Date.now() - started;
    assert.ok(error, 'an exhausted pool must reject, not hang');
    assert.ok(waited < 3000, `acquisition waited ${waited}ms, expected the configured bound`);
    assert.notEqual(error.ambiguousCommit, true, 'nothing was acquired, so nothing is ambiguous');
  } finally {
    squatter.release();
    // Recovery: the same pool serves a transaction once the slot returns.
    const value = await transaction(pool, async client => (await client.query('SELECT 1 AS ok')).rows[0].ok, 'owner-1', 'memento_dev', { lockTimeoutMs: 1000 });
    assert.equal(value, 1);
    await pool.end().catch(() => {});
  }
});
