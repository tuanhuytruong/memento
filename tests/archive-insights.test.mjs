import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { validateInsightsQuery, queryArchiveInsights } from '../archive-insights-queries.mjs';
import { createRequestBudgets } from '../request-budgets.mjs';

const engine = process.env.INSIGHTS_PGLITE;
const own = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';

test('insights view and date are strictly bounded to supported operations', () => {
  assert.deepEqual(validateInsightsQuery({view:'archive', today:'2024-02-29'}), {view:'archive', today:'2024-02-29'});
  assert.deepEqual(validateInsightsQuery({view:'atlas'}), {view:'atlas'});
  for (const query of [{}, {view:['atlas','atlas']}, {view:'atlas', ownerId:other}, {view:'atlas',today:'2024-01-01'}, {view:'archive',today:'2025-02-29'}, {view:'archive',today:['2024-02-29']}, {view:'archive', today:'0000-12-31'}]) {
    assert.throws(() => validateInsightsQuery(query), {status:400});
  }
});

test('read budget applies to insights without consuming a write', () => {
  const budgets = createRequestBudgets({limits:{read:1,write:1}});
  const res = { setHeader() {}, status(code) { assert.equal(code,429); return this; }, json() { return 'blocked'; } };
  const call = method => budgets.account({user:{id:own}, path:'/api/archive-insights', method},res,()=> 'accepted');
  assert.equal(call('GET'),'accepted'); assert.equal(call('HEAD'),'blocked'); assert.equal(call('POST'),'accepted');
});

