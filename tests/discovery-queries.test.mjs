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
test('a round reports seen identities as bounded, deduplicated composite input', () => {
  const owner = randomUUID();
  assert.deepEqual(validateBlindbox({}).seen, { owners: [], ids: [] });
  assert.deepEqual(validateBlindbox({ seen: [{ ownerId: owner, id: 'm1' }, { ownerId: owner, id: 'm1' }] }).seen, { owners: [owner], ids: ['m1'] });
  assert.throws(() => validateBlindbox({ seen: 'm1' }));
  assert.throws(() => validateBlindbox({ seen: [{ ownerId: owner, id: 'm1' }, null] }));
  assert.throws(() => validateBlindbox({ seen: [{ ownerId: owner }] }));
  assert.throws(() => validateBlindbox({ seen: [{ id: 'm1' }] }));
  assert.throws(() => validateBlindbox({ seen: [{ ownerId: owner, id: 'm1', resourceOwnerId: owner }] }));
  assert.throws(() => validateBlindbox({ seen: [{ ownerId: 'not-a-uuid', id: 'm1' }] }));
  assert.throws(() => validateBlindbox({ seen: [{ ownerId: owner, id: '' }] }));
  assert.throws(() => validateBlindbox({ seen: [{ ownerId: owner, id: 'x'.repeat(201) }] }));
  assert.throws(() => validateBlindbox({ seen: Array.from({ length: 10001 }, (_, n) => ({ ownerId: owner, id: `m${n}` })) }));
  const many = validateBlindbox({ seen: Array.from({ length: 10000 }, () => ({ ownerId: owner, id: 'm1' })) }).seen;
  assert.deepEqual(many, { owners: [owner], ids: ['m1'] });
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
      assert.equal(result.event.id,'m084','the only mood match still wins with an unseen list');
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
    assert.equal(await queryBlindbox(client,viewer,{ seen: [{ ownerId: owner, id: 'm000' }] },'pg_temp',{safeMoment}),null,'a revoked collaborator cannot reveal anything, seen list or not');
    t.diagnostic('85 owned + same-ID private collision: full-scope ranking, accepted/revoked, fallback, three exact pages verified');
  } finally { await client.query('ROLLBACK'); client.release(); await pool.end(); }
});
test('live PostgreSQL reveals every accessible composite identity once before exhaustion', async t => {
  if (process.env.RUN_INTEGRATION !== '1') return t.skip('RUN_INTEGRATION=1 required');
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  const owner = randomUUID(), viewer = randomUUID(), stranger = randomUUID();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TEMP TABLE moments(owner_id uuid,id text,event_id text,document jsonb,version int); CREATE TEMP TABLE tracks(owner_id uuid,id text,document jsonb); CREATE TEMP TABLE track_collaborators(owner_id uuid,track_id text,recipient_id uuid,accepted_at timestamptz,revoked_at timestamptz); CREATE TEMP TABLE images(owner_id uuid,moment_id text,id text,created_at timestamptz)`);
    await client.query(`INSERT INTO pg_temp.tracks VALUES ($1,'t',$2),($3,'t',$4),($5,'t',$6)`, [owner, JSON.stringify({ title: 'Đà Lạt' }), viewer, JSON.stringify({ title: 'Viewer track' }), stranger, JSON.stringify({ title: 'Private' })]);
    const owned = [];
    for (let n = 0; n < 6; n++) {
      const doc = { id: `m${n}`, eventId: 't', title: `Memory ${n}`, date: '2020-01-01', images: [], emotion: n === 5 ? 'serene' : '', description: n === 5 ? 'Bình yên' : '' };
      owned.push(doc.id);
      await client.query('INSERT INTO pg_temp.moments VALUES($1,$2,\'t\',$3,1)', [owner, doc.id, JSON.stringify(doc)]);
    }
    // The same id under two other owners: exclusion must be composite, and a row the
    // caller cannot access must never become reachable through a seen identity.
    await client.query(`INSERT INTO pg_temp.moments VALUES($1,'m0','t',$2,1)`, [viewer, JSON.stringify({ id: 'm0', eventId: 't', title: 'Viewer m0', date: '2021-02-02', images: [], emotion: '', description: '' })]);
    await client.query(`INSERT INTO pg_temp.moments VALUES($1,'m0','t',$2,1)`, [stranger, JSON.stringify({ id: 'm0', eventId: 't', title: 'Secret', date: '2019-03-03', images: [], emotion: '', description: '' })]);
    await client.query(`INSERT INTO pg_temp.track_collaborators VALUES($1,'t',$2,now(),NULL)`, [owner, viewer]);
    const reveal = (user, seen, input = { intent: 'surprise' }) => queryBlindbox(client, user, { ...input, seen }, 'pg_temp', { safeMoment });
    const mood = { intent: 'comfort', query: 'binh yen' };
    const moodWinner = await reveal(owner, owned.slice(0, 5).map(id => ({ ownerId: owner, id })), mood);
    assert.equal(moodWinner.event.id, 'm5', 'exclusion is applied before ranking, so the unseen mood match still wins');
    assert.equal(moodWinner.fallback, false);
    const moodSpent = await reveal(owner, [{ ownerId: owner, id: 'm5' }], mood);
    assert.equal(moodSpent.fallback, true, 'exhausting mood matches is not global exhaustion');
    assert.notEqual(moodSpent.event.id, 'm5');
    const unrelated = await reveal(owner, [{ ownerId: stranger, id: 'm0' }], mood);
    assert.equal(unrelated.event.resourceOwnerId, owner);
    assert.equal(unrelated.event.id, 'm5', 'an identity the caller cannot access neither excludes nor widens anything');
    const ownerHistory = owned.map(id => ({ ownerId: owner, id }));
    const ownDuplicate = await reveal(viewer, ownerHistory);
    assert.equal(ownDuplicate.event.resourceOwnerId, viewer, 'a shared id under the viewers own owner stays reachable');
    assert.equal(ownDuplicate.event.id, 'm0');
    const seen = [], order = [], revealed = [];
    for (let guard = 0; guard < 20; guard++) {
      const result = await reveal(viewer, seen);
      if (!result) break;
      const identity = { ownerId: result.event.resourceOwnerId, id: result.event.id };
      assert.ok([owner, viewer].includes(identity.ownerId), 'only accessible owners are revealed');
      seen.push(identity); order.push(`${identity.ownerId}:${identity.id}`); revealed.push(result.event);
    }
    assert.equal(order.length, 7, 'every accessible memory is revealed exactly once');
    assert.equal(new Set(order).size, order.length, 'no composite identity repeats inside a round');
    assert.deepEqual(new Set(order), new Set([...owned.map(id => `${owner}:${id}`), `${viewer}:m0`]));
    assert.ok(revealed.every(event => event.title !== 'Secret' && event.title !== 'Private'), 'private rows never cross the authorization boundary');
    assert.equal(await reveal(viewer, seen), null, 'the round ends with no candidate once everything is seen');
    assert.equal(await queryBlindbox(client, viewer, { intent: 'comfort', query: 'binh yen', seen }, 'pg_temp', { safeMoment }), null, 'changing intent and keywords cannot reintroduce a seen memory');
    const single = await reveal(stranger, []);
    assert.equal(single.event.resourceOwnerId, stranger); assert.equal(single.event.id, 'm0');
    assert.equal(await reveal(stranger, [{ ownerId: stranger, id: 'm0' }]), null, 'a one-memory account completes after its only memory');
    assert.equal(await reveal(randomUUID(), []), null, 'an account with nothing accessible gets no candidate');
    t.diagnostic('6 owned + viewer row sharing id m0 + private row: exclusion before ranking, mood fallback, composite coupling, one-shot completion');
  } finally { await client.query('ROLLBACK'); client.release(); await pool.end(); }
});
