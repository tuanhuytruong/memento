// Measurement-only DEV harness. Never copies account data; fixtures are generated.
import {pool,schema,qschema,hashSession} from '../memento-db.mjs';
import {queryMoments,queryFacets,validateQueryRequest} from '../moment-queries.mjs';
import {sqlSearchCorpus} from '../moment-search.mjs';
import {backfillSearch} from './backfill-moment-search.mjs';
import {performance} from 'node:perf_hooks';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
if(process.argv.includes('--help')){console.log('DEV-only generated TEMP fixtures; 30 SQL/20 authenticated HTTP samples; disposable schema for concurrent backfill, removed in finally. No deployment/cache flush/private data. JSON evidence --output=PATH.');await pool.end();process.exit(0);}
if(schema!=='memento_dev')throw Error('DEV only');
const output=process.argv.find(x=>x.startsWith('--output='))?.slice(9);if(!output)throw Error('--output required');
let result={cache:'warm; first call separately, no cache flush',scope:'Generated fixtures only. Actual query builders and disposable latest-source Express API; corrected-equivalent runtime SQL substitution, not historical deployed binary. Empty images/reactions.',sql:[],http:[],writes:[],concurrency:{},cleanup:false};
const caller='00000000-0000-4000-8000-000000000001',token=crypto.randomBytes(32).toString('hex');
const stats=a=>{const s=[...a].sort((a,b)=>a-b);return {p50Ms:s[Math.ceil(s.length*.5)-1],p95Ms:s[Math.ceil(s.length*.95)-1],samples:a};};
async function measure(run,n=30){let t=performance.now();await run();const firstMs=performance.now()-t,a=[];for(let i=0;i<n;i++){if(n===20)await new Promise(r=>setTimeout(r,270));t=performance.now();await run();a.push(performance.now()-t);}return {firstMs,...stats(a)};}
let c,server,originalQuery,fixtureSchema;
try{
 if(!process.argv.includes('--concurrency-only')){
 c=await pool.connect();await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='120s'; SET LOCAL idle_in_transaction_session_timeout='10min'");
 for(const t of ['moments','track_collaborators','images','saved_moments','users','sessions','moment_reactions'])await c.query(`CREATE TEMP TABLE ${t} (LIKE ${qschema}.${t} INCLUDING ALL) ON COMMIT DROP`);
 for(const r of (await c.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=pg_my_temp_schema()::regnamespace::text AND tablename='moments'")).rows)if(r.indexdef.includes('search_text'))await c.query(`DROP INDEX pg_temp."${r.indexname.replaceAll('"','""')}"`);
 await c.query('INSERT INTO pg_temp.users(id,username,password_hash) VALUES($1,$2,$3)',[caller,'generated_measurement','unused']);await c.query("INSERT INTO pg_temp.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '2 hours')",[hashSession(token),caller]);
 let mode='runtime',queryCount=0;
 const rewrite=sql=>{sql=sql.replaceAll(qschema,'pg_temp').replaceAll('memento_dev.','pg_temp.');if(mode==='runtime')sql=sql.replace('q.search_text LIKE',`${sqlSearchCorpus('q.document')} LIKE`);return sql;};
 const adapter={query:(sql,args)=>{queryCount++;return c.query(rewrite(sql),args);}};
 const {app}=await import('../server.mjs');originalQuery=pool.query;pool.query=adapter.query;
 server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 for(const volume of [100,5000]){
  await c.query('TRUNCATE pg_temp.moments,pg_temp.track_collaborators,pg_temp.saved_moments');
  await c.query(`INSERT INTO pg_temp.moments(owner_id,id,event_id,document,search_text) SELECT owner_id,id,event_id,document,${qschema}.moment_search_text_v1(document) FROM (SELECT ('00000000-0000-4000-8000-'||lpad(o::text,12,'0'))::uuid owner_id,'generated-'||n id,'track-'||(n%10) event_id,jsonb_build_object('id','generated-'||n,'eventId','track-'||(n%10),'date',to_char(date '2010-01-01'+(n%5000),'YYYY-MM-DD'),'time','12:00','title',CASE WHEN n%101=0 THEN 'Rare Đà Lạt' ELSE 'Common memory' END,'description',repeat('synthetic ordinary story ',20)||CASE WHEN n%101=0 THEN 'specialneedle %_literal' ELSE '' END,'tags',jsonb_build_array('sample'),'emotion','joy') document FROM generate_series(1,4)o CROSS JOIN generate_series(1,$1)n)f`,[volume]);
  await c.query(`INSERT INTO pg_temp.track_collaborators(id,owner_id,track_id,recipient_id,role,expires_at,accepted_at,revoked_at) SELECT ('00000000-0000-4000-9000-'||lpad(n::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000000002','track-'||n,$1,'viewer',now()+interval '1 day',now(),CASE WHEN n=1 THEN now() ELSE NULL END FROM generate_series(0,1)n`,[caller]);
  await c.query('ANALYZE pg_temp.moments');await c.query('ANALYZE pg_temp.track_collaborators');
  for(mode of ['runtime','stored','gin']){
   if(mode==='gin')await c.query('CREATE INDEX acceptance_gin ON pg_temp.moments USING gin(search_text public.gin_trgm_ops)');
   for(const [name,search] of [['no-search',''],['rare','specialneedle']]){
    const req=validateQueryRequest({search},caller);
    const run=async()=>{await queryMoments(adapter,caller,req,'pg_temp',{safeMoment:d=>({id:d.id})});await queryFacets(adapter,caller,req,'pg_temp');};
    queryCount=0;const data=await measure(run);result.sql.push({volume,mode,name,kind:'direct sequential page+total',...data,queryCount});
    // Actual guarded route, with session lookup, image/reaction enrichment and serialization.
    for(const includeTotal of [false,true]){
     queryCount=0;const data=await measure(async()=>{const r=await fetch(base+'/api/moments/query',{method:'POST',headers:{Cookie:'memento_session='+token,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({search,includeTotal})});if(r.status!==200)throw Error('HTTP status '+r.status);const body=await r.json();if(!Array.isArray(body.moments))throw Error('response shape');},20);
     result.http.push({volume,mode,name,includeTotal,...data,queryCount});
    }
   }
  }
  if(volume===5000){
   for(const indexed of [true,false]){
    if(!indexed)await c.query('DROP INDEX pg_temp.acceptance_gin');
    for(const trigger of [false,true]){
     if(trigger)await c.query(`CREATE TRIGGER acceptance_write BEFORE UPDATE OF document ON pg_temp.moments FOR EACH ROW EXECUTE FUNCTION ${qschema}.maintain_moment_search_v1()`);
     result.writes.push({indexed,trigger,...await measure(()=>c.query("UPDATE pg_temp.moments SET document=jsonb_set(document,'{title}',to_jsonb('write '||random()::text)) WHERE owner_id=$1 AND id='generated-1'",[caller]))});
     if(trigger)await c.query('DROP TRIGGER acceptance_write ON pg_temp.moments');
    }
   }
  }else await c.query('DROP INDEX pg_temp.acceptance_gin');
 }
 pool.query=originalQuery;originalQuery=null;await new Promise(r=>server.close(r));server=null;
 await c.query('ROLLBACK');c.release();c=null;
 }
 // Cross-session locks require disposable permanent fixtures, not session-local TEMP tables.
 fixtureSchema='search_measure_'+crypto.randomBytes(6).toString('hex');await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
 await pool.query(`CREATE TABLE "${fixtureSchema}".moments (LIKE ${qschema}.moments INCLUDING ALL)`);
 await pool.query(`INSERT INTO "${fixtureSchema}".moments(owner_id,id,event_id,document) SELECT $1,'generated-'||lpad(n::text,5,'0'),'track',jsonb_build_object('id','generated-'||lpad(n::text,5,'0'),'eventId','track','title','Generated backfill','description',repeat('safe synthetic ',20)) FROM generate_series(1,2000)n`,[caller]);
 const worker=await pool.connect(),holder=await pool.connect(),observer=await pool.connect();
 const waits=[],locks=[],poolSamples=[],reads=[],writes=[],batches=[];let timer;
 const schemaAdapter={query:(sql,args)=>worker.query(sql.replaceAll('"memento_dev".moments',`"${fixtureSchema}".moments`),args)};
 try{
  await holder.query('BEGIN');await holder.query(`SELECT 1 FROM "${fixtureSchema}".moments WHERE id='generated-00001' FOR UPDATE`);
  const pid=(await worker.query('SELECT pg_backend_pid() p')).rows[0].p;
  timer=setTimeout(()=>holder.query('COMMIT'),300);
  let running=true;
  const monitor=(async()=>{while(running){const t=performance.now(),p=await pool.connect();waits.push(performance.now()-t);try{let t=performance.now();await p.query(`SELECT count(*) FROM "${fixtureSchema}".moments`);reads.push(performance.now()-t);t=performance.now();await p.query(`UPDATE "${fixtureSchema}".moments SET document=document WHERE id='generated-02000'`);writes.push(performance.now()-t);}finally{p.release();}poolSamples.push({total:pool.totalCount,idle:pool.idleCount,waiting:pool.waitingCount});locks.push((await observer.query('SELECT wait_event_type,wait_event,(SELECT count(*)::int FROM pg_locks WHERE pid=$1 AND NOT granted) ungranted FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0]);await new Promise(r=>setTimeout(r,10));}})();
  const t=performance.now();let outcome;try{outcome=await backfillSearch(schemaAdapter,'memento_dev',{onBatch:x=>batches.push({elapsedMs:performance.now()-t,...x})});}finally{running=false;await monitor;}
  result.concurrency={fixtureRows:2000,batchSize:200,delayMs:25,elapsedMs:performance.now()-t,outcome,batches,acquire:stats(waits),read:stats(reads),write:stats(writes),poolSamples,locks,deliberateRowLockHoldMs:300,limitation:'isolated process pool; one concurrent read/write worker, one backfill worker, row-lock holder and observer; not live API pool saturation or arbitrary production load'};
 }finally{clearTimeout(timer);await holder.query('ROLLBACK');worker.release();holder.release();observer.release();}
 result.passed=true;
}catch(e){result.passed=false;result.error=e.stack;process.exitCode=1;}finally{
 if(originalQuery)pool.query=originalQuery;
 if(server)await new Promise(r=>server.close(r));
 if(c){await c.query('ROLLBACK');c.release();}
 if(fixtureSchema)await pool.query(`DROP SCHEMA "${fixtureSchema}" CASCADE`);
 result.cleanup=true;await pool.end();fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.passed,sql:result.sql.length,http:result.http.length,output,error:result.error}));
}
