import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool,qschema as q,schema} from '../memento-db.mjs';
import {app} from '../server.mjs';
import {encodeStoryCursor,decodeStoryCursor} from '../story-queries.mjs';
test('story cursor rejects forgery, scope, expiry and oversized tokens',()=>{
 const secret='x'.repeat(40),scope={userId:randomUUID(),trackOwnerId:randomUUID(),trackId:'t'},v={...scope,id:randomUUID(),updatedAt:new Date().toISOString(),expiresAt:Date.now()+10000};
 const token=encodeStoryCursor(v,secret);assert.equal(decodeStoryCursor(token,scope,secret).id,v.id);
 for(const [t,s] of [[token+'x',scope],['x'.repeat(2049),scope],[token,{...scope,userId:randomUUID()}],[encodeStoryCursor({...v,expiresAt:0},secret),scope]])assert.throws(()=>decodeStoryCursor(t,s,secret),e=>e.status===400);
});
test('DEV authenticated stories: live references, ACL, versions, replay/tombstone, bounded cursors and track cascade',async t=>{
 if(process.env.RUN_INTEGRATION!=='1')return t.skip('RUN_INTEGRATION=1 required');
 assert.equal(schema,'memento_dev','destructive fixtures are DEV only');
 const owner=randomUUID(),viewer=randomUUID(),editor=randomUUID(),other=randomUUID();const users=[owner,viewer,editor,other],tokens=new Map();
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 const {hashSession}=await import('../memento-db.mjs');
 const request=async(user,path,method='GET',body,headers={})=>{const res=await fetch(base+'/api'+path,{method,headers:{Origin:base,'Content-Type':'application/json',Cookie:`memento_session=${tokens.get(user)}`,...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,data:await res.json(),headers:res.headers};};
 const draft={trackId:'story-track',title:'Story',opening:'Intro',closing:'End',items:[{itemId:'i1',momentId:'m1',note:'bridge'},{itemId:'i2',momentId:'m2',note:''}]};
 let id;
 try{
  for(const [n,u] of users.entries()){await pool.query(`INSERT INTO ${q}.users(id,username,password_hash) VALUES($1,$2,'unused')`,[u,'story-'+u]);const token=randomUUID();tokens.set(u,token);await pool.query(`INSERT INTO ${q}.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')`,[hashSession(token),u]);}
  await pool.query(`INSERT INTO ${q}.tracks(owner_id,id,document) VALUES($1,'story-track','{"id":"story-track","tags":[]}'),($1,'other-track','{"id":"other-track","tags":[]}')`,[owner]);
  for(const m of ['m1','m2'])await pool.query(`INSERT INTO ${q}.moments(owner_id,id,event_id,document) VALUES($1,$2,'story-track',jsonb_build_object('id',$2::text,'eventId','story-track','title','live source','images','[]'::jsonb))`,[owner,m]);
  for(const [u,role] of [[viewer,'viewer'],[editor,'editor']])await pool.query(`INSERT INTO ${q}.track_collaborators(id,owner_id,track_id,recipient_id,role,invited_at,accepted_at,expires_at) VALUES($1,$2,'story-track',$3,$4,now()-interval '10 days',now()-interval '9 days',now()-interval '2 days')`,[randomUUID(),owner,u,role]);
  const create=(value=draft,key='story-operation-1',user=owner)=>request(user,'/stories','POST',value,{'Idempotency-Key':key});
  for(const text of ['x\u0000y','x\ud800y','x\udc00y']){
   for(const field of ['trackId','title','opening','closing']) assert.equal((await create({...draft,[field]:text},'invalid-text-key')).status,400,field);
   for(const field of ['itemId','momentId','note']) assert.equal((await create({...draft,items:[{...draft.items[0],[field]:text}]},'invalid-text-key')).status,400,field);
   assert.equal((await request(owner,'/stories/query','POST',{trackOwnerId:owner,trackId:text})).status,400);
  }
  const concurrent=await Promise.all([create(),create()]);assert(concurrent.every(r=>r.status===200),JSON.stringify(concurrent));assert.equal(concurrent[0].data.story.id,concurrent[1].data.story.id);
  const created=concurrent[0];assert.equal(created.status,200,JSON.stringify(created.data));id=created.data.story.id;assert.equal(created.data.items[0].moment.title,'live source');assert.equal(created.headers.get('cache-control'),'no-store');
  assert.equal((await create()).data.story.id,id);assert.equal((await create({...draft,title:'different'})).status,409);
  await pool.query(`UPDATE ${q}.moments SET document=document||'{"title":"fresh live edit"}',version=version+1 WHERE owner_id=$1 AND id='m1'`,[owner]);assert.equal((await request(viewer,'/stories/'+id)).data.items[0].moment.title,'fresh live edit');
  await pool.query(`UPDATE ${q}.track_collaborators SET accepted_at=NULL WHERE owner_id=$1 AND recipient_id=$2`,[owner,editor]);assert.equal((await request(editor,'/stories/'+id)).status,404);await pool.query(`UPDATE ${q}.track_collaborators SET accepted_at=now()-interval '9 days' WHERE owner_id=$1 AND recipient_id=$2`,[owner,editor]);
  assert.equal((await create({...draft,items:[{itemId:'x',momentId:'foreign',note:''}]},'story-operation-bad')).status,400);
  assert.equal((await create(draft,'story-viewer-key',viewer)).status,404);
  for(const user of [viewer,editor]){const read=await request(user,'/stories/'+id);assert.equal(read.status,200);assert.equal(read.data.capabilities.canEdit,false);assert.equal((await request(user,'/stories/'+id,'PUT',{...draft,expectedVersion:1})).status,404);}
  assert.equal((await request(other,'/stories/'+id)).status,404);
  assert.equal((await request(owner,'/stories/'+id,'PUT',draft)).status,428);
  const changed=await request(owner,'/stories/'+id,'PUT',{...draft,items:[...draft.items].reverse(),expectedVersion:1});assert.equal(changed.status,200);assert.equal(changed.data.items[0].itemId,'i2');assert.equal(changed.data.story.version,2);
  assert.equal((await request(owner,'/stories/'+id,'PUT',{...draft,expectedVersion:1})).status,409);
  await pool.query(`UPDATE ${q}.moments SET event_id='other-track',document=document||'{"eventId":"other-track","title":"private moved text"}' WHERE owner_id=$1 AND id='m1'`,[owner]);
  let detail=await request(viewer,'/stories/'+id);assert.equal(detail.data.items[1].moment,null);assert(!JSON.stringify(detail.data).includes('private moved text'));assert.equal(detail.data.items[1].note,'bridge');
  await pool.query(`DELETE FROM ${q}.moments WHERE owner_id=$1 AND id='m2'`,[owner]);detail=await request(owner,'/stories/'+id);assert(detail.data.items.every(i=>i.moment===null));
  assert.equal((await request(owner,'/stories/'+id,'PUT',{...draft,expectedVersion:2})).status,200,'stored missing references survive edit');
  // Reads must not wait for the owner mutation lock; current revoke is in the read statement.
  const blocker=await pool.connect();await blocker.query('BEGIN');await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${schema}:owner:${owner}`]);
  try{await pool.query(`UPDATE ${q}.track_collaborators SET revoked_at=now() WHERE owner_id=$1 AND recipient_id=$2`,[owner,viewer]);const read=await Promise.race([request(viewer,'/stories/'+id),new Promise((_,rej)=>setTimeout(()=>rej(new Error('read contended on owner lock')),1500))]);assert.equal(read.status,404);}finally{await blocker.query('ROLLBACK');blocker.release();}
  // Generate > one bounded library page without source data duplication.
  await pool.query(`INSERT INTO ${q}.stories(id,owner_id,track_id,title) SELECT gen_random_uuid(),$1,'story-track','page story' FROM generate_series(1,54)`,[owner]);
  const query=(user,extra={})=>request(user,'/stories/query','POST',{trackOwnerId:owner,trackId:'story-track',limit:20,...extra});
  let cursor=null,seen=new Set();do{const page=await query(owner,{cursor});assert.equal(page.status,200,JSON.stringify(page.data));assert(page.data.stories.length<=20);for(const s of page.data.stories){assert(!seen.has(s.id));seen.add(s.id);}cursor=page.data.nextCursor;}while(cursor);assert.equal(seen.size,55);
  const page=await query(owner);assert.equal((await query(editor,{cursor:page.data.nextCursor})).status,400);assert.equal((await query(owner,{cursor:page.data.nextCursor+'x'})).status,400);assert.equal((await query(owner,{limit:51})).status,400);assert.equal((await query(viewer)).status,404);
  assert.equal((await request(owner,'/stories/'+id,'DELETE',{expectedVersion:3})).status,200);assert.equal((await create()).status,410);
  // Track-cascade tombstones must survive recreation of the same track identity.
  await pool.query(`INSERT INTO ${q}.moments(owner_id,id,event_id,document) VALUES($1,'fresh','story-track','{"id":"fresh","eventId":"story-track"}')`,[owner]);
  const cascadeDraft={...draft,items:[{itemId:'fresh-item',momentId:'fresh',note:''}]};assert.equal((await create(cascadeDraft,'cascade-operation')).status,200);
  const plan=await pool.query(`EXPLAIN (FORMAT JSON) SELECT id FROM ${q}.stories WHERE owner_id=$1 AND track_id='story-track' ORDER BY updated_at DESC,id DESC LIMIT 21`,[owner]);assert(plan.rows.length);t.diagnostic('Indexed bounded library EXPLAIN obtained on disposable fixture');
  await pool.query(`DELETE FROM ${q}.tracks WHERE owner_id=$1 AND id='story-track'`,[owner]);assert.equal((await pool.query(`SELECT count(*)::int n FROM ${q}.stories WHERE owner_id=$1`,[owner])).rows[0].n,0);
  await pool.query(`INSERT INTO ${q}.tracks(owner_id,id,document) VALUES($1,'story-track','{"id":"story-track"}')`,[owner]);assert.equal((await create(cascadeDraft,'cascade-operation')).status,410);
 }finally{await pool.query(`DELETE FROM ${q}.users WHERE id=ANY($1::uuid[])`,[users]);await new Promise(r=>server.close(r));await pool.end();}
});
