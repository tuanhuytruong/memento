import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: process.env.ENV_FILE || '.env.local', quiet: true });

// This is real DEV-schema SQL, not a pg_temp model. The transaction contains
// only random test principals/resources and is ALWAYS rolled back in finally.
// Never import the app/shared pool, change real records, or touch R2 here.
test('DEV month browse production builders against disposable real-schema fixtures', { timeout: 180000 }, async t => {
  if (process.env.RUN_INTEGRATION !== '1') return t.skip('RUN_INTEGRATION=1 required for real DEV database regression');
  assert.equal(process.env.DB_SCHEMA, 'memento_dev', 'refuse any schema except explicit DEV');
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required');
  const { default: pg } = await import('pg');
  const { browseMonths, browsePreview, seekMoments } = await import('../month-browse-queries.mjs');
  const { queryMoments, validateQueryRequest } = await import('../moment-queries.mjs');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000, statement_timeout: 20000 });
  const client = await pool.connect();
  const schema = '"memento_dev"';
  const [owner, otherOwner, editor, viewer, unrelated] = Array.from({ length: 5 }, () => randomUUID());
  const users = [owner, otherOwner, editor, viewer, unrelated];
  const shared = `mbi-${randomUUID()}`;
  const privateTrack = `mbi-private-${randomUUID()}`;
  const documents = [];
  const add = (ownerId, eventId, id, date, extra = {}) => documents.push({ ownerId, document: { id, eventId, date, time: '12:34', title: 'Đà Lạt literal %_ regression', description: 'a'.repeat(1200), tags: ['month-browse-regression'], ...extra } });
  // Equal timestamps and punctuation/case IDs force genuine tuple pagination.
  for (let i = 0; i < 270; i++) add(owner, shared, `dense-${['A', 'a', '_'][i % 3]}-${String(i).padStart(4, '0')}`, '2026-09-15');
  add(owner, shared, 'collision', '2026-09-15');
  add(otherOwner, shared, 'collision', '2026-09-15');
  add(owner, shared, 'october', '2026-10-01');
  add(owner, shared, 'august', '2026-08-31');
  add(owner, shared, 'cross-year', '2025-12-31');
  add(owner, shared, 'leap', '2024-02-29');
  add(owner, shared, 'low-year', '0000-02-29');
  const badDates = ['', null, 'not-a-date', '2026-02-29', '2026-04-31', '2026-09-15T00:00:00Z'];
  badDates.forEach((date, i) => add(owner, shared, `undated-${i}`, date));
  add(owner, privateTrack, 'private', '2030-01-01');
  const visible = documents.filter(row => row.document.eventId === shared);
  const identity = row => `${row.ownerId ?? row.resourceOwnerId}:${row.id ?? row.document?.id}`;
  const identities = rows => rows.map(identity);
  // Production SQL/enrichment runs unchanged; only its required document mapper
  // is supplied, preserving the exact owner identity like existing query tests.
  const helpers = { safeMoment: (document, images, reactions, version, resourceOwnerId) => ({ ...document, images, reactions, version, resourceOwnerId }) };
  const feed = (user, body = {}) => queryMoments(client, user, { ...validateQueryRequest(body, user), cursor: body.cursor, navigation: body.navigation }, schema, helpers);
  const seek = (user, body) => seekMoments(client, user, body, schema, helpers);
  const unavailable = error => error.status === 404;
  const badCursor = error => error.status === 400;
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    for (const user of users) {
      await client.query(`INSERT INTO ${schema}.users(id,username,password_hash) VALUES($1,$2,$3)`, [user, `mbi_${user.replaceAll('-', '')}`, 'disposable-not-a-login-hash']);
    }
    for (const [user, track] of [[owner, shared], [owner, privateTrack], [otherOwner, shared]]) {
      await client.query(`INSERT INTO ${schema}.tracks(owner_id,id,document) VALUES($1,$2,$3)`, [user, track, { id: track, title: 'Disposable month integration', tags: [] }]);
    }
    // Accepted invitations remain valid even after their acceptance deadline.
    for (const [resourceOwner, recipient, role] of [[owner, viewer, 'viewer'], [owner, editor, 'editor'], [otherOwner, viewer, 'viewer'], [otherOwner, owner, 'viewer']]) {
      await client.query(`INSERT INTO ${schema}.track_collaborators(id,owner_id,track_id,recipient_id,role,invited_at,expires_at,accepted_at) VALUES($1,$2,$3,$4,$5,now()-interval '3 days',now()-interval '1 day',now()-interval '2 days')`, [randomUUID(), resourceOwner, shared, recipient, role]);
    }
    await client.query(`INSERT INTO ${schema}.moments(owner_id,id,event_id,document) SELECT (v->>'ownerId')::uuid,v->'document'->>'id',v->'document'->>'eventId',v->'document' FROM jsonb_array_elements($1::jsonb) v`, [JSON.stringify(documents)]);

    await t.test('months/preview/seek honor owner, editor, viewer and unrelated permission boundaries', async () => {
      for (const [user, september, total] of [[owner, 272, visible.length + 1], [editor, 271, visible.length - 1], [viewer, 272, visible.length]]) {
        const months = await browseMonths(client, user, {}, schema);
        assert.equal(months.months.find(row => row.key === '2026-09').count, september);
        assert.equal(months.months.some(row => row.key === '2030-01'), user === owner, 'private month never leaks');
        assert.equal(months.undatedCount, badDates.length);
        const preview = await browsePreview(client, user, { month: '2026-09' }, schema);
        assert.equal(preview.total, september);
        assert.equal(preview.items.length, 24);
        assert.equal((await seek(user, { target: { ownerId: owner, id: 'august' } })).total, total);
      }
      assert.deepEqual((await browseMonths(client, unrelated, {}, schema)).months, []);
      assert.equal((await browsePreview(client, unrelated, { month: '2026-09' }, schema)).total, 0);
      await assert.rejects(seek(unrelated, { target: { ownerId: owner, id: 'collision' } }), unavailable);
      for (const user of [viewer, editor]) {
        assert.equal((await browsePreview(client, user, { month: '2030-01' }, schema)).total, 0);
        await assert.rejects(seek(user, { target: { ownerId: owner, id: 'private' } }), unavailable);
      }
    });

    await t.test('real calendars separate invalid/unknown dates and low/leap years without range leakage', async () => {
      const months = await browseMonths(client, viewer, {}, schema);
      assert.ok(months.months.some(row => row.key === '0000-02'));
      assert.ok(months.months.some(row => row.key === '2024-02'));
      assert.ok(!months.months.some(row => ['2026-02', '2026-04'].includes(row.key)));
      const undated = await browsePreview(client, viewer, { month: 'undated' }, schema);
      assert.equal(undated.total, badDates.length);
      assert.deepEqual(undated.items.map(row => row.id).sort(), badDates.map((_, i) => `undated-${i}`).sort());
      const range = { dateFrom: '2026-09-01', dateTo: '2026-09-30' };
      const filtered = await browseMonths(client, viewer, range, schema);
      assert.deepEqual(filtered.months, [{ key: '2026-09', count: 272 }]);
      assert.equal(filtered.undatedCount, badDates.length, 'legacy unknown-date range semantics retained');
      assert.equal((await browsePreview(client, viewer, { ...range, month: '2026-09' }, schema)).total, 272, 'unknown dates never enter a dated preview');
      assert.equal((await browsePreview(client, viewer, { month: '2026-09', search: 'da lat literal %_' }, schema)).total, 272, 'real search corpus folding and literal wildcard match');
      assert.equal((await browsePreview(client, viewer, { month: '2026-09', search: 'does-not-match' }, schema)).total, 0);
      await assert.rejects(seek(viewer, { target: { ownerId: owner, id: 'august' }, ...range }), unavailable);
    });

    for (const sortDirection of ['newest', 'oldest']) {
      await t.test(`${sortDirection}: every dense preview page, reverse traversal, composite tie identities and cursor bindings`, async () => {
        const body = { month: '2026-09', sortDirection, limit: 24 };
        const pages = [];
        let page = await browsePreview(client, viewer, body, schema);
        assert.equal(page.previousCursor, null);
        do {
          pages.push(page);
          assert.ok(page.items.length <= 24);
          assert.equal(page.total, 272);
          assert.ok(page.items.every(row => row.excerpt.length <= 200 && !('description' in row) && row.thumbUrl === null));
          if (!page.nextCursor) break;
          assert.ok(pages.length < 20, 'pagination must terminate');
          page = await browsePreview(client, viewer, { ...body, cursor: page.nextCursor }, schema);
        } while (true);
        const flat = pages.flatMap(row => row.items);
        assert.equal(flat.length, 272);
        assert.equal(new Set(identities(flat)).size, 272, 'no duplicate or skipped composite identity');
        assert.deepEqual(new Set(identities(flat)), new Set(visible.filter(row => row.document.date === '2026-09-15').map(identity)));
        assert.equal(flat.filter(row => row.id === 'collision').length, 2);
        for (let i = pages.length - 1; i > 0; i--) {
          const previous = await browsePreview(client, viewer, { ...body, cursor: pages[i].previousCursor, navigation: 'previous' }, schema);
          assert.deepEqual(previous.items, pages[i - 1].items, 'previous refetch exactly restores preceding page');
        }
        const cursor = pages[0].nextCursor;
        for (const [user, changes] of [[editor, {}], [viewer, { month: '2026-08' }], [viewer, { search: 'changed' }], [viewer, { navigation: 'previous' }], [viewer, { sortDirection: sortDirection === 'newest' ? 'oldest' : 'newest' }]]) {
          await assert.rejects(browsePreview(client, user, { ...body, ...changes, cursor }, schema), badCursor);
        }
        await assert.rejects(browsePreview(client, viewer, { ...body, cursor: cursor.slice(0, -8) + 'tampered' }, schema), badCursor);
      });

      await t.test(`${sortDirection}: month metadata keyset next/previous and year selection`, async () => {
        const all = await browseMonths(client, viewer, { sortDirection }, schema);
        const first = await browseMonths(client, viewer, { sortDirection, limit: 2 }, schema);
        const second = await browseMonths(client, viewer, { sortDirection, limit: 2, cursor: first.nextCursor }, schema);
        const previous = await browseMonths(client, viewer, { sortDirection, limit: 2, cursor: second.previousCursor, navigation: 'previous' }, schema);
        assert.deepEqual(previous.months, first.months);
        assert.deepEqual([...first.months, ...second.months], all.months.slice(0, 4));
        assert.deepEqual((await browseMonths(client, viewer, { sortDirection, year: '2025' }, schema)).months, [{ key: '2025-12', count: 1 }]);
        assert.equal(all.years.find(row => row.year === '2026').count, 274);
      });

      await t.test(`${sortDirection}: seek first/middle/last, far (>200) targets, month boundaries and bidirectional feed continuity`, async () => {
        const all = [];
        let current = await feed(viewer, { sortDirection, limit: 40 });
        while (true) {
          all.push(...current.moments);
          if (!current.nextCursor) break;
          assert.ok(all.length < 1000);
          current = await feed(viewer, { sortDirection, limit: 40, cursor: current.nextCursor });
        }
        assert.equal(all.length, visible.length);
        assert.equal(new Set(identities(all)).size, visible.length);
        for (const index of [0, 137, 240, all.length - 1]) {
          const target = { ownerId: all[index].resourceOwnerId, id: all[index].id };
          const landed = await seek(viewer, { target, sortDirection, limit: 24 });
          assert.deepEqual(landed.target, target);
          assert.equal(landed.total, visible.length, 'seek does not shrink scope into a target filter');
          assert.deepEqual(identities(landed.moments), identities(all.slice(index, index + 24)));
          assert.equal(Boolean(landed.previousCursor), index > 0, 'exact first boundary');
          assert.equal(Boolean(landed.nextCursor), index + 24 < all.length, 'exact final boundary');
          if (landed.previousCursor) {
            const previous = await feed(viewer, { sortDirection, limit: 24, cursor: landed.previousCursor, navigation: 'previous' });
            assert.deepEqual(identities(previous.moments), identities(all.slice(Math.max(0, index - 24), index)));
            const forward = await feed(viewer, { sortDirection, limit: 24, cursor: previous.nextCursor });
            assert.deepEqual(identities(forward.moments), identities(landed.moments));
          }
        }
        for (const month of ['2026-09', '2026-08', 'undated']) {
          const preview = await browsePreview(client, viewer, { month, sortDirection }, schema);
          const landed = await seek(viewer, { target: { month }, sortDirection });
          assert.equal(identity(landed.moments[0]), identity(preview.items[0]), 'month resolves first item in active sort');
          const index = all.findIndex(row => identity(row) === identity(landed.moments[0]));
          assert.deepEqual(identities(landed.moments), identities(all.slice(index, index + 40)), 'feed crosses month boundaries without becoming a month filter');
        }
        for (const resourceOwner of [owner, otherOwner]) {
          const landed = await seek(viewer, { target: { ownerId: resourceOwner, id: 'collision' }, sortDirection });
          assert.equal(identity(landed.moments[0]), `${resourceOwner}:collision`);
        }
        await assert.rejects(seek(viewer, { target: { ownerId: unrelated, id: 'collision' }, sortDirection }), unavailable);
        await assert.rejects(seek(viewer, { target: { month: '2026-07' }, sortDirection }), unavailable);
      });
    }

    await t.test('revocation removes months/preview/seek immediately and reauthorizes existing page cursors', async () => {
      const preview = await browsePreview(client, viewer, { month: '2026-09' }, schema);
      const feedPage = await feed(viewer);
      await client.query(`UPDATE ${schema}.track_collaborators SET revoked_at=now() WHERE recipient_id=$1 AND owner_id=ANY($2::uuid[]) AND track_id=$3`, [viewer, [owner, otherOwner], shared]);
      assert.deepEqual((await browseMonths(client, viewer, {}, schema)).months, []);
      assert.equal((await browseMonths(client, viewer, {}, schema)).undatedCount, 0);
      assert.equal((await browsePreview(client, viewer, { month: '2026-09', cursor: preview.nextCursor }, schema)).total, 0);
      assert.deepEqual((await feed(viewer, { cursor: feedPage.nextCursor })).moments, []);
      await assert.rejects(seek(viewer, { target: { ownerId: owner, id: 'collision' } }), unavailable);
      await assert.rejects(seek(viewer, { target: { month: 'undated' } }), unavailable);
      assert.equal((await browsePreview(client, editor, { month: '2026-09' }, schema)).total, 271, 'unrevoked editor unaffected');
    });
    t.diagnostic(`${documents.length} real DEV fixture moments; 272 tied September identities; both sorts and all permission states exercised`);
  } finally {
    try {
      if (transactionStarted) await client.query('ROLLBACK');
      // Rollback is the cleanup, including partial inserts or failed assertions.
      const residue = await client.query(`SELECT (SELECT count(*) FROM ${schema}.users WHERE id=ANY($1::uuid[]))::int AS users,(SELECT count(*) FROM ${schema}.tracks WHERE owner_id=ANY($1::uuid[]))::int AS tracks,(SELECT count(*) FROM ${schema}.moments WHERE owner_id=ANY($1::uuid[]))::int AS moments`, [users]);
      assert.deepEqual(residue.rows[0], { users: 0, tracks: 0, moments: 0 }, 'all temporary real-schema fixtures cleaned in finally');
      t.diagnostic('finally rollback verified: 0 fixture users, tracks, moments remain');
    } finally {
      client.release();
      await pool.end();
    }
  }
});
