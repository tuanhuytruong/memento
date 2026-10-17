import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { queryBlindbox, queryPostcardPicker, validateBlindbox, validatePostcardPicker } from '../discovery-queries.mjs';
import { revealMemory } from '../src/lib/blindboxMemory.ts';
dotenv.config({ path: '.env.local', quiet: true });
const safeMoment = (document, images, reactions, version, resourceOwnerId) => ({ ...document, images: images.map(i => `/api/images/${i.id}`), version, resourceOwnerId });
test('strict discovery validation bounds inputs and owner scope', () => {
  assert.throws(() => validateBlindbox({ intent: 'invalid' }));
  assert.throws(() => validateBlindbox({ query: 'x'.repeat(121) }));
  assert.deepEqual(validateBlindbox({ query: 'Đà Lạt' }).words, ['da', 'lat']);
  assert.throws(() => validatePostcardPicker({ trackKey: 'other:t' }, 'self'));
  assert.throws(() => validatePostcardPicker({ trackKey: 'self:t', limit: 41 }, 'self'));
  assert.throws(() => validatePostcardPicker({ trackKey: 'self:t', cursor: 'bad' }, 'self'));
});
test('live PostgreSQL full-scope ranking, permissions, parity and bounded owner pagination', async t => {
  if (process.env.RUN_INTEGRATION !== '1') return t.skip('RUN_INTEGRATION=1 required');
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  const owner = randomUUID(), viewer = randomUUID(), stranger = randomUUID();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TEMP TABLE moments(owner_id uuid,id text,event_id text,document jsonb,version int); CREATE TEMP TABLE tracks(owner_id uuid,id text,document jsonb); CREATE TEMP TABLE track_collaborators(owner_id uuid,track_id text,recipient_id uuid,accepted_at timestamptz,revoked_at timestamptz); CREATE TEMP TABLE images(owner_id uuid,moment_id text,id text,created_at timestamptz)`);
    await client.query(`INSERT INTO pg_temp.tracks VALUES ($1,'t',$2),($3,'t',$4)`, [owner, JSON.stringify({ title: 'Đà Lạt' }), stranger, JSON.stringify({ title: 'Private' })]);
    const events = [];
    for (let n = 0; n < 85; n++) {
      const doc = { id: `m${String(n).padStart(3,'0')}`, eventId: 't', title: `Memory ${n}`, date: '2020-01-01', images: [], emotion: n === 84 ? 'serene' : '', description: n === 84 ? 'Bình yên' : '' };
      events.push({ ...doc, resourceOwnerId: owner });
      await client.query('INSERT INTO pg_temp.moments VALUES($1,$2,\'t\',$3,1)', [owner, doc.id, JSON.stringify(doc)]);
    }
    await client.query(`INSERT INTO pg_temp.moments VALUES($1,'m084','t',$2,1)`, [stranger, JSON.stringify({ id: 'm084', eventId: 't', title: 'Secret', emotion: 'serene', description: 'Bình yên' })]);
    await client.query(`INSERT INTO pg_temp.track_collaborators VALUES($1,'t',$2,now(),NULL)`, [owner, viewer]);
    for (const user of [owner, viewer]) {
      const result = await queryBlindbox(client,user,{ intent: 'comfort',query: 'binh yen' },'pg_temp',{ safeMoment });
      const pure = revealMemory(events,[{ id: 't',resourceOwnerId:owner,title:'Đà Lạt' }],'comfort','binh yen',()=>0);
      assert.equal(result.event.id,pure.event.id); assert.equal(result.event.resourceOwnerId,owner); assert.equal(result.fallback,pure.fallback);
      assert.equal((await queryBlindbox(client,user,{ intent:'courage',query:'no match' },'pg_temp',{ safeMoment })).fallback,true);
    }
    let cursor = null, ids = [], pages = 0;
    do {
      const page = await queryPostcardPicker(client,owner,{ trackKey:`${owner}:t`,cursor },'pg_temp',{ safeMoment });
      assert.ok(page.moments.length <= 40); assert.ok(page.moments.every(m=>m.resourceOwnerId===owner));
      ids.push(...page.moments.map(m=>m.id)); cursor=page.nextCursor; pages++;
      if (cursor) await assert.rejects(queryPostcardPicker(client,owner,{ trackKey:`${owner}:t`,search:'changed',cursor },'pg_temp',{safeMoment}));
    } while(cursor);
    assert.equal(pages,3); assert.equal(ids.length,85); assert.equal(new Set(ids).size,85);
    await assert.rejects(queryPostcardPicker(client,viewer,{ trackKey:`${owner}:t` },'pg_temp',{safeMoment}));
    await client.query('UPDATE pg_temp.track_collaborators SET revoked_at=now()');
    assert.equal(await queryBlindbox(client,viewer,{},'pg_temp',{safeMoment}),null);
    t.diagnostic('85 owned + same-ID private collision: full-scope ranking, accepted/revoked, fallback, three exact pages verified');
  } finally { await client.query('ROLLBACK'); client.release(); await pool.end(); }
});