test('real PostgreSQL engine: authenticated route uses the full current scope, keeps composite IDs and bounds output', {skip: !engine && 'Set INSIGHTS_PGLITE to the disposable PGlite module entry'}, async () => {
  const { PGlite } = await import(engine);
  const db = new PGlite();
  let listener;
  try {
    // Existing schema, applied only to this isolated in-memory PostgreSQL engine.
    await db.exec('CREATE SCHEMA memento_dev');
    for (const name of ['001-initial.sql','002-track-collaborators.sql','005-mutation-safety.sql']) {
      await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
    }
    await db.query(`INSERT INTO memento_dev.users(id,username,password_hash) VALUES($1,'own','fixture'),($2,'other','fixture')`, [own,other]);
    await db.query(`INSERT INTO memento_dev.tracks(owner_id,id,document) VALUES
      ($1,'same','{"status":"active"}'),($2,'same','{"status":"active"}'),($2,'hidden','{"status":"active"}'),($2,'pending','{"status":"active"}')`, [own,other]);
    await db.query(`INSERT INTO memento_dev.track_collaborators(id,owner_id,track_id,recipient_id,role,accepted_at,expires_at,invited_at) VALUES
      (gen_random_uuid(),$2,'same',$1,'viewer',now()-interval '2 days',now()-interval '1 day',now()-interval '8 days'),(gen_random_uuid(),$2,'pending',$1,'editor',null,now()+interval '1 day',now())`,[own,other]);
    const add = (owner,id,track,doc) => db.query('INSERT INTO memento_dev.moments(owner_id,id,event_id,document) VALUES($1,$2,$3,$4)', [owner,id,track,{eventId:track,title:id,...doc}]);
    await add(own,'duplicate','same',{emotion:'joyful',emotionIntensity:5,date:'2024-02-29',tags:['Walk','walk','Walk'],location:{city:'Paris',country:'France'},isMilestone:true});
    await add(other,'duplicate','same',{emotion:'joyful',emotionIntensity:4,date:'2024-02-29',tags:['walk'],location:{city:'paris',country:'France'}});
    await add(other,'secret','hidden',{emotion:'serene',date:'2024-02-29',tags:['PRIVATE'],location:{city:'Undisclosed'}});
    await add(other,'invite','pending',{emotion:'serene',date:'2024-02-29',tags:['PENDING']});
    await add(own,'legacy','same',{emotion:'unrecognized',date:'2023-02-29',tags:{invalid:true},location:{city:23}});
    await add(own,'invalid-intensity','same',{emotion:'serene',emotionIntensity:'bad',date:'2024-02-01',tags:['Walk',false]});
    await db.query(`INSERT INTO memento_dev.moments(owner_id,id,event_id,document)
      SELECT $1, 'seed-' || n, 'same', jsonb_build_object('eventId','same','date',to_char(date '2021-01-01' + n * interval '15 days','YYYY-MM-DD'),'emotion','reflective','tags',jsonb_build_array('reflection'),'location',jsonb_build_object('city','Place ' || n)) FROM generate_series(1,75) n`, [own]);
    const image = '00000000-0000-4000-8000-000000000003';
    await db.query(`INSERT INTO memento_dev.images(id,owner_id,moment_id,object_key,content_type,size) VALUES($1,$2,'duplicate','do-not-return','image/jpeg',1)`, [image,other]);
    const a = await queryArchiveInsights(db,own,{view:'atlas'},'memento_dev');
    assert.equal(a.mood.logged,78); assert.equal(a.months.length,24);
    assert.deepEqual(a.geography,{places:76,countries:1,moments:77});
    assert.equal(a.places.length,12); assert.equal(a.places[0].count,2); assert.equal(a.places[0].imageId,image);
    assert.deepEqual(a.places[0].examples.map(({ownerId,id})=>[ownerId,id]),[[own,'duplicate'],[other,'duplicate']]);
    assert.equal(a.peak.ownerId, own); assert.equal(a.peak.intensity,5);
    assert.equal(a.moods.find(group=>group.mood==='reflective').count,75);
    assert.equal(a.moods.find(group=>group.mood==='reflective').examples.length,3);
    assert.deepEqual(a.associations.map(row=>[row.label,row.sample,row.count,row.share]), [['reflection',75,75,1]]);
    assert.equal(a.seals.monthsInYear,12); assert.equal(a.seals.reflectiveDays,76);
    assert.ok(!/PRIVATE|PENDING|do-not-return|Undisclosed/.test(JSON.stringify(a)));

    // Run the actual Express route and auth handler; override only the pg transport
    // to the in-process PostgreSQL engine. No remote DB or R2 calls.
    Object.assign(process.env,{ DB_SCHEMA:'memento_dev', DATABASE_URL:'postgres://localhost/unused',SESSION_SECRET:'s'.repeat(32),INVITE_ADMIN_SECRET:'i'.repeat(32),R2_BUCKET:'unused',R2_PREFIX:'memento_dev/',R2_ENDPOINT:'http://127.0.0.1:1',R2_ACCESS_KEY_ID:'unused',R2_SECRET_ACCESS_KEY:'unused' });
    const { pool, hashSession } = await import('../memento-db.mjs');
    pool.query = db.query.bind(db);
    const { app } = await import('../server.mjs');
    const token = 'disposable-local-insights-session';
    await db.query('INSERT INTO memento_dev.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval \'1 day\')',[hashSession(token),own]);
    await new Promise(resolve => { listener = app.listen(0,'127.0.0.1',resolve); });
    const base = `http://127.0.0.1:${listener.address().port}/api/archive-insights`;
    assert.equal((await fetch(`${base}?view=atlas`)).status,401);
    const authorized = url => fetch(`${base}${url}`,{headers:{Cookie:`memento_session=${token}`}});
    assert.equal((await authorized('?view=atlas&ownerId=other')).status,400);
    const response = await authorized('?view=archive&today=2024-02-29');
    assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'no-store');
    const {insights:summary} = await response.json();
    assert.deepEqual(summary.health,{total:79,dated:78,withMood:78,photos:1,milestones:1,withPlace:77,earliest:'2021-01-16',latest:'2024-02-29',activeTracks:2,totalTracks:2,tagCount:2,topTag:{label:'reflection',count:75}});
    assert.deepEqual(summary.daily.find(row=>row.day==='2024-02-29'),{day:'2024-02-29',count:2,average:4.5,mood:'joyful'});
    assert.ok(summary.daily.length <= 30);
    assert.equal(summary.daily.find(row=>row.day==='2024-02-01').average,3);
    await db.query('UPDATE memento_dev.track_collaborators SET revoked_at=now() WHERE track_id=\'same\'');
    const {insights:revoked} = await (await authorized('?view=atlas')).json();
    assert.equal(revoked.places[0].count,1); assert.equal(revoked.places[0].imageId,null);
    assert.equal(revoked.places[0].examples[0].ownerId,own);
    const revokedArchive = await (await authorized('?view=archive&today=2024-02-29')).json();
    assert.equal(revokedArchive.insights.health.photos,0);
    assert.equal(revokedArchive.insights.health.totalTracks,1);
    await db.query('DELETE FROM memento_dev.moments WHERE owner_id=$1',[own]);
    const {insights:empty} = await (await authorized('?view=atlas')).json();
    assert.deepEqual(empty.mood,{logged:0,average:null});
    assert.deepEqual(empty.geography,{places:0,countries:0,moments:0});
    assert.deepEqual(empty.associations,[]);
    assert.ok(Object.values(empty.seals).every(value=>value===0));
    await db.query('DELETE FROM memento_dev.sessions');
    assert.equal((await authorized('?view=atlas')).status,401);
  } finally {
    if (listener) await new Promise((resolve,reject) => listener.close(err=>err ? reject(err) : resolve()));
    await db.close();
  }
});
