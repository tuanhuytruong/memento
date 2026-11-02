import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { app } from '../server.mjs';
import { pool, qschema, hashSession } from '../memento-db.mjs';

test('durable create identity: concurrent replay, binding, authorization and deletion tombstone', {timeout:60000}, async t => {
  if(process.env.RUN_INTEGRATION!=='1') return t.skip('requires DB integration');
  if(process.env.DB_SCHEMA!=='memento_dev') return t.skip('disposable fault probes are DEV only');
  const server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const users=[0,1,2].map(()=>({id:crypto.randomUUID(),token:crypto.randomBytes(32).toString('hex')}));
  const [owner,editor,other]=users;
  const key=crypto.randomUUID();
  const payload={eventId:'create-test',eventOwnerId:owner.id,title:'same content',date:'2026-11-02',images:[],tags:[]};
  async function post(user=owner,k=key,p=payload){const r=await fetch(base+'/api/moments',{method:'POST',headers:{Origin:base,Cookie:`memento_session=${user.token}`,'Content-Type':'application/json','Idempotency-Key':k},body:JSON.stringify(p)});return {status:r.status,...await r.json()};}
  try{
    for(const u of users){await pool.query(`INSERT INTO ${qschema}.users(id,username,password_hash) VALUES($1,$2,'unused')`,[u.id,'create_'+u.id.replaceAll('-','')]);await pool.query(`INSERT INTO ${qschema}.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')`,[hashSession(u.token),u.id]);}
    for(const u of [owner,other])for(const id of ['create-test','second'])await pool.query(`INSERT INTO ${qschema}.tracks(owner_id,id,document) VALUES($1,$2,$3)`,[u.id,id,{id,title:id,tags:[]}]);
    const concurrent=await Promise.all(Array.from({length:6},()=>post()));
    concurrent.forEach(r=>assert.equal(r.status,201));
    const first=concurrent[0].moment;assert.equal(new Set(concurrent.map(r=>r.moment.id)).size,1);
    assert.equal((await post()).moment.id,first.id,'response-loss replay');
    assert.equal((await post(owner,key,{...payload,title:'changed'})).status,409);
    assert.equal((await post(owner,key,{...payload,eventId:'second'})).status,409);
    assert.equal((await post(owner,key,{...payload,eventOwnerId:other.id})).status,404);
    assert.equal((await post(other)).status,404,'unrelated user cannot replay');
    const own=await post(other,key,{...payload,eventOwnerId:other.id});assert.equal(own.status,201);assert.notEqual(own.moment.id,first.id,'actor namespace cannot adopt result');
    assert.equal((await post(owner,key,{...payload,eventOwnerId:other.id})).status,404);
    await pool.query(`INSERT INTO ${qschema}.track_collaborators(id,owner_id,track_id,recipient_id,role,accepted_at,expires_at) VALUES(gen_random_uuid(),$1,'create-test',$2,'editor',now(),now()+interval '1 day')`,[other.id,owner.id]);
    assert.equal((await post(owner,key,{...payload,eventOwnerId:other.id})).status,409,'authorized cross-owner destination mismatch');
    const second=await post(owner,crypto.randomUUID());assert.equal(second.status,201);assert.notEqual(second.moment.id,first.id);
    await pool.query(`INSERT INTO ${qschema}.track_collaborators(id,owner_id,track_id,recipient_id,role,accepted_at,expires_at) VALUES(gen_random_uuid(),$1,$2,$3,'editor',now(),now()+interval '1 day')`,[owner.id,'create-test',editor.id]);
    const editorKey=crypto.randomUUID();assert.equal((await post(editor,editorKey)).status,201);
    await pool.query(`UPDATE ${qschema}.track_collaborators SET role='viewer' WHERE owner_id=$1 AND recipient_id=$2`,[owner.id,editor.id]);assert.equal((await post(editor,editorKey)).status,403);
    await pool.query(`UPDATE ${qschema}.track_collaborators SET revoked_at=now() WHERE owner_id=$1 AND recipient_id=$2`,[owner.id,editor.id]);assert.equal((await post(editor,editorKey)).status,404);
    const deleted=await fetch(base+'/api/moments/'+first.id,{method:'DELETE',headers:{Origin:base,Cookie:`memento_session=${owner.token}`,'Content-Type':'application/json'},body:JSON.stringify({ownerId:owner.id})});assert.equal(deleted.status,200);
    assert.equal((await post()).status,409,'deleted resource cannot resurrect');
    assert.ok((await pool.query(`SELECT deleted_at FROM ${qschema}.moment_create_operations WHERE actor_id=$1 AND operation_key=$2`,[owner.id,key])).rows[0].deleted_at);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM ${qschema}.moments WHERE owner_id=$1 AND id=$2`,[owner.id,first.id])).rows[0].n,0);
  }finally{for(const u of users)await pool.query(`DELETE FROM ${qschema}.users WHERE id=$1`,[u.id]);await new Promise(r=>server.close(r));}
});
