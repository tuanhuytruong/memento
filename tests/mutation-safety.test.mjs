import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { app, s3, cleanup } from '../server.mjs';
import { pool, qschema, hashSession } from '../memento-db.mjs';
import { cleanupQueue } from '../object-cleanup.mjs';
import { transaction } from '../mutation-safety.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const bounded=p=>Promise.race([p,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Deterministic barrier timeout')),10000);timer.unref();})]);

test('Phase A PostgreSQL races, dependency failures and durable storage fault recovery', {timeout:120000}, async t=>{
 if(process.env.RUN_INTEGRATION!=='1')return t.skip('RUN_INTEGRATION=1 required');
 if(process.env.DB_SCHEMA!=='memento_dev')return t.skip('Fault-injected destructive concurrency suite is DEV-only');
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const owner=crypto.randomUUID(),editor=crypto.randomUUID(),viewer=crypto.randomUUID();
 const tokens=new Map([[owner,crypto.randomUUID()],[editor,crypto.randomUUID()],[viewer,crypto.randomUUID()]]);
 const rawQuery=pool.query.bind(pool), rawConnect=pool.connect.bind(pool), rawSend=s3.send.bind(s3);
 const ownedJobs=[];const enqueue=cleanup.enqueue;cleanup.enqueue=async(...args)=>{const id=await enqueue(...args);if(id)ownedJobs.push(id);return id;};
 const imageBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNgZGJmZGJmgFAAAK4AGRLRbNUAAAAASUVORK5CYII=','base64');
 const prefix=`memento_dev/safety-${crypto.randomUUID()}/`;
 let track,privateTrack,moment;
 const req=async(path,{method='GET',as=owner,body,multipart,headers={}}={})=>{
  const h={Origin:base,Cookie:`memento_session=${tokens.get(as)}`,'X-Forwarded-For':'192.0.2.81',...headers};
  if(body){h['Content-Type']='application/json';body=JSON.stringify(body);}
  const res=await fetch(base+path,{method,headers:h,body:multipart||body,signal:AbortSignal.timeout(15000)});
  return {status:res.status,data:await res.json()};
 };
 const sql=(q,args)=>rawQuery(q,args);
 const fresh=async()=> (await req('/api/moments')).data.moments.find(x=>x.id===moment);
 const makeMoment=async()=>{const r=await req('/api/moments',{method:'POST',body:{eventId:track,title:'original',description:'retained',date:'2026-10-16',tags:['remove','keep'],images:[]}});assert.equal(r.status,201);moment=r.data.moment.id;return r.data.moment;};
 const invite=async(role='editor',user=editor)=>{
  const recipient=await sql(`SELECT username FROM ${qschema}.users WHERE id=$1`,[user]);
  const r=await req(`/api/tracks/${track}/collaborators`,{method:'POST',body:{username:recipient.rows[0].username,role}});assert.equal(r.status,201);
  assert.equal((await req(`/api/collaboration-invitations/${r.data.collaborator.id}/accept`,{method:'POST',as:user})).status,200);
 };
 // Pause the first access probe after it has really read PostgreSQL; resume only after an owner commits.
 const staleProbe=async(operation,ownerChange)=>{
  const reached=deferred(),resume=deferred();let paused=false;
  pool.query=async(...args)=>{
   const result=await rawQuery(...args);
   if(!paused && typeof args[0]==='string' && args[0].includes("'owner'::text AS role") && args[1]?.[0]===editor){paused=true;reached.resolve();await resume.promise;}
   return result;
  };
  const running=operation();
  try{await bounded(reached.promise);await ownerChange();}finally{resume.resolve();pool.query=rawQuery;}
  return running;
 };
 try {
  for(const uid of tokens.keys()){
   await sql(`INSERT INTO ${qschema}.users(id,username,password_hash) VALUES($1,$2,'unused')`,[uid,`safe_${uid.replaceAll('-','').slice(0,20)}`]);
   await sql(`INSERT INTO ${qschema}.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')`,[hashSession(tokens.get(uid)),uid]);
  }
  track=(await req('/api/tracks',{method:'POST',body:{title:'shared',tags:['remove']}})).data.track.id;
  privateTrack=(await req('/api/tracks',{method:'POST',body:{title:'private',tags:[]}})).data.track.id;
  await makeMoment();await invite();await invite('viewer',viewer);

  await t.test('guarded acquisition rejects with bounded 503 and liveness survives',async()=>{
   pool.connect=async()=>{throw Object.assign(new Error('Injected refusal'),{code:'ECONNREFUSED'});};
   try{
    const reg=await req('/api/auth/register',{method:'POST',body:{username:'fault_test',password:'long-test-password',inviteCode:'invalid'}});assert.equal(reg.status,503);
    assert.equal((await fetch(base+'/health')).status,200);
   }finally{pool.connect=rawConnect;}
   assert.equal((await req('/api/auth/me')).status,200);
   // Fail acquisition only after auth/probe use pool.query; domain helper cannot leak a rejection.
   const c=await rawConnect();const clientQuery=c.query.bind(c);let released=false;
   c.query=async(...args)=>{if(args[0]==='BEGIN')throw Object.assign(new Error('Injected begin failure'),{code:'ECONNRESET'});return clientQuery(...args);};
   const release=c.release.bind(c);c.release=()=>{released=true;c.query=clientQuery;c.release=release;release();};
   const fake={connect:async()=>c};await assert.rejects(transaction(fake,()=>{},owner,'memento_dev'),{code:'ECONNRESET'});assert.equal(released,true);
  });

  await t.test('accepted expiry persists; pending expiry cannot accept; viewer cannot edit',async()=>{
   await sql(`UPDATE ${qschema}.track_collaborators SET invited_at=now()-interval '8 days',expires_at=now()-interval '1 day' WHERE owner_id=$1`,[owner]);
   assert.equal((await req('/api/tracks',{as:editor})).data.tracks.length,1);
   assert.equal((await req(`/api/moments/${moment}`,{method:'PUT',as:viewer,body:{title:'bad',expectedVersion:1}})).status,403);
   const r=await req(`/api/tracks/${track}/collaborators`,{method:'POST',body:{username:(await sql(`SELECT username FROM ${qschema}.users WHERE id=$1`,[viewer])).rows[0].username,role:'viewer'}});
   await sql(`UPDATE ${qschema}.track_collaborators SET invited_at=now()-interval '8 days',expires_at=now()-interval '1 day' WHERE id=$1`,[r.data.collaborator.id]);
   assert.equal((await req(`/api/collaboration-invitations/${r.data.collaborator.id}/accept`,{method:'POST',as:viewer})).status,404);
  });

  await t.test('two full edits from same version: one 200, one explicit 409',async()=>{
   const m=await fresh();
   const r=await Promise.all([req(`/api/moments/${moment}`,{method:'PUT',body:{title:'winner title',expectedVersion:m.version}}),req(`/api/moments/${moment}`,{method:'PUT',body:{description:'winner description',expectedVersion:m.version}})]);
   assert.deepEqual(r.map(x=>x.status).sort(),[200,409]);assert.equal(r.find(x=>x.status===409).data.code,'VERSION_CONFLICT');
   assert.equal((await req(`/api/moments/${moment}`,{method:'PUT',body:{title:'missing version'}})).status,428);
   const current=await fresh();assert.equal(current.version,m.version+1);
   assert.equal((await req(`/api/moments/${moment}`,{method:'PUT',headers:{'If-Match':`"${current.version}"`},body:{title:'if-match'}})).status,200);
  });

  await t.test('atomic tag deletion bumps version without changing content or owner track as editor',async()=>{
   const before=await fresh();
   assert.equal((await req(`/api/tags/remove?trackId=${track}`,{method:'DELETE',as:editor})).status,200);
   const after=await fresh();assert.deepEqual(after.tags,['keep']);assert.equal(after.title,before.title);assert.equal(after.description,before.description);assert.equal(after.version,before.version+1);
   const doc=await sql(`SELECT document FROM ${qschema}.tracks WHERE owner_id=$1 AND id=$2`,[owner,track]);assert.deepEqual(doc.rows[0].document.tags,['remove']);
   assert.equal((await req(`/api/moments/${moment}`,{method:'PUT',body:{...before,expectedVersion:before.version}})).status,409);
   const current=await fresh();
   const results=await Promise.all([req('/api/tags/keep',{method:'DELETE'}),req(`/api/moments/${moment}`,{method:'PUT',body:{description:'race',expectedVersion:current.version}})]);
   assert.equal(results[0].status,200);assert.ok([200,409].includes(results[1].status));assert.deepEqual((await fresh()).tags,[]);
  });

  await t.test('idempotent desired reaction races and revoked authorization',async()=>{
   const r=await Promise.all(Array.from({length:5},()=>req(`/api/moments/${moment}/reactions`,{method:'PUT',as:editor,body:{emoji:'❤️',active:true}})));
   assert.ok(r.every(x=>x.status===200));assert.equal((await sql(`SELECT 1 FROM ${qschema}.moment_reactions WHERE moment_owner_id=$1 AND moment_id=$2`,[owner,moment])).rowCount,1);
   for(let i=0;i<2;i++)assert.deepEqual((await req(`/api/moments/${moment}/reactions`,{method:'PUT',as:editor,body:{emoji:'❤️',active:false}})).data.reactions,[]);
   assert.equal((await req(`/api/moments/${moment}/reactions`,{method:'PUT',body:{emoji:'❤️',active:'yes'}})).status,400);
  });

  await t.test('stale editor edit/delete cannot follow owner move',async()=>{
   for(const method of ['PUT','DELETE']){
    const before=await fresh();
    const result=await staleProbe(()=>req(`/api/moments/${moment}`,{method,as:editor,body:method==='PUT'?{title:'intrusion',expectedVersion:before.version}:undefined}),async()=>{
     const moved=await req(`/api/moments/${moment}`,{method:'PUT',body:{eventId:privateTrack,expectedVersion:before.version}});assert.equal(moved.status,200);
    });assert.equal(result.status,404);assert.notEqual((await fresh()).title,'intrusion');
    const current=await fresh();assert.equal((await req(`/api/moments/${moment}`,{method:'PUT',body:{eventId:track,expectedVersion:current.version}})).status,200);
   }
  });

  await t.test('stale edit/delete/image-delete cannot commit after revoke',async()=>{
   const imageId=crypto.randomUUID();await sql(`INSERT INTO ${qschema}.images(id,owner_id,moment_id,object_key,content_type,size) VALUES($1,$2,$3,$4,'image/png',1)`,[imageId,owner,moment,`${prefix}revoke`]);
   for(const path of [`/api/moments/${moment}`,`/api/moments/${moment}`,`/api/images/${imageId}`]){
    await invite();const before=await fresh();const method=path.includes('images')?'DELETE':(path===`/api/moments/${moment}`&&before.title!=='revoke-marker'?'PUT':'DELETE');
    const result=await staleProbe(()=>req(path,{method,as:editor,body:method==='PUT'?{title:'intrusion',expectedVersion:before.version}:undefined}),async()=>{assert.equal((await req(`/api/tracks/${track}/collaborators/${editor}`,{method:'DELETE'})).status,200);});
    assert.equal(result.status,404);
    await req(`/api/moments/${moment}`,{method:'PUT',body:{title:'revoke-marker',expectedVersion:(await fresh()).version}});
   }
   assert.equal((await sql(`SELECT 1 FROM ${qschema}.images WHERE id=$1`,[imageId])).rowCount,1);await invite();
  });

  await t.test('staged upload rechecks revoke and durable manifest survives storage failure',async()=>{
   const started=deferred(),resume=deferred();let first=true;const deleted=[];
   s3.send=async command=>{if(command.constructor.name==='PutObjectCommand'&&first){first=false;started.resolve();await resume.promise;}return {};};
   const form=new FormData();form.set('momentId',moment);form.set('file',new Blob([imageBytes],{type:'image/png'}),'x.png');
   const pending=req('/api/images',{method:'POST',as:editor,multipart:form});
   try{await bounded(started.promise);assert.equal((await req(`/api/tracks/${track}/collaborators/${editor}`,{method:'DELETE'})).status,200);}finally{resume.resolve();}
   assert.equal((await pending).status,404);
   const jobs=await sql(`SELECT id,object_keys FROM ${qschema}.object_cleanup_jobs WHERE id=ANY($1::uuid[])`,[ownedJobs]);
   assert.ok(jobs.rows.length>=1);
   // Fake delete: first fails, then replay removes manifest. No real R2 receives fake keys.
   const fake=cleanupQueue({pool,qschema,prefix:'memento_dev/',remove:async key=>{deleted.push(key);throw new Error('storage offline');}});
   const firstDrain=await fake.drain({limit:100,ids:ownedJobs});assert.ok(firstDrain.failed>=1);
   const recovered=cleanupQueue({pool,qschema,prefix:'memento_dev/',remove:async key=>{deleted.push(key);}});
   assert.ok((await recovered.drain({limit:100,retry:true,ids:ownedJobs})).completed>=1);s3.send=rawSend;
  });

  await t.test('staged editor upload cannot follow membership move',async()=>{
   await invite();const before=await fresh(),started=deferred(),resume=deferred();let first=true;
   s3.send=async command=>{if(command.constructor.name==='PutObjectCommand'&&first){first=false;started.resolve();await resume.promise;}return {};};
   const form=new FormData();form.set('momentId',moment);form.set('file',new Blob([imageBytes],{type:'image/png'}),'move.png');
   const pending=req('/api/images',{method:'POST',as:editor,multipart:form});
   try{await bounded(started.promise);assert.equal((await req(`/api/moments/${moment}`,{method:'PUT',body:{eventId:privateTrack,expectedVersion:before.version}})).status,200);}finally{resume.resolve();}
   assert.equal((await pending).status,404);
   assert.equal((await sql(`SELECT count(*)::int n FROM ${qschema}.images WHERE owner_id=$1 AND moment_id=$2`,[owner,moment])).rows[0].n,1);
   const current=await fresh();assert.equal((await req(`/api/moments/${moment}`,{method:'PUT',body:{eventId:track,expectedVersion:current.version}})).status,200);
   const queue=cleanupQueue({pool,qschema,prefix:'memento_dev/',remove:async()=>{}});await queue.drain({limit:100,retry:true,ids:ownedJobs});s3.send=rawSend;
  });

  await t.test('stale image delete cannot follow membership move',async()=>{
   const image=(await sql(`SELECT id FROM ${qschema}.images WHERE owner_id=$1 AND moment_id=$2 LIMIT 1`,[owner,moment])).rows[0];
   const before=await fresh();
   const result=await staleProbe(()=>req(`/api/images/${image.id}`,{method:'DELETE',as:editor}),async()=>{assert.equal((await req(`/api/moments/${moment}`,{method:'PUT',body:{eventId:privateTrack,expectedVersion:before.version}})).status,200);});
   assert.equal(result.status,404);assert.equal((await sql(`SELECT 1 FROM ${qschema}.images WHERE id=$1`,[image.id])).rowCount,1);
   const current=await fresh();assert.equal((await req(`/api/moments/${moment}`,{method:'PUT',body:{eventId:track,expectedVersion:current.version}})).status,200);
  });

  await t.test('upload replay is authorized, payload-bound, single metadata insert',async()=>{
   s3.send=async()=>({});await invite();const key=crypto.randomUUID();
   const upload=async(bytes=imageBytes)=>{const form=new FormData();form.set('momentId',moment);form.set('file',new Blob([Buffer.from(bytes)],{type:'image/png'}),'x.png');return req('/api/images',{method:'POST',as:editor,multipart:form,headers:{'Idempotency-Key':key}});};
   const results=await Promise.all([upload(),upload()]);assert.deepEqual(results.map(x=>x.status).sort(),[200,201]);assert.equal(results[0].data.image.id,results[1].data.image.id);
   assert.equal((await upload(Buffer.concat([imageBytes,Buffer.from('different')]))).status,409);
   assert.equal((await sql(`SELECT 1 FROM ${qschema}.images WHERE uploader_id=$1 AND upload_key=$2`,[editor,key])).rowCount,1);
   assert.equal((await req(`/api/tracks/${track}/collaborators/${editor}`,{method:'DELETE'})).status,200);assert.equal((await upload()).status,404);
   // Different owners may use the same moment ID. A replay cannot cross that identity.
   const otherTrack=(await req('/api/tracks',{method:'POST',as:viewer,body:{title:'other-owner-replay'}})).data.track.id;
   await sql(`INSERT INTO ${qschema}.moments(owner_id,id,event_id,document) SELECT $1,id,$2,jsonb_set(document,'{eventId}',to_jsonb($2::text)) FROM ${qschema}.moments WHERE owner_id=$3 AND id=$4`,[viewer,otherTrack,owner,moment]);
   const recipient=(await sql(`SELECT username FROM ${qschema}.users WHERE id=$1`,[editor])).rows[0].username;
   const invitation=await req(`/api/tracks/${otherTrack}/collaborators`,{method:'POST',as:viewer,body:{username:recipient,role:'editor'}});
   assert.equal(invitation.status,201);assert.equal((await req(`/api/collaboration-invitations/${invitation.data.collaborator.id}/accept`,{method:'POST',as:editor})).status,200);
   let storageCalls=0;s3.send=async()=>{storageCalls++;return {};};
   const crossed=await upload();assert.equal(crossed.status,409);assert.equal(crossed.data.image,undefined);assert.equal(storageCalls,0);
   assert.equal((await sql(`SELECT 1 FROM ${qschema}.images WHERE owner_id=$1 AND moment_id=$2`,[viewer,moment])).rowCount,0);
   assert.equal((await req(`/api/tracks/${otherTrack}`,{method:'DELETE',as:viewer})).status,200);

   const queue=cleanupQueue({pool,qschema,prefix:'memento_dev/',remove:async()=>{}});await queue.drain({limit:100,retry:true,ids:ownedJobs});s3.send=rawSend;
  });

  await t.test('owner advisory lock really blocks writes; move before track delete preserves all objects',async()=>{
   const c=await rawConnect();await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`memento_dev:owner:${owner}`]);
   const before=await fresh();let finished=false;
   const moving=req(`/api/moments/${moment}`,{method:'PUT',body:{eventId:privateTrack,expectedVersion:before.version}}).then(x=>{finished=true;return x;});
   let waiting=false;
   try{
    for(let i=0;i<100;i++){const r=await sql(`SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE NOT l.granted AND l.locktype='advisory' AND a.query LIKE '%pg_advisory_xact_lock%'`);if(r.rowCount){waiting=true;break;}await new Promise(r=>setTimeout(r,10));}
    assert.equal(waiting,true);assert.equal(finished,false);await c.query('COMMIT');
   }finally{await c.query('ROLLBACK');c.release();}
   assert.equal((await moving).status,200);
   const preserved=(await sql(`SELECT object_key,thumb_object_key,display_object_key FROM ${qschema}.images WHERE owner_id=$1 AND moment_id=$2`,[owner,moment])).rows;
   assert.ok(preserved.length>=1);assert.equal((await req(`/api/tracks/${track}`,{method:'DELETE'})).status,200);
   const keys=preserved.flatMap(x=>Object.values(x)).filter(Boolean);
   const queue=(await sql(`SELECT object_keys FROM ${qschema}.object_cleanup_jobs`)).rows.flatMap(x=>x.object_keys);
   assert.ok(keys.every(key=>!queue.includes(key)));assert.ok(await fresh());
   assert.equal((await req(`/api/tracks/${privateTrack}`,{method:'DELETE'})).status,200);assert.equal(await fresh(),undefined);
   const after=(await sql(`SELECT object_keys FROM ${qschema}.object_cleanup_jobs`)).rows.flatMap(x=>x.object_keys);assert.ok(keys.every(key=>after.includes(key)));
  });

  await t.test('track deletion wins queued membership move: no survivor references deleted objects',async()=>{
   const source=(await req('/api/tracks',{method:'POST',body:{title:'delete-wins'}})).data.track.id;
   const target=(await req('/api/tracks',{method:'POST',body:{title:'target'}})).data.track.id;
   const m=(await req('/api/moments',{method:'POST',body:{eventId:source,date:'2026-10-16',images:[],tags:[]}})).data.moment;
   const key=`${prefix}delete-wins`;
   await sql(`INSERT INTO ${qschema}.images(id,owner_id,moment_id,object_key,content_type,size) VALUES($1,$2,$3,$4,'image/png',1)`,[crypto.randomUUID(),owner,m.id,key]);
   const locked=deferred(),resume=deferred();let interception=true;
   pool.connect=(...args)=>{
    if(typeof args[0]==='function')return rawConnect(...args);
    return rawConnect(...args).then(c=>{const query=c.query.bind(c),release=c.release.bind(c);
    c.query=async(...params)=>{
     const result=await query(...params);
     if(interception&&params[0]?.includes('pg_advisory_xact_lock')){interception=false;locked.resolve();await resume.promise;}
     return result;
    };
    c.release=()=>{c.query=query;c.release=release;release();};return c;});
   };
   const deleting=req(`/api/tracks/${source}`,{method:'DELETE'});
   let moving;
   try{await bounded(locked.promise);moving=req(`/api/moments/${m.id}`,{method:'PUT',body:{eventId:target,expectedVersion:m.version}});}finally{resume.resolve();pool.connect=rawConnect;}
   assert.equal((await deleting).status,200);assert.equal((await moving).status,404);
   assert.equal((await sql(`SELECT 1 FROM ${qschema}.moments WHERE owner_id=$1 AND id=$2`,[owner,m.id])).rowCount,0);
   assert.equal((await sql(`SELECT 1 FROM ${qschema}.object_cleanup_jobs WHERE object_keys ? $1`,[key])).rowCount,1);
  });

  await t.test('partial cleanup retries whole manifest; live references and namespace are protected',async()=>{
   track=(await req('/api/tracks',{method:'POST',body:{title:'live-cleanup-protection'}})).data.track.id;await makeMoment();
   const keys=[`${prefix}one`,`${prefix}two`,`${prefix}three`],seen=[];
   const job=await cleanup.enqueue(pool,keys);let failure=true;
   const queue=cleanupQueue({pool,qschema,prefix:'memento_dev/',remove:async key=>{seen.push(key);if(key===keys[1]&&failure)throw new Error('partial storage failure');}});
   assert.deepEqual(await queue.drain({ids:[job]}),{claimed:1,completed:0,failed:1});assert.deepEqual(seen,keys.slice(0,2));
   failure=false;assert.deepEqual(await queue.drain({ids:[job],retry:true}),{claimed:1,completed:1,failed:0});assert.deepEqual(seen,[...keys.slice(0,2),...keys]);
   await assert.rejects(cleanup.enqueue(pool,['memento/private']),/namespace/);
   const key=`${prefix}live-veto`;await sql(`INSERT INTO ${qschema}.images(id,owner_id,moment_id,object_key,content_type,size) VALUES($1,$2,$3,$4,'image/png',1)`,[crypto.randomUUID(),owner,moment,key]);
   const liveJob=await cleanup.enqueue(pool,[key]);const n=seen.length;
   assert.equal((await queue.drain({ids:[liveJob]})).failed,1);assert.equal(seen.length,n);
   await sql(`DELETE FROM ${qschema}.object_cleanup_jobs WHERE id=$1`,[liveJob]);
   const stage=await cleanup.enqueue(pool,[`${prefix}expired-stage`],{staged:true});
   assert.equal((await queue.drain({ids:[stage],retry:true})).claimed,0);
   await sql(`UPDATE ${qschema}.object_cleanup_jobs SET next_attempt_at=now()-interval '1 second' WHERE id=$1`,[stage]);
   await assert.rejects(transaction(pool,c=>cleanup.attach(c,stage),owner,'memento_dev'),/expired/);
   assert.equal((await queue.drain({ids:[stage]})).completed,1);
  });

  await t.test('metadata rollback leaves no cleanup jobs and invariant prevents divergence',async()=>{
   const count=(await sql(`SELECT count(*)::int n FROM ${qschema}.object_cleanup_jobs`)).rows[0].n;
   await assert.rejects(transaction(pool,async c=>{await cleanup.enqueue(c,[`${prefix}rolled-back`]);throw new Error('rollback');},owner,'memento_dev'),/rollback/);
   assert.equal((await sql(`SELECT count(*)::int n FROM ${qschema}.object_cleanup_jobs`)).rows[0].n,count);
   const a=await req('/api/tracks',{method:'POST',body:{title:'invariant'}});track=a.data.track.id;await makeMoment();
   await assert.rejects(sql(`UPDATE ${qschema}.moments SET document=jsonb_set(document,'{eventId}','"wrong"') WHERE owner_id=$1 AND id=$2`,[owner,moment]),{code:'23514'});
  });
 } finally {
  pool.query=rawQuery;pool.connect=rawConnect;s3.send=rawSend;
  // Fake keys must never reach the live storage worker. All keys in this suite are server-generated fake PUTs or isolated prefix fixtures.
  cleanup.enqueue=enqueue;
  const manifests=await sql(`SELECT i.object_key,i.thumb_object_key,i.display_object_key FROM ${qschema}.images i WHERE owner_id=$1`,[owner]);
  const keys=manifests.rows.flatMap(x=>Object.values(x)).filter(Boolean);
  await sql(`DELETE FROM ${qschema}.object_cleanup_jobs WHERE id=ANY($1::uuid[])`,[ownedJobs]);
  await sql(`DELETE FROM ${qschema}.users WHERE id=ANY($1::uuid[])`,[[owner,editor,viewer]]);
  const queue=cleanupQueue({pool,qschema,prefix:'memento_dev/',remove:async()=>{}});await queue.drain({limit:100,retry:true,ids:ownedJobs});
  await new Promise(r=>server.close(r));
 }
});
