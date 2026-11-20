import test from 'node:test';
import assert from 'node:assert/strict';
import { queryMoments, queryFacets, validateQueryRequest } from '../moment-queries.mjs';
import { browseMonths, browsePreview, seekMoments } from '../month-browse-queries.mjs';
import { searchableText } from '../moment-search.mjs';

const caller = '00000000-0000-4000-8000-000000000001';
const shared = '00000000-0000-4000-8000-000000000002';
const unrelated = '00000000-0000-4000-8000-000000000003';
const helpers = { safeMoment: (doc, images, _, version, resourceOwnerId) => ({ ...doc, images, version, resourceOwnerId }) };
const keys = page => page.moments.map(row => `${row.resourceOwnerId}:${row.id}`);
const mine = id => `${caller}:${id}`;
const borrowed = id => `${shared}:${id}`;

const embedded = process.env.MOMENT_SORT_PGLITE_MODULE;
const integrated = process.env.RUN_INTEGRATION === '1';

test('only the feed accepts smart sorts; month metadata, preview and seek reject them before SQL', async () => {
  assert.equal(validateQueryRequest({}, caller).sortBy, 'date');
  assert.throws(() => validateQueryRequest({ sortBy: 'moodIntensity' }, caller), { status: 400 });
  for (const sortBy of ['relevance', 'intensity']) {
    assert.equal(validateQueryRequest({ sortBy }, caller).sortBy, sortBy);
    for (const endpoint of [browseMonths, browsePreview, seekMoments]) {
      await assert.rejects(endpoint(null, caller, { sortBy }, 'pg_temp'), { status: 400 });
    }
  }
});

