import crypto from 'node:crypto';

export const imageKeys = rows => [...new Set(rows.flatMap(row => [row.object_key, row.thumb_object_key, row.display_object_key]).filter(Boolean))];
export function cleanupQueue({ pool, qschema, prefix, remove }) {
  const valid = keys => {
    if (!Array.isArray(keys) || !keys.length || keys.some(key => typeof key !== 'string' || !key.startsWith(prefix) || key.includes('..'))) throw new Error('Invalid cleanup namespace');
    return keys;
  };
  async function enqueue(client, keys, { staged = false, jobId = crypto.randomUUID() } = {}) {
    if (!keys.length) return null;
    valid(keys);
    await client.query(`INSERT INTO ${qschema}.object_cleanup_jobs(id,object_keys,state,next_attempt_at) VALUES($1,$2,$3,now()+($4 * interval '1 second'))`, [jobId, JSON.stringify(keys), staged ? 'staged' : 'cleanup', staged ? 3600 : 0]);
    return jobId;
  }
  async function abandon(jobId) {
    await pool.query(`UPDATE ${qschema}.object_cleanup_jobs SET state='cleanup',next_attempt_at=now() WHERE id=$1`, [jobId]);
  }
  async function attach(client, jobId) {
    // A worker may already have claimed an expired stage: never attach its objects.
    const result = await client.query(`DELETE FROM ${qschema}.object_cleanup_jobs WHERE id=$1 AND state='staged' AND next_attempt_at > now() RETURNING id`, [jobId]);
    if (!result.rowCount) throw new Error('Upload staging lease expired');
  }
  async function drain({ limit = 20, retry = false, ids = null } = {}) {
    limit = Math.min(100, Math.max(1, Number(limit) || 20));
    let completed = 0, failed = 0;
    // Claim each job only once in this bounded pass, including on immediate failures.
    const claimed = await pool.query(`UPDATE ${qschema}.object_cleanup_jobs j SET state='cleanup',attempts=attempts+1,lease_until=now()+interval '10 minutes',next_attempt_at=now()+interval '10 minutes' WHERE id IN (
      SELECT id FROM ${qschema}.object_cleanup_jobs WHERE ($3::uuid[] IS NULL OR id=ANY($3::uuid[])) AND (lease_until IS NULL OR lease_until<=now()) AND (next_attempt_at<=now() OR ($2 AND state='cleanup')) ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT $1
    ) RETURNING id,object_keys,attempts`, [limit, retry, ids]);
    for (const job of claimed.rows) {
      try {
        for (const key of valid(job.object_keys)) {
          // Fence stale workers and renew between bounded (30s) storage calls.
          const lease = await pool.query(`UPDATE ${qschema}.object_cleanup_jobs SET lease_until=now()+interval '10 minutes' WHERE id=$1 AND attempts=$2 AND lease_until>now() RETURNING id`, [job.id, job.attempts]);
          if (!lease.rowCount) throw new Error('Cleanup lease lost');
          const live = await pool.query(`SELECT 1 FROM ${qschema}.images WHERE object_key=$1 OR thumb_object_key=$1 OR display_object_key=$1 LIMIT 1`, [key]);
          if (live.rowCount) throw new Error('Cleanup key still referenced');
          await remove(key);
        }
        await pool.query(`DELETE FROM ${qschema}.object_cleanup_jobs WHERE id=$1 AND attempts=$2`, [job.id, job.attempts]);
        completed++;
      } catch {
        // Never log private object keys. Whole manifests replay safely after partial delete.
        await pool.query(`UPDATE ${qschema}.object_cleanup_jobs SET lease_until=NULL,next_attempt_at=now()+($3 * interval '1 second') WHERE id=$1 AND attempts=$2`, [job.id, job.attempts, Math.min(86400, 30 * 2 ** Math.min(job.attempts, 11))]);
        failed++;
      }
    }
    return { claimed: claimed.rowCount, completed, failed };
  }
  return { enqueue, abandon, attach, drain };
}
export function startCleanup(queue, onError = () => {}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await queue.drain(); } catch { onError(); } finally { running = false; }
  };
  void run();
  const timer = setInterval(run, 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
