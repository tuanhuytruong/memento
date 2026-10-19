import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBrowseRequest, sealBrowseCursor, openBrowseCursor, browseMonths,browsePreview,seekMoments} from '../month-browse-queries.mjs';
test('strict month and bounded request validation',()=>{
 for(const month of ['2026-00','2026-13','x',null]) assert.throws(()=>validateBrowseRequest({month},'preview'),/month/);
 for(const month of ['0000-02','0099-12','undated']) assert.equal(validateBrowseRequest({month},'preview').month,month);
 assert.throws(()=>validateBrowseRequest({month:'2026-01',limit:41},'preview'),/limit/);
 assert.throws(()=>validateBrowseRequest({target:{month:'2026-01',id:'x'}},'seek'),/target/);
});
test('authenticated cursor rejects forgery and account/scope/month/direction replay',()=>{
 const binding={user:'a',scope:'scope',month:'2026-01',purpose:'preview',navigation:'next'};
 const token=sealBrowseCursor({id:'x'},binding);
 assert.equal(openBrowseCursor(token,binding).id,'x');
 for(const key of Object.keys(binding)) assert.throws(()=>openBrowseCursor(token,{...binding,[key]:'other'}),/cursor/);
 assert.throws(()=>openBrowseCursor(token.slice(0,-5)+'xxxxx',binding),/cursor/);
});

