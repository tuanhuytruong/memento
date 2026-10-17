import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { readExportSnapshot, mountExportSnapshotRoutes, EXPORT_PAGE_LIMIT } from '../export-snapshot.mjs';
dotenv.config({ path: '.env.local', quiet: true });
const safeMoment = (document, images, reactions, version, resourceOwnerId) => ({ ...document, images: images.map(i => `/api/images/${i.id}`), reactions, version, resourceOwnerId });
test('validation bounds pages and cursors before acquiring DB; routes always run auth', async () => {
  const pool = { connect() { throw new Error('unexpected database access'); } };
  for (const input of [{ action:'page' }, { limit:EXPORT_PAGE_LIMIT+1 }, { kind:'private' }, { action:'other' }, { action:'page', fingerprint:'a'.repeat(64), cursor:'garbage' }]) {
    await assert.rejects(readExportSnapshot(pool,randomUUID(),input,'pg_temp',{safeMoment}), e=>e.status===400);
  }
  const routes=[], auth=()=>{};
  mountExportSnapshotRoutes({ post(...args){routes.push(args);} },{ auth });
  assert.deepEqual(routes.map(r=>r[0]),['/api/export/start','/api/export/page','/api/export/finalize']);
  assert.ok(routes.every(r=>r[1]===auth));
});
test('PostgreSQL exact full-scope export rejects same-count edits, revoke and replacement', async t => {
  if (process.env.RUN_INTEGRATION !== '1') return t.skip('RUN_INTEGRATION=1 required');
  const {default:pg}=await import('pg');
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});
  const owner=randomUUID(),viewer=randomUUID(),stranger=randomUUID();
  const call=(user,input={})=>readExportSnapshot(pool,user,input,'pg_temp',{safeMoment});
  try {
    await pool.query(`CREATE TEMP TABLE tracks(owner_id uuid,id text,document jsonb);
      CREATE TEMP TABLE moments(owner_id uuid,id text,event_id text,document jsonb,version int);
      CREATE TEMP TABLE track_collaborators(owner_id uuid,track_id text,recipient_id uuid,role text,accepted_at timestamptz,revoked_at timestamptz);
      CREATE TEMP TABLE images(owner_id uuid,moment_id text,id text,created_at timestamptz,object_key text);
      CREATE TEMP TABLE tags(owner_id uuid,name text);
      CREATE TEMP TABLE users(id uuid,username text);
      CREATE TEMP TABLE moment_perspectives(id uuid,moment_owner_id uuid,moment_id text,author_id uuid,kind text,body text,version int,created_at timestamptz,updated_at timestamptz);`);
    await pool.query(`INSERT INTO tracks VALUES($1,'t','{"id":"t","tags":["shared"]}'),($2,'t','{"id":"t"}'),($3,'t','{"id":"t"}')`,[owner,viewer,stranger]);
    await pool.query(`INSERT INTO track_collaborators VALUES($1,'t',$2,'viewer',now(),NULL)`,[owner,viewer]);
    for(const user of [owner,viewer,stranger]) for(let n=0;n<5;n++) {
      await pool.query(`INSERT INTO moments VALUES($1,$2,'t',$3,1)`,[user,`m${n}`,JSON.stringify({id:`m${n}`,title:'before',tags:['moment-tag']})]);
    }
    await pool.query(`INSERT INTO images VALUES($1,'m0','img',now(),'never-return-key')`,[owner]);
    await pool.query(`INSERT INTO tags VALUES($1,'fresh')`,[owner]);
    await pool.query(`INSERT INTO users VALUES($1,'author')`,[owner]);
    await pool.query(`INSERT INTO moment_perspectives VALUES($1,$2,'m0',$2,'note','owned perspective',1,now(),now()),($3,$4,'m0',$2,'note','viewer-owned perspective',1,now(),now())`,[randomUUID(),owner,randomUUID(),viewer]);
    const start=await call(viewer);
    assert.deepEqual(start.counts,{moments:10,tracks:2,tags:2,perspectives:1});
    const collected={};
    for(const kind of ['moments','tracks','tags','perspectives']) {
      let cursor=null,items=[],pages=0;
      do {
        const page=await call(viewer,{action:'page',fingerprint:start.fingerprint,token:start.token,kind,limit:2,cursor});
        assert.ok(page.items.length<=2); items.push(...page.items);cursor=page.nextCursor;pages++;
      }while(cursor);
      collected[kind]=items;
      if(kind==='moments') assert.equal(pages,5);
    }
    assert.equal(new Set(collected.moments.map(m=>`${m.resourceOwnerId}:${m.id}`)).size,10);
    assert.ok(collected.moments.every(m=>m.resourceOwnerId!==stranger && !('reactions' in m)));
    assert.equal(collected.moments.find(m=>m.resourceOwnerId===owner&&m.id==='m0').images[0],'/api/images/img');
    assert.ok(!JSON.stringify(collected).includes('never-return-key'));
    assert.equal(collected.perspectives[0].momentOwnerId,viewer);
    assert.equal((await call(viewer,{action:'finalize',fingerprint:start.fingerprint,token:start.token})).complete,true);
    await assert.rejects(call(owner,{action:'finalize',fingerprint:start.fingerprint,token:start.token}),e=>e.status===400);
    await assert.rejects(call(viewer,{action:'finalize',fingerprint:start.fingerprint,token:'0'.repeat(64)}),e=>e.status===400);
    // ABA: a transient version differs at page read, then returns to its old
    // value before finalization. The mixed page must already have failed.
    await pool.query(`UPDATE moments SET version=99 WHERE owner_id=$1 AND id='m0'`,[owner]);
    await assert.rejects(call(viewer,{action:'page',fingerprint:start.fingerprint,token:start.token}),e=>e.status===409);
    await pool.query(`UPDATE moments SET version=1 WHERE owner_id=$1 AND id='m0'`,[owner]);
    assert.equal((await call(viewer,{action:'finalize',fingerprint:start.fingerprint,token:start.token})).complete,true);
    const rejected=async mutate=>{
      const before=await call(viewer);
      await mutate();
      await assert.rejects(call(viewer,{action:'finalize',fingerprint:before.fingerprint,token:before.token}),e=>e.status===409);
      await assert.rejects(call(viewer,{action:'page',fingerprint:before.fingerprint,token:before.token}),e=>e.status===409);
    };
    await rejected(()=>pool.query(`UPDATE moments SET document=jsonb_set(document,'{title}','"same count edit"'),version=version+1 WHERE owner_id=$1 AND id='m0'`,[owner]));
    await rejected(()=>pool.query(`UPDATE moments SET version=version+1 WHERE owner_id=$1 AND id='m0'`,[owner]));
    await rejected(()=>pool.query(`UPDATE tracks SET document=document||'{"title":"changed track"}' WHERE owner_id=$1`,[owner]));
    await pool.query(`INSERT INTO tags VALUES($1,'own-tag')`,[viewer]);
    await rejected(()=>pool.query(`UPDATE tags SET name='replacement-tag' WHERE owner_id=$1`,[viewer]));
    await rejected(()=>pool.query(`UPDATE moment_perspectives SET body='same count perspective',version=version+1 WHERE moment_owner_id=$1`,[viewer]));
    await rejected(()=>pool.query(`UPDATE images SET id='replacement-image' WHERE owner_id=$1`,[owner]));
    await rejected(()=>pool.query(`UPDATE moments SET id='replacement-moment',document=document||'{"id":"replacement-moment"}' WHERE owner_id=$1 AND id='m4'`,[owner]));
    // Revoke one track while replacing its five moments with newly owned rows:
    // total is unchanged, but exact authorized membership must fail closed.
    await rejected(async()=>{
      await pool.query('BEGIN');
      try {
        await pool.query(`UPDATE track_collaborators SET revoked_at=now() WHERE recipient_id=$1`,[viewer]);
        await pool.query(`INSERT INTO moments SELECT $1,'new-'||n,'t',jsonb_build_object('id','new-'||n),1 FROM generate_series(1,5) n`,[viewer]);
        await pool.query('COMMIT');
      }catch(e){await pool.query('ROLLBACK');throw e;}
    });
    assert.equal((await call(viewer)).counts.moments,10);
    assert.equal((await call(owner)).counts.perspectives,1);
    t.diagnostic('Five bounded moment pages; same-count content/version/track/tag/perspective/image/identity/revoke changes rejected at page and finalize');
    // Account binding is incorporated even for identical/empty scopes.
    assert.notEqual((await call(randomUUID())).fingerprint,(await call(randomUUID())).fingerprint);
  } finally { await pool.end(); }
});
