import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool,qschema as q,schema,hashSession} from '../memento-db.mjs';
import {app} from '../server.mjs';
import {readExportSnapshot} from '../export-snapshot.mjs';
import {queryStories} from '../story-queries.mjs';
test('DEV letters: private lifecycle, DB time, replay hashes/tombstones, export consent and bounded reads',async t=>{
 if(process.env.RUN_INTEGRATION!=='1')return t.skip('RUN_INTEGRATION=1 required');assert.equal(schema,'memento_dev');
 const users=[randomUUID(),randomUUID()],tokens=new Map(),owner=users[0],other=users[1];
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 const request=async(u,path,method='GET',body,headers={})=>{const res=await fetch(base+'/api/future-letters'+path,{method,headers:{Origin:base,'Content-Type':'application/json',Cookie:`memento_session=${tokens.get(u)}`,...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,data:await res.json(),headers:res.headers};};
 const backup=(u,input={})=>readExportSnapshot(pool,u,input,q,{safeMoment:()=>({})});
 const draft={title:'Envelope',body:'SECRET LETTER TEXT',photos:[]};
 const create=(key='letter-create-1',value=draft)=>request(owner,'','POST',value,{'Idempotency-Key':key});
 try{
  for(const u of users){await pool.query(`INSERT INTO ${q}.users(id,username,password_hash) VALUES($1,$2,'unused')`,[u,'letter-'+u]);const token=randomUUID();tokens.set(u,token);await pool.query(`INSERT INTO ${q}.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')`,[hashSession(token),u]);}
  assert.equal((await request(randomUUID(),'/summary')).status,401);
  assert.equal((await request(randomUUID(),'/query','POST',{})).status,401);
  assert.equal((await request(owner,'/summary')).data.readyCount,0);
  const pair=await Promise.all([create(),create()]);assert(pair.every(v=>v.status===200),JSON.stringify(pair));const id=pair[0].data.letter.id;assert.equal(pair[1].data.letter.id,id);
  assert.equal((await create('letter-create-1',{...draft,body:'different'})).status,409);
  assert.equal((await request(other,'/'+id)).status,404);assert.equal((await request(other,'/'+randomUUID())).status,404);
  assert.equal((await request(owner,'/'+id,'PUT',draft)).status,428);
  assert.equal((await request(owner,'/'+id,'PUT',{...draft,expectedVersion:1})).status,200);
  assert.equal((await request(owner,'/'+id,'PUT',{...draft,expectedVersion:1})).status,409);
  const schedule={releaseAt:'2090-01-01T00:00:00.000Z',timezone:'UTC',localTime:'2090-01-01T00:00',offsetMinutes:0,expectedVersion:2,operationId:'letter-seal-1'};
  // Reject offset-only zones at actual authenticated draft and seal boundaries, without mutation.
  for(const timezone of ['+01:00','+0100','+01','-05:00','+00:00']){
   const offset=timezone==='-05:00'?-300:timezone==='+00:00'?0:60;
   const localTime=offset===-300?'2089-12-31T19:00':offset===0?'2090-01-01T00:00':'2090-01-01T01:00';
   const invalid={...schedule,timezone,localTime,offsetMinutes:offset};
   assert.equal((await request(owner,'/'+id+'/seal','POST',invalid)).status,400);
   const {operationId,expectedVersion,...fields}=invalid;
   assert.equal((await create('invalid-zone-'+timezone,{...draft,...fields})).status,400);
  }
  assert.equal((await request(owner,'/'+id+'/seal','POST',{...schedule,offsetMinutes:60})).status,400);
  assert.equal((await request(owner,'/'+id)).data.letter.version,2);
  // A real story page on a legal colliding track name must not be letter navigation.
  const collision='future-letters-v1:null';
  await pool.query(`INSERT INTO ${q}.tracks(owner_id,id,document) VALUES($1,$2,$3)`,[owner,collision,JSON.stringify({id:collision})]);
  await pool.query(`INSERT INTO ${q}.stories(id,owner_id,track_id,title) SELECT gen_random_uuid(),$1,$2,'cursor collision' FROM generate_series(1,2)`,[owner,collision]);
  const storyPage=await queryStories(pool,owner,{trackOwnerId:owner,trackId:collision,limit:1},q);
  assert(storyPage.nextCursor);
  assert.equal((await request(owner,'/query','POST',{cursor:storyPage.nextCursor})).status,400);
  const sealed=await request(owner,'/'+id+'/seal','POST',schedule);assert.equal(sealed.status,200,JSON.stringify(sealed));assert.equal(sealed.data.letter.state,'sealed');assert(!('body' in sealed.data.letter));assert(!('photos' in sealed.data.letter));
  assert.equal((await request(owner,'/'+id+'/seal','POST',schedule)).status,200);
  assert.equal((await request(owner,'/'+id+'/seal','POST',{...schedule,releaseAt:'2091-01-01T00:00:00.000Z',localTime:'2091-01-01T00:00'})).status,409);
  assert.equal((await request(owner,'/'+id,'PUT',{...draft,expectedVersion:3})).status,409);
  assert.equal((await request(owner,'/'+id+'/open','POST',{operationId:'letter-open-1'})).status,409);
  assert.equal((await request(owner,'/'+id)).headers.get('cache-control'),'no-store');
  const library=await request(owner,'/query','POST',{});assert(!JSON.stringify(library.data).includes(draft.body));assert(!JSON.stringify(library.data).includes('photos'));
  await assert.rejects(backup(owner),e=>e.status===400&&e.details.code==='SEALED_LETTERS_CONSENT_REQUIRED');
  const start=await backup(owner,{includeSealedLetters:true});assert.equal(start.counts.futureLetters,1);
  const noConsent=await backup(other);
  await assert.rejects(backup(other,{action:'page',kind:'futureLetters',fingerprint:noConsent.fingerprint,token:noConsent.token,includeSealedLetters:true}),e=>e.status===400);
  const pageInput={action:'page',kind:'futureLetters',fingerprint:start.fingerprint,token:start.token,includeSealedLetters:true};
  assert.equal((await backup(owner,pageInput)).items[0].body,draft.body);
  await assert.rejects(backup(owner,{...pageInput,includeSealedLetters:false}),e=>e.status===400);
  await assert.rejects(backup(other,pageInput),e=>e.status===400);
  assert.equal((await request(owner,'/'+id)).data.letter.state,'sealed','export never opens');
  // Real release boundary fixtures: inject elapsed DB timestamps, never host clock.
  const due=randomUUID();await pool.query(`INSERT INTO ${q}.future_letters(id,owner_id,title,body,sealed_at,release_at,timezone) VALUES($1,$2,'due','due body',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour','UTC')`,[due,owner]);
  assert.equal((await request(owner,'/summary')).data.readyCount,1);
  assert(!('body' in (await request(owner,'/'+due)).data.letter));
  const opened=await Promise.all([request(owner,'/'+due+'/open','POST',{operationId:'letter-open-due'}),request(owner,'/'+due+'/open','POST',{operationId:'letter-open-due'})]);assert(opened.every(v=>v.status===200));assert.equal(opened[0].data.letter.openedAt,opened[1].data.letter.openedAt);
  const first=opened[0].data.letter;assert.equal(first.body,'due body');assert.equal((await request(owner,'/'+due+'/open','POST',{operationId:'letter-open-other'})).data.letter.openedAt,first.openedAt);
  await assert.rejects(backup(owner,pageInput),e=>e.status===409);
  const snapshot=await backup(owner,{includeSealedLetters:true});const bound={action:'page',fingerprint:snapshot.fingerprint,token:snapshot.token,includeSealedLetters:true};
  await pool.query(`UPDATE ${q}.future_letters SET body='changed' WHERE owner_id=$1 AND sealed_at IS NULL`,[owner]);
  await pool.query(`INSERT INTO ${q}.future_letters(id,owner_id,title,body) VALUES($1,$2,'draft export','before')`,[randomUUID(),owner]);
  await assert.rejects(backup(owner,bound),e=>e.status===409);
  // Live owned references only; missing sources remain sanitized after opening.
  await pool.query(`INSERT INTO ${q}.tracks(owner_id,id,document) VALUES($1,'photo-track','{"id":"photo-track"}')`,[owner]);
  await pool.query(`INSERT INTO ${q}.moments(owner_id,id,event_id,document) VALUES($1,'photo-m','photo-track','{"id":"photo-m","eventId":"photo-track"}')`,[owner]);
  const image=randomUUID();await pool.query(`INSERT INTO ${q}.images(id,owner_id,moment_id,object_key,content_type,size) VALUES($1,$2,'photo-m',$3,'image/jpeg',10)`,[image,owner,'memento_dev/test-letter-'+image]);
  const photoDraft={...draft,photos:[{momentId:'photo-m',imageId:image}]};
  assert.equal((await create('letter-foreign-photo',{...draft,photos:[{momentId:'photo-m',imageId:randomUUID()}]})).status,400);
  const photoCreated=await create('letter-photo-create',photoDraft);assert.equal(photoCreated.status,200);const photoId=photoCreated.data.letter.id;assert.equal(photoCreated.data.letter.photos[0].available,true);
  assert.equal((await request(other,'','POST',photoDraft,{'Idempotency-Key':'foreign-owner-photo'})).status,400);
  const photoSeal={...schedule,expectedVersion:1,operationId:'photo-seal-operation'};
  const racing=await Promise.all([request(owner,'/'+photoId+'/seal','POST',photoSeal),request(owner,'/'+photoId,'PUT',{...photoDraft,title:'concurrent edit',expectedVersion:1})]);assert.deepEqual(racing.map(r=>r.status).sort(),[200,409]);
  // Delete a sealed letter with real attached metadata: guard must permit cascade.
  const photoCurrent=(await request(owner,'/'+photoId)).data.letter;
  assert.equal((await request(owner,'/'+photoId,'DELETE',{expectedVersion:photoCurrent.version})).status,200);
  assert.equal((await create('letter-photo-create',photoDraft)).status,410);
  const liveId=randomUUID();await pool.query(`INSERT INTO ${q}.future_letters(id,owner_id,title,body) VALUES($1,$2,'live photo','photo body')`,[liveId,owner]);
  await pool.query(`INSERT INTO ${q}.future_letter_photos(letter_id,owner_id,position,moment_id,image_id) VALUES($1,$2,0,'photo-m',$3)`,[liveId,owner,image]);
  await pool.query(`UPDATE ${q}.future_letters SET sealed_at=clock_timestamp()-interval '2 hours',release_at=clock_timestamp()-interval '1 hour',timezone='UTC' WHERE id=$1`,[liveId]);
  const photoSnapshot=await backup(owner,{includeSealedLetters:true});
  // Export fingerprints cover exact photo identities and live availability, not only letter counts.
  await pool.query(`DELETE FROM ${q}.images WHERE id=$1`,[image]);
  await assert.rejects(backup(owner,{action:'page',fingerprint:photoSnapshot.fingerprint,token:photoSnapshot.token,includeSealedLetters:true}),e=>e.status===409);
  const liveOpened=await request(owner,'/'+liveId+'/open','POST',{operationId:'live-photo-open'});assert.equal(liveOpened.status,200);assert.deepEqual(liveOpened.data.letter.photos,[{momentId:'photo-m',imageId:image,available:false}]);
  // Direct database writes cannot mutate a sealed body or schedule.
  await assert.rejects(pool.query(`UPDATE ${q}.future_letters SET body='forbidden' WHERE id=$1`,[liveId]),/immutable/);
  // Same-count body edits / ABA are rejected on each page before reverting.
  const aba=await backup(owner,{includeSealedLetters:true});const abaPage={action:'page',fingerprint:aba.fingerprint,token:aba.token,includeSealedLetters:true};
  await pool.query(`UPDATE ${q}.future_letters SET body='transient' WHERE owner_id=$1 AND title='draft export'`,[owner]);await assert.rejects(backup(owner,abaPage),e=>e.status===409);
  await pool.query(`UPDATE ${q}.future_letters SET body='before' WHERE owner_id=$1 AND title='draft export'`,[owner]);assert.equal((await backup(owner,{...abaPage,action:'finalize'})).complete,true);
  const replace=await backup(owner,{includeSealedLetters:true});await pool.query(`UPDATE ${q}.future_letters SET id=gen_random_uuid() WHERE owner_id=$1 AND title='draft export'`,[owner]);await assert.rejects(backup(owner,{action:'finalize',fingerprint:replace.fingerprint,token:replace.token,includeSealedLetters:true}),e=>e.status===409);
  // > one page and microsecond keyset ties.
  await pool.query(`INSERT INTO ${q}.future_letters(id,owner_id,title,body,updated_at) SELECT gen_random_uuid(),$1,'paged','private',clock_timestamp()+n*interval '1 microsecond' FROM generate_series(1,51) n`,[owner]);
  let cursor=null;const seen=new Set();do{const r=await request(owner,'/query','POST',{limit:20,cursor});assert.equal(r.status,200);assert(r.data.letters.length<=20);for(const l of r.data.letters){assert(!seen.has(l.id));seen.add(l.id);assert(!('body' in l));}cursor=r.data.nextCursor;if(cursor){assert.equal((await request(other,'/query','POST',{cursor})).status,400);assert.equal((await request(owner,'/query','POST',{state:'draft',cursor})).status,400);}}while(cursor);assert.equal(seen.size,55);
  const exportNow=await backup(owner,{includeSealedLetters:true});
  const exportPage={action:'page',kind:'futureLetters',limit:1,fingerprint:exportNow.fingerprint,token:exportNow.token,includeSealedLetters:true};
  const cursorPage=await backup(owner,exportPage);assert(cursorPage.nextCursor);
  await assert.rejects(backup(owner,{...exportPage,cursor:cursorPage.nextCursor+'x'}),e=>e.status===400);
  await assert.rejects(backup(owner,{...exportPage,cursor:cursorPage.nextCursor,includeSealedLetters:false}),e=>e.status===400);
  assert.equal((await request(owner,'/'+id,'DELETE',{expectedVersion:3})).status,200);assert.equal((await create()).status,410);assert.equal((await request(owner,'/'+id+'/seal','POST',schedule)).status,410);
  assert.equal((await request(owner,'/'+due,'DELETE',{expectedVersion:first.version})).status,200);assert.equal((await request(owner,'/'+due+'/open','POST',{operationId:'letter-open-due'})).status,410);
  const plan=await pool.query(`EXPLAIN (FORMAT JSON) SELECT id FROM ${q}.future_letters WHERE owner_id=$1 ORDER BY updated_at DESC,id DESC LIMIT 21`,[owner]);assert(plan.rows.length);
 }finally{await pool.query(`DELETE FROM ${q}.users WHERE id=ANY($1::uuid[])`,[users]);await new Promise(r=>server.close(r));await pool.end();}
});
