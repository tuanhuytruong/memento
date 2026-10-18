// DEV only. Reproducible isolated synthetic query plans; no persisted fixtures.
// node scripts/phase3-measurement.mjs > .hermes/evidence/next-phase-3/query-measurement.json
import { pool, schema, qschema } from '../memento-db.mjs';
import { queryMoments, validateQueryRequest, dateKey, timeKey } from '../moment-queries.mjs';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
if (schema !== 'memento_dev') throw new Error('DEV only');
const c = await pool.connect();
const caller = '00000000-0000-4000-8000-000000000001';
const shared = '00000000-0000-4000-8000-000000000002';
const quantile = (xs, p) => [...xs].sort((a,b)=>a-b)[Math.ceil(xs.length*p)-1];
const results = { kind: 'synthetic PostgreSQL, not HTTP/R2/browser', commit: execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(), node: process.version, repeats: 30, cache: 'first measured call separately; warm repeated calls; OS/PG cache not flushed', scenarios: [] };
try {
 await c.query('BEGIN'); await c.query("SET LOCAL statement_timeout='20s'");
 results.database = (await c.query('SELECT current_database() AS database, version() AS postgres')).rows[0];
 results.targetSchema = schema;
 results.actualIndexes = (await c.query('SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname=$1 ORDER BY tablename,indexname',[schema])).rows;
 results.validity = (await c.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE jsonb_typeof(document->'date') IS DISTINCT FROM 'string' OR document->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')::int AS malformed_shape FROM ${qschema}.moments`)).rows[0];
 for (const t of ['moments','track_collaborators','images','saved_moments']) await c.query(`CREATE TEMP TABLE ${t} (LIKE ${qschema}.${t} INCLUDING ALL) ON COMMIT DROP`);
 // LIKE INCLUDING ALL copies deployed secondary indexes too. Remove only the
 // canonical expression index from the TEMP table so baseline remains honest
 // after migration 009 has shipped; retain primary/owner-track indexes.
 for (const row of (await c.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname LIKE 'pg_temp_%' AND tablename='moments'")).rows) {
  if (row.indexdef.includes('CASE')) await c.query(`DROP INDEX pg_temp."${row.indexname.replaceAll('"','""')}"`);
 }
 for (const volume of [100,1000,5000]) {
  await c.query('TRUNCATE pg_temp.moments,pg_temp.track_collaborators');
  await c.query(`INSERT INTO pg_temp.moments(owner_id,id,event_id,document) SELECT ('00000000-0000-4000-8000-'||lpad(o::text,12,'0'))::uuid, 'synthetic-'||n, 'track-'||(n%10), jsonb_build_object('id','synthetic-'||n,'eventId','track-'||(n%10),'date',CASE WHEN n%97=0 THEN 'legacy' ELSE to_char(date '2010-01-01'+(n%5000),'YYYY-MM-DD') END,'time','12:00','title','Synthetic Đà Lạt','description',repeat('synthetic ',30),'tags',jsonb_build_array('sample')) FROM generate_series(1,4) o CROSS JOIN generate_series(1,$1) n`,[volume]);
  await c.query(`INSERT INTO pg_temp.track_collaborators(id,owner_id,track_id,recipient_id,role,expires_at,accepted_at) VALUES('00000000-0000-4000-8000-000000000010',$1,'track-0',$2,'viewer',now()+interval '1 day',now())`,[shared,caller]);
  for (const t of ['moments','track_collaborators','images','saved_moments']) await c.query(`ANALYZE pg_temp.${t}`);
  for (const indexed of [false,true]) {
   if(indexed) await c.query(`CREATE INDEX synthetic_sort_candidate ON pg_temp.moments ((${dateKey('moments')}), (${timeKey('moments')}), owner_id, id)`);
   for (const [name,input] of [['feed',{}],['search',{search:'da lat'}],['track',{trackKey:caller+':track-0'}]]) {
    let pageQuery; let queryCount = 0;
    const adapter = { query: async (sql,args) => { queryCount++; if(sql.includes('WITH authorized AS')) pageQuery={sql,args}; return c.query(sql,args); } };
    const req=validateQueryRequest(input,caller);
    const run=()=>queryMoments(adapter,caller,req,'pg_temp',{safeMoment:(document,images,reactions,version,ownerId)=>({id:document.id,ownerId,version})});
    const began=performance.now(); const first=await run(); const firstMs=performance.now()-began;
    const samples=[]; queryCount=0;
    for(let n=0;n<30;n++){const start=performance.now();await run();samples.push(performance.now()-start);}
    const plan=(await c.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+pageQuery.sql,pageQuery.args)).rows[0]['QUERY PLAN'][0];
    results.scenarios.push({volumePerOwner:volume,totalRows:volume*4,authorizedRows:volume+Math.floor(volume/10),indexed,name,returned:first.moments.length,firstCallMs:firstMs,p50Ms:quantile(samples,.5),p95Ms:quantile(samples,.95),queriesPerCall:queryCount/30,samplesMs:samples,plan});
   }
   if(indexed) await c.query('DROP INDEX pg_temp.synthetic_sort_candidate');
  }
 }
} finally { await c.query('ROLLBACK'); c.release(); await pool.end(); }
console.log(JSON.stringify(results,null,2));
