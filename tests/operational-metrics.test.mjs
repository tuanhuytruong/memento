import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createOperationalMetrics, instrumentPool, cleanupExpiredSessions, sampleOperationalState } from '../operational-metrics.mjs';

test('closed labels, fixed buckets and copies prevent private/cardinality leaks', () => {
 const m=createOperationalMetrics();
 m.increment('owner-secret'); m.gauge('cookie-secret',1);
 m.imageTiming({cache:'hit',status:'ok',totalMs:10,upstreamHeadersMs:null,key:'object-secret',url:'url-secret'});
 m.imageTiming({cache:'private-search',status:'username-secret',totalMs:NaN});
 const s=m.snapshot(); assert.deepEqual({...s.counters},{'image.hit':1,'image.ok':1});
 assert.equal(s.durations['image.total'].count,1); assert.equal(s.durations['image.total'].buckets[1],1);
 assert.doesNotMatch(JSON.stringify(s),/secret|private-search/);
 s.counters['image.hit']=90; assert.equal(m.snapshot().counters['image.hit'],1);
});
test('route template only; disconnect and finish count once', () => {
 let time=1; const m=createOperationalMetrics({now:()=>time});
 for(const route of ['/api/images/:id','/api/sensitive/secret']) {
  const r=new EventEmitter(); Object.assign(r,{statusCode:503,writableFinished:false});
  m.middleware({method:'GET',route:{path:route},originalUrl:'secret?search=private',headers:{cookie:'secret'}},r,()=>{});
  time+=10;r.emit('close');r.emit('finish');
 }
 assert.equal(Object.keys(m.snapshot().durations).length,2);
 assert.equal(m.snapshot().durations['route.GET.other.disconnect'].count,1);
 assert.doesNotMatch(JSON.stringify(m.snapshot()),/secret|private/);
});
test('pool connect callback and promise forms retain release/errors', async () => {
 const m=createOperationalMetrics(); const client={}; const release=()=>{};
 const p=instrumentPool({connect(callback){if(callback){callback(null,client,release);return undefined;}return Promise.resolve(client);}},m);
 assert.equal(await p.connect(),client);
 await new Promise(resolve=>p.connect((err,c,r)=>{assert.equal(err,null);assert.equal(c,client);assert.equal(r,release);resolve();}));
 assert.equal(m.snapshot().durations['db.acquire.ok'].count,2);
 const bad=instrumentPool({connect(cb){const e=new Error('private');if(cb)cb(e);else return Promise.reject(e);}},m);
 await assert.rejects(bad.connect());bad.connect(e=>assert.ok(e));
 assert.equal(m.snapshot().durations['db.acquire.error'].count,2);
});
test('expiry cleanup validates schema and bound, uses indexed SKIP LOCKED and active veto',async()=>{
 let sql,args;const pool={query:async(s,a)=>{sql=s;args=a;return {rowCount:2};}};
 assert.equal(await cleanupExpiredSessions(pool,'"memento_dev"',10),2);
 assert.match(sql,/FOR UPDATE SKIP LOCKED LIMIT/);assert.match(sql,/s.expires_at <= now\(\)/);assert.deepEqual(args,[10]);
 await assert.rejects(cleanupExpiredSessions(pool,'untrusted',10));await assert.rejects(cleanupExpiredSessions(pool,'"memento_dev"',1001));
});
test('real DEV expiry cleanup is bounded, concurrent-safe and preserves active sessions',async t=>{
 if(process.env.RUN_INTEGRATION!=='1')return t.skip('RUN_INTEGRATION=1');
 const {pool,qschema,schema}=await import('../memento-db.mjs');
 if(schema!=='memento_dev')return t.skip('DEV only');
 const {randomUUID}=await import('node:crypto');const user=randomUUID();const key=randomUUID();
 const c=await pool.connect();
 try {
 await pool.query(`INSERT INTO ${qschema}.users(id,username,password_hash) VALUES($1,$2,'synthetic')`,[user,key]);
 await pool.query(`INSERT INTO ${qschema}.sessions(token_hash,user_id,expires_at) SELECT $1||g,$2,now()+CASE WHEN g=4 THEN interval '1 day' ELSE interval '-1 day' END FROM generate_series(1,4)g`,[key,user]);
 // Lock only our rows. Another process must skip rather than delete them.
 await c.query('BEGIN');await c.query(`SELECT 1 FROM ${qschema}.sessions WHERE user_id=$1 FOR UPDATE`,[user]);
 const scoped={query:(sql,args)=>pool.query(sql.replace('WHERE expires_at <= now()',`WHERE user_id='${user}'::uuid AND expires_at <= now()`),args)};
 const deleted=await cleanupExpiredSessions(scoped,qschema,2);assert.equal(deleted,0);
 assert.equal((await c.query(`SELECT count(*)::int n FROM ${qschema}.sessions WHERE user_id=$1`,[user])).rows[0].n,4);
 await c.query('ROLLBACK');
 // Operate on isolated TEMP copies for deletion assertions; no unrelated session deletion.
 await c.query('BEGIN');await c.query(`CREATE TEMP TABLE sessions (LIKE ${qschema}.sessions INCLUDING ALL) ON COMMIT DROP`);
 await c.query(`INSERT INTO pg_temp.sessions SELECT * FROM ${qschema}.sessions WHERE user_id=$1`,[user]);
 // Function schema allowlist deliberately excludes pg_temp; validate actual SQL
 // against the isolated table via a test-only adapter, retaining production guard.
 const adapter={query:(sql,args)=>c.query(sql.replaceAll(qschema+'.sessions','pg_temp.sessions'),args)};
 assert.equal(await cleanupExpiredSessions(adapter,qschema,2),2);
 assert.equal(await cleanupExpiredSessions(adapter,qschema,2),1);
 assert.equal(await cleanupExpiredSessions(adapter,qschema,2),0);
 assert.equal((await c.query('SELECT count(*)::int n FROM pg_temp.sessions')).rows[0].n,1);
 await c.query('ROLLBACK');
 const snapshot=await sampleOperationalState({pool,qschema});assert.ok(snapshot.gauges['cleanup.pending']>=0);
 } finally {await c.query('ROLLBACK');c.release();await pool.query(`DELETE FROM ${qschema}.users WHERE id=$1`,[user]);await pool.end();}
});
