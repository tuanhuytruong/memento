// DEV-only isolated warm SQL benchmark. No persisted fixture or private content.
import {pool, schema, qschema} from '../memento-db.mjs';
import {queryMoments,queryFacets,validateQueryRequest} from '../moment-queries.mjs';
import {sqlSearchCorpus} from '../moment-search.mjs';
import {performance} from 'node:perf_hooks';
if(process.argv.includes('--help')) {console.log('node scripts/search-measurement.mjs; DEV only, TEMP fixtures, 30 samples/query, JSON stdout; no shared cache flushing.');await pool.end();process.exit(0);}
if(schema!=='memento_dev')throw new Error('DEV only');
const c=await pool.connect();
const caller='00000000-0000-4000-8000-000000000001';
const q=(xs,p)=>[...xs].sort((a,b)=>a-b)[Math.ceil(xs.length*p)-1];
const measure=async run=>{const start=performance.now();await run();const firstMs=performance.now()-start;const samples=[];for(let i=0;i<30;i++){const t=performance.now();await run();samples.push(performance.now()-t);}return {firstMs,p50Ms:q(samples,.5),p95Ms:q(samples,.95),samples};};
const results={kind:'TEMP synthetic warm PostgreSQL; no HTTP/browser/R2; image fixtures empty, reactions omitted',samples:30,cache:'first-call separate, not true cold cache',scenarios:[],writes:[]};
try{
 await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='120s'; SET LOCAL idle_in_transaction_session_timeout='120s'");
 for(const table of ['moments','track_collaborators','images','saved_moments'])await c.query(`CREATE TEMP TABLE ${table} (LIKE ${qschema}.${table} INCLUDING ALL) ON COMMIT DROP`);
 for(const row of (await c.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname LIKE 'pg_temp_%' AND tablename='moments'")).rows)if(row.indexdef.includes('search_text'))await c.query(`DROP INDEX pg_temp."${row.indexname.replaceAll('"','""')}"`);
 for(const volume of [100,1000,5000]){
  await c.query('TRUNCATE pg_temp.moments,pg_temp.track_collaborators,pg_temp.saved_moments');
  await c.query(`INSERT INTO pg_temp.moments(owner_id,id,event_id,document,search_text) SELECT owner_id,id,event_id,document,${qschema}.moment_search_text_v1(document) FROM (SELECT ('00000000-0000-4000-8000-'||lpad(o::text,12,'0'))::uuid owner_id, 'synthetic-'||n id,'track-'||(n%10) event_id,jsonb_build_object('id','synthetic-'||n,'eventId','track-'||(n%10),'date',to_char(date '2010-01-01'+(n%5000),'YYYY-MM-DD'),'time','12:00','title',CASE WHEN n%101=0 THEN 'Rare Đà Lạt' ELSE 'Common memory' END,'description',repeat('synthetic ordinary story ',20)||CASE WHEN n%101=0 THEN 'specialneedle %_literal' ELSE '' END,'tags',jsonb_build_array('sample'),'emotion','joy') document FROM generate_series(1,4)o CROSS JOIN generate_series(1,$1)n)fixture`,[volume]);
  await c.query(`INSERT INTO pg_temp.track_collaborators(id,owner_id,track_id,recipient_id,role,expires_at,accepted_at,revoked_at) SELECT ('00000000-0000-4000-9000-'||lpad(n::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000000002','track-'||n,$1,'viewer',now()+interval '1 day',now(),CASE WHEN n=1 THEN now() ELSE NULL END FROM generate_series(0,1)n`,[caller]);
  await c.query(`INSERT INTO pg_temp.saved_moments(user_id,moment_owner_id,moment_id) SELECT $1,owner_id,id FROM pg_temp.moments WHERE owner_id=$1 AND id LIKE '%1'`,[caller]);
  for(const t of ['moments','track_collaborators','images','saved_moments'])await c.query(`ANALYZE pg_temp.${t}`);
  for(const mode of ['runtime','stored','gin']){
   if(mode==='gin')await c.query('CREATE INDEX search_measure_gin ON pg_temp.moments USING gin(search_text public.gin_trgm_ops)');
   for(const [name,filters] of [['rare',{search:'specialneedle'}],['common',{search:'common'}],['absent',{search:'absentneedle'}],['one',{search:'a'}],['two',{search:'me'}],['three',{search:'rar'}],['literal',{search:'%_'}],['combined',{search:'specialneedle',savedOnly:true,dateFrom:'2011-01-01',trackKey:caller+':track-1'}]]){
    const req=validateQueryRequest(filters,caller);
    for(const kind of ['page','total']){
     let captured;
     const adapter={query:(sql,args)=>{if(mode==='runtime')sql=sql.replace('q.search_text LIKE',`${sqlSearchCorpus('q.document')} LIKE`);if(sql.includes('WITH authorized'))captured={sql,args};return c.query(sql,args);}};
     const run=()=>kind==='page'?queryMoments(adapter,caller,req,'pg_temp',{safeMoment:d=>({id:d.id})}):queryFacets(adapter,caller,req,'pg_temp');
     const data=await measure(run);
     const plan=(await c.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+captured.sql,captured.args)).rows[0]['QUERY PLAN'][0];
     results.scenarios.push({volume,mode,name,kind,...data,plan});
    }
   }
   if(mode==='gin')results.indexBytes=(await c.query("SELECT pg_relation_size('pg_temp.search_measure_gin')::int AS bytes")).rows[0].bytes;
  }
  await c.query('DROP INDEX pg_temp.search_measure_gin');
 }
 // The TEMP probe inherits checks and indexes, but not live triggers. Measure document updates with/without trigger.
 for(const trigger of [false,true]){
  if(trigger)await c.query(`CREATE TRIGGER write_probe BEFORE UPDATE OF document ON pg_temp.moments FOR EACH ROW EXECUTE FUNCTION ${qschema}.maintain_moment_search_v1()`);
  results.writes.push({trigger,...await measure(()=>c.query(`UPDATE pg_temp.moments SET document=jsonb_set(document,'{title}',to_jsonb('write '||random()::text)) WHERE owner_id=$1 AND id='synthetic-1'`,[caller]))});
 }
}finally{await c.query('ROLLBACK');c.release();await pool.end();}
console.log(JSON.stringify(results,null,2));