test('PostgreSQL smart feed: prototype weights, scoped authorizations and bidirectional composite keysets', {
  skip: !embedded && !integrated && 'Set RUN_INTEGRATION=1 with DEV env, or MOMENT_SORT_PGLITE_MODULE to an installed PGlite module URL',
  timeout: 60000,
}, async () => {
  let db, close;
  if (embedded) {
    const { PGlite } = await import(embedded);
    db = new PGlite();
    close = () => db.close();
  } else {
    assert.equal(process.env.DB_SCHEMA, 'memento_dev');
    assert.ok(process.env.DATABASE_URL, 'Load DEV env first');
    const { Client } = (await import('pg')).default;
    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    close = () => db.end();
  }
  try {
    // Isolated PostgreSQL fixtures, never production rows. Search fixture text
    // uses the same corpus contract as the existing generated column trigger.
    const ddl = `CREATE TEMP TABLE moments(owner_id uuid,id text,event_id text,document jsonb,version int,search_text text,PRIMARY KEY(owner_id,id));
      CREATE TEMP TABLE track_collaborators(owner_id uuid,track_id text,recipient_id uuid,accepted_at timestamptz,revoked_at timestamptz);
      CREATE TEMP TABLE images(owner_id uuid,moment_id text,id text,created_at timestamptz DEFAULT now());
      CREATE TEMP TABLE saved_moments(user_id uuid,moment_owner_id uuid,moment_id text);
      CREATE TEMP TABLE moment_perspectives(moment_owner_id uuid,moment_id text,body text);
      CREATE TEMP TABLE moment_reactions(moment_owner_id uuid,moment_id text);`;
    if (embedded) await db.exec(ddl); else await db.query(ddl);
    const page = (input = {}, user = caller) => queryMoments(db, user, {
      ...validateQueryRequest({ limit: 2, ...input }, user), cursor: input.cursor, navigation: input.navigation,
    }, 'pg_temp', helpers);
    const seed = (owner, id, doc, track = 'main') => {
      const document = { id, title: 'Memory', date: '2025-01-01', tags: ['scope'], ...doc };
      return db.query('INSERT INTO pg_temp.moments VALUES ($1,$2,$3,$4,1,$5)', [owner, id, track, JSON.stringify(document), searchableText(document)]);
    };
    await db.query("INSERT INTO pg_temp.track_collaborators VALUES ($1,'main',$2,now(),NULL),($1,'pending',$2,NULL,NULL)", [shared, caller]);
    await seed(caller, 'dupe', { date: '2025-03-01', time: '09:00', emotion: 'joyful', emotionIntensity: 3 });
    await seed(shared, 'dupe', { date: '2025-03-01', time: '09:00', emotion: 'joyful', emotionIntensity: 3 });
    await seed(caller, 'notimed', { date: '2025-03-01', emotion: 'joyful' });
    await seed(caller, 'early', { date: '2025-02-01', time: '10:00', emotion: 'joyful', emotionIntensity: 'broken' });
    await seed(caller, 'peak', { emotion: 'joyful', emotionIntensity: 4.75, isMilestone: true });
    await seed(caller, 'unlogged', { date: '2025-04-01', saved: true, perspectives: [{ body: 'fake' }], images: ['fake'], reactions: [{ count: 1000 }] });
    await seed(caller, 'excluded', { tags: ['other'], isMilestone: true });
    await seed(shared, 'pending', { isMilestone: true }, 'pending');
    await seed(unrelated, 'dupe', { isMilestone: true, emotion: 'joyful', emotionIntensity: 100 });
    await db.query('INSERT INTO pg_temp.saved_moments VALUES ($1,$2,\'dupe\'),($2,$1,\'dupe\')', [caller, shared]);
    await db.query("INSERT INTO pg_temp.images(owner_id,moment_id,id) VALUES ($1,'dupe','one'),($1,'dupe','two'),($2,'dupe','private')", [shared, unrelated]);
    await db.query("INSERT INTO pg_temp.moment_perspectives VALUES ($1,'dupe','%_'),($2,'dupe','hidden'),($2,'dupe','hidden 2')", [shared, unrelated]);
    await db.query("INSERT INTO pg_temp.moment_reactions SELECT $1,'dupe' FROM generate_series(1,50)", [unrelated]);
    await db.query("INSERT INTO pg_temp.moment_reactions VALUES ($1,'dupe')", [shared]);

    async function traverse(input, expected) {
      const pages = [];
      let cursor = null;
      do {
        assert.ok(pages.length < 12, 'cursor must terminate');
        const result = await page({ ...input, cursor });
        assert.ok(result.moments.length <= 2);
        pages.push(result);
        cursor = result.nextCursor;
      } while (cursor);
      assert.deepEqual(pages.flatMap(keys), expected);
      for (let index = pages.length - 1; index > 0; index--) {
        const previous = await page({ ...input, cursor: pages[index].previousCursor, navigation: 'previous' });
        assert.deepEqual(keys(previous), keys(pages[index - 1]));
        assert.equal(Boolean(previous.previousCursor), index > 1);
        assert.deepEqual(keys(await page({ ...input, cursor: previous.nextCursor })), keys(pages[index]));
      }
      return pages;
    }
    const selectedTags = ['scope'];
    const intensity = { selectedTags, sortBy: 'intensity' };
    const high = await traverse(intensity, [mine('peak'), borrowed('dupe'), mine('dupe'), mine('notimed'), mine('early'), mine('unlogged')]);
    await traverse({ ...intensity, sortDirection: 'oldest' }, [mine('unlogged'), borrowed('dupe'), mine('dupe'), mine('notimed'), mine('early'), mine('peak')]);
    const relevance = { selectedTags, sortBy: 'relevance' };
    await traverse(relevance, [borrowed('dupe'), mine('peak'), mine('dupe'), mine('unlogged'), mine('notimed'), mine('early')]);
    await traverse({ ...relevance, sortDirection: 'oldest' }, [mine('unlogged'), mine('notimed'), mine('early'), mine('dupe'), mine('peak'), borrowed('dupe')]);
    assert.equal((await queryFacets(db, caller, validateQueryRequest(relevance, caller), 'pg_temp')).total, 6);
    assert.deepEqual(keys(await page({ ...relevance, savedOnly: true })), [borrowed('dupe')]);

    const cursor = high[0].nextCursor;
    for (const change of [{ sortBy: 'date' }, { sortBy: 'relevance' }, { sortDirection: 'oldest' }, { selectedTags: ['other'] }, { search: 'memory' }, { navigation: 'previous' }, { cursor: `${cursor}a` }]) {
      await assert.rejects(page({ ...intensity, cursor, ...change }), { status: 400 });
    }
    await assert.rejects(page({ ...intensity, cursor }, shared), { status: 400 });
    await db.query('UPDATE pg_temp.track_collaborators SET revoked_at=now() WHERE recipient_id=$1', [caller]);
    assert.ok(keys(await page({ ...intensity, cursor })).every(key => key.startsWith(caller)));
    assert.ok(keys(await page(relevance)).every(key => key.startsWith(caller)));

    // Existing chronological order is untouched (missing time is the legacy
    // '99:99' sentinel), and a date-seek cursor can still page the date feed.
    const date = { selectedTags, sortBy: 'date' };
    assert.deepEqual(keys(await page({ selectedTags })), keys(await page(date)));
    const landed = await seekMoments(db, caller, { ...date, limit: 1, target: { ownerId: caller, id: 'notimed' } }, 'pg_temp', helpers);
    assert.deepEqual(keys(landed), [mine('notimed')]);
    assert.deepEqual(keys(await page({ ...date, limit: 1, cursor: landed.nextCursor })), [mine('dupe')]);
    await assert.rejects(page({ ...intensity, cursor: landed.nextCursor }), { status: 400 });

    // All six literal search-hit weights; repeated values in a category only
    // count once. The perspective-only row qualifies through its description
    // because the current canonical filter does not index perspectives.
    const matrix = [
      ['title', { title: 'ĐÀ %_' }],
      ['idea', { idea: 'Đà %_' }],
      ['location', { location: { name: 'Đà %_', city: 'Đà %_', country: 'Đà %_' } }],
      ['tags', { tags: ['Đà %_', 'ĐÀ %_'] }],
      ['desc', { description: 'Đà %_' }],
      ['reflection', { description: 'Đà %_' }],
      ['folded', { title: 'Da %_' }],
      ['notliteral', { title: 'Đà xx' }],
    ];
    for (const [id, doc] of matrix) await seed(caller, id, doc, 'search');
    await db.query("INSERT INTO pg_temp.moment_perspectives VALUES ($1,'reflection','Đà %_')", [caller]);
    const search = { sortBy: 'relevance', search: ' Đà %_ ', trackKey: `${caller}:search` };
    await traverse(search, ['title', 'reflection', 'idea', 'location', 'tags', 'desc', 'folded'].map(mine));
  } finally {
    await close();
  }
});
