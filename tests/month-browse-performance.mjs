import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import dotenv from 'dotenv';
import pg from 'pg';
import { browseMonths, browsePreview, seekMoments } from '../month-browse-queries.mjs';

dotenv.config({ path: process.env.ENV_FILE || '.env.local', quiet: true });
assert.equal(process.env.DB_SCHEMA, 'memento_dev', 'DEV schema required');
assert.equal(process.env.RUN_INTEGRATION, '1', 'RUN_INTEGRATION=1 required');
assert.ok(process.env.DATABASE_URL, 'database configuration required');
const schema = '"memento_dev"';
const repeats = 20;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000, statement_timeout: 30000 });
const evidence = {
  measuredAt: new Date().toISOString(), schema: 'memento_dev', repeats,
  method: 'Unchanged production browseMonths/browsePreview/seekMoments builders; transaction-scoped disposable real DEV-schema fixtures; one dedicated pg client; performance.now end-to-end builder latency and query calls instrumented.',
  caveats: [
    'First call is not cold cache: no server restart, cache flush or OS cache control. Warm samples follow first call on the same connection.',
    'Synthetic fixtures coexist with real DEV rows; authorization excludes unrelated rows but plans may scan them. No ANALYZE, migrations, indexes, deployment or real-data mutations.',
    'Single connection; parallel builder queries queue on this client. Timings exclude HTTP/auth/network/browser rendering and setup, include JS mapping/signing and DB round trips.',
    'No image/reaction fixtures, no R2 calls or photo performance claims. Required safeMoment mapper matches integration fixture; production reactionSummaries helper omitted, so seek count/timing/payload excludes reaction enrichment.',
    'Payload bytes are exact UTF-8 JSON.stringify builder response bytes, not HTTP compressed bytes; seek uses integration mapper rather than production safeMoment.',
    'Plans are EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) replays of each actual statement, after warm runs, not included in timed builder calls.',
    'Repeated READ COMMITTED statements are not an atomic snapshot; no concurrency/load simulation. Aggregate work is not O(1). UUIDs and disposable labels sanitized in plans.'
  ], runs: []
};
const quantile = (values, p) => [...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
const summarize = values => ({ min: Math.min(...values), p50: quantile(values,.5), p95: quantile(values,.95), max: Math.max(...values) });
const sanitize = value => JSON.parse(JSON.stringify(value).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,'00000000-0000-4000-8000-000000000000').replace(/mbperf-[a-z0-9-]+/g,'disposable-fixture'));
const helpers = { safeMoment: (document,images,reactions,version,resourceOwnerId) => ({...document,images,reactions,version,resourceOwnerId}) };
try {
 for (const size of [1000,5000]) {
  const client = await pool.connect();
  const users = Array.from({length:3},()=>randomUUID());
  const [owner,sharedOwner,viewer] = users;
  const track = `mbperf-${randomUUID()}`;
  const privateTrack = `mbperf-${randomUUID()}`;
  let begun = false;
  const run = { fixtureMoments: size, fixture: '60% owned shared track, 30% other-owner accepted shared track, 10% private excluded; 50% dense September, remainder sparse over 36 months with undated rows; 1200-character descriptions; no images/reactions', measurements: [] };
  evidence.runs.push(run);
  try {
   await client.query('BEGIN'); begun = true;
   for(const user of users) await client.query(`INSERT INTO ${schema}.users(id,username,password_hash) VALUES($1,$2,$3)`,[user,`mbperf_${user.replaceAll('-','')}`,'disposable-not-a-login']);
   for(const [user,id] of [[owner,track],[sharedOwner,track],[owner,privateTrack]]) await client.query(`INSERT INTO ${schema}.tracks(owner_id,id,document) VALUES($1,$2,$3)`,[user,id,{id,title:'Disposable performance fixture',tags:[]}]);
   for(const user of [owner,sharedOwner]) await client.query(`INSERT INTO ${schema}.track_collaborators(id,owner_id,track_id,recipient_id,role,invited_at,expires_at,accepted_at) VALUES($1,$2,$3,$4,'viewer',now()-interval '3 days',now()-interval '1 day',now()-interval '2 days')`,[randomUUID(),user,track,viewer]);
   const documents = Array.from({length:size},(_,i)=>{
    const bucket=i%10; const month=i%36;
    const date=i%50===49?'':i%2===0?'2026-09-15':`${2023+Math.floor(month/12)}-${String(month%12+1).padStart(2,'0')}-${String(i%28+1).padStart(2,'0')}`;
    return {ownerId:bucket<6?owner:bucket<9?sharedOwner:owner,document:{id:`perf-${String(i).padStart(6,'0')}`,eventId:bucket===9?privateTrack:track,date,time:'12:34',title:'Synthetic month query',description:'x'.repeat(1200),tags:['synthetic']}};
   });
   await client.query(`INSERT INTO ${schema}.moments(owner_id,id,event_id,document) SELECT (v->>'ownerId')::uuid,v->'document'->>'id',v->'document'->>'eventId',v->'document' FROM jsonb_array_elements($1::jsonb) v`,[JSON.stringify(documents)]);
   run.visibleMoments = documents.filter(r=>r.document.eventId===track).length;
   for(const sortDirection of ['newest','oldest']) for(const operation of ['months','preview','seekItem','seekMonth']) {
    const invoke = db => operation==='months'?browseMonths(db,viewer,{sortDirection},schema):operation==='preview'?browsePreview(db,viewer,{sortDirection,month:'2026-09'},schema):seekMoments(db,viewer,{sortDirection,target:operation==='seekMonth'?{month:'2026-09'}:{ownerId:owner,id:'perf-000500'}},schema,helpers);
    const samples=[]; let statements=[];
    for(let n=0;n<=repeats;n++) {
     const calls=[];
     const instrumented={query:async(text,args)=>{
      const params=structuredClone(args); const start=performance.now();
      const result=await client.query(text,args);
      calls.push({text,args:params,elapsedMs:performance.now()-start,rows:result.rowCount});
      return result;
     }};
     const start=performance.now(); const result=await invoke(instrumented); const elapsedMs=performance.now()-start;
     if(operation.startsWith('seek')) assert.equal(result.total,run.visibleMoments);
     samples.push({elapsedMs,queryCount:calls.length,payloadBytes:Buffer.byteLength(JSON.stringify(result)),queryElapsedMs:calls.map(c=>c.elapsedMs),queryRows:calls.map(c=>c.rows)});
     if(n===0) statements=calls;
     assert.equal(calls.length,statements.length,'query count stable');
    }
    const plans=[];
    for(const [index,statement] of statements.entries()) {
     const plan=await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.text}`,statement.args);
     plans.push({statement:index+1,sqlSha256:createHash('sha256').update(statement.text).digest('hex'),plan:sanitize(plan.rows[0]['QUERY PLAN'])});
    }
    run.measurements.push({operation,sortDirection,firstCall:samples[0],warm:{latencyMs:summarize(samples.slice(1).map(s=>s.elapsedMs)),queryCount:[...new Set(samples.slice(1).map(s=>s.queryCount))],payloadBytes:[...new Set(samples.slice(1).map(s=>s.payloadBytes))],samples:samples.slice(1)},plans});
   }
  } finally {
   try {
    if(begun) await client.query('ROLLBACK');
    const residue=(await client.query(`SELECT (SELECT count(*) FROM ${schema}.users WHERE id=ANY($1::uuid[]))::int users,(SELECT count(*) FROM ${schema}.tracks WHERE owner_id=ANY($1::uuid[]))::int tracks,(SELECT count(*) FROM ${schema}.moments WHERE owner_id=ANY($1::uuid[]))::int moments,(SELECT count(*) FROM ${schema}.track_collaborators WHERE owner_id=ANY($1::uuid[]) OR recipient_id=ANY($1::uuid[]))::int collaborators`,[users])).rows[0];
    run.cleanup=residue;
    assert.deepEqual(residue,{users:0,tracks:0,moments:0,collaborators:0});
   } finally { client.release(); }
  }
 }
 evidence.status='passed';
 await mkdir('.hermes/evidence/month-quick-browse',{recursive:true});
 await writeFile('.hermes/evidence/month-quick-browse/backend-performance.json',JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify({status:evidence.status,runs:evidence.runs.map(r=>({fixtureMoments:r.fixtureMoments,visibleMoments:r.visibleMoments,cleanup:r.cleanup,measurements:r.measurements.map(m=>({operation:m.operation,sort:m.sortDirection,firstMs:m.firstCall.elapsedMs,warm:m.warm.latencyMs,queryCount:m.firstCall.queryCount,payloadBytes:m.firstCall.payloadBytes}))}))},null,2));
} catch(error) {
 // Never render database error messages, SQL, parameters, connection details or stacks.
 console.error(JSON.stringify({status:'failed',errorType:error?.constructor?.name||'Error',code:/^[A-Z0-9_]+$/.test(error?.code||'')?error.code:undefined}));
 process.exitCode=1;
} finally { await pool.end(); }