import dotenv from 'dotenv';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {queryMoments,validateQueryRequest,encodeCursor,scopeHash} from '../moment-queries.mjs';
dotenv.config({path:'.env.local',quiet:true});
test('DEV disposable SQL: permissions, strict calendars, full counts, both paging directions, far seek and forged tokens', {timeout:180000},async t=>{
 if(process.env.RUN_INTEGRATION!=='1')return t.skip('RUN_INTEGRATION=1 required');assert.equal(process.env.DB_SCHEMA,'memento_dev');
 const {default:pg}=await import('pg');const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});const c=await pool.connect();const owner=crypto.randomUUID(),viewer=crypto.randomUUID(),editor=crypto.randomUUID(),stranger=crypto.randomUUID();
 const helpers={safeMoment:(doc,images,reactions,version,resourceOwnerId)=>({...doc,images,version,resourceOwnerId})};
 try{await c.query('BEGIN');await c.query(`CREATE TEMP TABLE moments(owner_id uuid,id text,event_id text,document jsonb,version int default 1,search_text text default '') ON COMMIT DROP;CREATE TEMP TABLE track_collaborators(owner_id uuid,track_id text,recipient_id uuid,accepted_at timestamptz,revoked_at timestamptz,expires_at timestamptz,role text) ON COMMIT DROP;CREATE TEMP TABLE images(owner_id uuid,moment_id text,id text,created_at timestamptz) ON COMMIT DROP;CREATE TEMP TABLE saved_moments(user_id uuid,moment_owner_id uuid,moment_id text) ON COMMIT DROP`);
 for(const [user,role]of [[viewer,'viewer'],[editor,'editor']])await c.query(`INSERT INTO pg_temp.track_collaborators VALUES($1,'shared',$2,now(),null,now()-interval '1 year',$3)`,[owner,user,role]);
 const docs=Array.from({length:5000},(_,i)=>({id:`m${String(i).padStart(5,'0')}`,eventId:i<100?'private':'shared',date:i<400?'2026-10-15':i<1000?'2026-09-15':`${String(2000+i%20)}-01-01`,title:'Kỷ niệm %_ '+i,description:'x'.repeat(10000),tags:['qa']}));docs.push({id:'bad',eventId:'shared',date:'2026-02-30'},{id:'leap',eventId:'shared',date:'0000-02-29'},{id:'low',eventId:'shared',date:'0099-12-31'});
 await c.query(`INSERT INTO pg_temp.moments(owner_id,id,event_id,document,search_text) SELECT $1,v->>'id',v->>'eventId',v,'ky niem %_ '||(v->>'id') FROM jsonb_array_elements($2::jsonb)v`,[owner,JSON.stringify(docs)]);
 for(const user of [owner,viewer,editor]){const m=await browseMonths(c,user,{},'pg_temp');assert.equal(m.months.find(x=>x.key==='2026-10').count,user===owner?400:300);assert.equal(m.undatedCount,1);assert(m.months.some(x=>x.key==='0000-02'));assert(!m.months.some(x=>x.key==='2026-02'));}
 assert.equal((await browseMonths(c,stranger,{},'pg_temp')).months.length,0);
 assert.equal((await browsePreview(c,viewer,{month:'undated'},'pg_temp')).items[0].id,'bad');
 const measurements=[];for(const temperature of ['first-call','warm'])for(const [name,run]of [['metadata',()=>browseMonths(c,viewer,{},'pg_temp')],['preview',()=>browsePreview(c,viewer,{month:'2026-09'},'pg_temp')],['seek',()=>seekMoments(c,viewer,{target:{ownerId:owner,id:'m00900'}},'pg_temp',helpers)]]){const start=performance.now();const result=await run();measurements.push({n:5003,temperature,name,ms:performance.now()-start,bytes:Buffer.byteLength(JSON.stringify(result))});}t.diagnostic(JSON.stringify(measurements));
 const req=validateQueryRequest({limit:40},viewer);const scope=scopeHash(req.filters,req.direction,viewer);await assert.rejects(queryMoments(c,viewer,{...req,cursor:encodeCursor({date:'2026-01-01',time:'99:99',ownerId:owner,id:'m',direction:req.direction,scope})},'pg_temp',helpers),e=>e.status===400);
 for(const sortDirection of ['newest','oldest']){const first=await browsePreview(c,viewer,{month:'2026-09',sortDirection},'pg_temp');assert.equal(first.total,600);assert.equal(first.items.length,24);assert(first.items.every(x=>x.excerpt.length<=200));assert(!JSON.stringify(first).includes('description'));const next=await browsePreview(c,viewer,{month:'2026-09',sortDirection,cursor:first.nextCursor},'pg_temp');const prev=await browsePreview(c,viewer,{month:'2026-09',sortDirection,cursor:next.previousCursor,navigation:'previous'},'pg_temp');assert.deepEqual(prev.items,first.items);
 const landed=await seekMoments(c,viewer,{target:{ownerId:owner,id:'m00900'},sortDirection},'pg_temp',helpers);assert.equal(landed.moments[0].id,'m00900');assert.equal(landed.total,4903);assert(landed.previousCursor);const back=await queryMoments(c,viewer,{...validateQueryRequest({sortDirection},viewer),cursor:landed.previousCursor,navigation:'previous'},'pg_temp',helpers);assert.equal(back.moments.length,40);const forward=await queryMoments(c,viewer,{...validateQueryRequest({sortDirection},viewer),cursor:back.nextCursor},'pg_temp',helpers);assert.equal(forward.moments[0].id,'m00900');
 const start=await queryMoments(c,viewer,validateQueryRequest({sortDirection},viewer),'pg_temp',helpers);const firstSeek=await seekMoments(c,viewer,{target:{ownerId:owner,id:start.moments[0].id},sortDirection},'pg_temp',helpers);assert.equal(firstSeek.previousCursor,null);
 }
 for(const target of [{ownerId:owner,id:'m00000'},{ownerId:stranger,id:'m00900'},{month:'2026-02'}])await assert.rejects(seekMoments(c,viewer,{target},'pg_temp',helpers),e=>e.status===404);
 assert.equal((await browsePreview(c,viewer,{month:'2026-09',search:'%_'},'pg_temp')).total,600);
 // EXPLAIN actual production-builder statements, metadata-only disposable data. No real user documents.
 const plans=[];const explainClient={async query(sql,args){const plan=await c.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+sql,args);plans.push(plan.rows[0]['QUERY PLAN']);return c.query(sql,args);}};
 for(const n of [5003,1000]){if(n===1000)await c.query("DELETE FROM pg_temp.moments WHERE id NOT IN(SELECT id FROM pg_temp.moments ORDER BY id LIMIT 1000)");const start=performance.now();await browseMonths(explainClient,viewer,{},'pg_temp');await seekMoments(explainClient,viewer,{target:{ownerId:owner,id:'m00900'}},'pg_temp',helpers);fs.mkdirSync('.hermes/evidence/month-quick-browse',{recursive:true});fs.writeFileSync(`.hermes/evidence/month-quick-browse/temp-explain-${n}.json`,JSON.stringify({explainRows:n,msIncludingExplain:performance.now()-start,plans:plans.splice(0)},null,2));t.diagnostic(`EXPLAIN plans saved for ${n} TEMP rows`);}
 await c.query('UPDATE pg_temp.track_collaborators SET revoked_at=now() WHERE recipient_id=$1',[viewer]);assert.equal((await browseMonths(c,viewer,{},'pg_temp')).months.length,0);await assert.rejects(seekMoments(c,viewer,{target:{ownerId:owner,id:'m00900'}},'pg_temp',helpers),e=>e.status===404);
 }finally{await c.query('ROLLBACK');c.release();await pool.end();}
});
