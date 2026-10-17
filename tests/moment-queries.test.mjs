import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_FILE || '.env.local' });

const { sqlFold, foldNeedle, encodeCursor, decodeCursor, scopeHash, validateQueryRequest, queryMoments, queryFacets, DEFAULT_LIMIT, MAX_LIMIT } = await import('../moment-queries.mjs');
const { foldSearchText, EMPTY_FILTERS, compareMoments } = await import('../src/lib/momentFilters.ts');

const UUID = () => crypto.randomUUID();

test('calendar validation rejects impossible today before querying and preserves leap centuries', async () => {
  const { resurfacingCandidates, isCalendarDate } = await import('../moment-queries.mjs');
  const client = { query() { throw new Error('invalid date reached database'); } };
  for (const today of ['2026-02-29', '2024-02-30', '1900-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '2026-01-00', 'garbage', null, 20260410]) {
    assert.equal(isCalendarDate(today), false);
    await assert.rejects(resurfacingCandidates(client, UUID(), today, 'pg_temp'), error => error.status === 400);
  }
  for (const today of ['2024-02-29', '2000-02-29', '0000-02-29', '0096-02-29', '2026-04-30']) {
    assert.equal(isCalendarDate(today), true, today);
    assert.equal(validateQueryRequest({ dateFrom: today }, UUID()).filters.dateFrom, today);
  }
  assert.throws(() => validateQueryRequest({ dateFrom: '0100-02-29' }, UUID()), /real calendar date/);
});

test('dense matching patterns stay <=8 per composite track with exact selector and calendar overview parity', { timeout: 180000 }, async t => {
  if (process.env.RUN_INTEGRATION !== '1') return t.skip('Set RUN_INTEGRATION=1 for dense SQL parity');
  const pg = (await import('pg')).default;
  const { resurfacingCandidates, overviewMoments, sqlCalendarDate, isCalendarDate } = await import('../moment-queries.mjs');
  const { selectResurfacedMemories } = await import('../src/lib/memoryResurfacing.ts');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  const owners = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
  const user = owners[0];
  const tracks = owners.flatMap(resourceOwnerId => ['same-track', 'second-track'].map(id => ({ id, resourceOwnerId })));
  const documents = [];
  const push = (owner, eventId, id, date, isMilestone = false) => documents.push({ owner, document: { id, eventId, date, isMilestone, tags: [] } });
  // Same IDs and track IDs across owners, with mixed case/punctuation to expose
  // locale ordering. Thousands match BOTH calendar ranks, not off-pattern noise.
  for (const track of tracks) {
    push(track.resourceOwnerId, track.id, `${track.id}-first`, '1900-01-01');
    push(track.resourceOwnerId, track.id, `${track.id}-milestone`, '2000-02-29', true);
    for (let index = 0; index < 2000; index += 1) {
      const id = `${track.id}-${['A', 'a', '_', 'Z'][index % 4]}-${String(index).padStart(5, '0')}`;
      push(track.resourceOwnerId, track.id, `${id}-ann`, index % 2 ? '2025-04-10' : '2020-04-10');
      push(track.resourceOwnerId, track.id, `${id}-month`, '2025-04-01');
    }
  }
  const invalidDates = ['', 'bad', 'abcd-ef-gh', '0001-00-01', '9999-99-99', '2025-02-29', '1900-02-29', '2026-04-31', '2024-02-30', '2026-04-10T12:00:00Z', null];
  invalidDates.forEach((date, index) => push(user, 'invalid-only', `invalid-${index}`, date, true));
  push(user, 'leap-track', 'valid-leap', '2024-02-29');
  push(user, 'leap-track', 'valid-century', '2000-02-29');
  push(user, 'leap-track', 'valid-low-year', '0000-02-29');
  push(user, 'leap-track', 'valid-0096', '0096-02-29');
  push(user, 'leap-track', 'future', '2099-04-10');
  const accessibleTracks = [...tracks, { id: 'invalid-only', resourceOwnerId: user }, { id: 'leap-track', resourceOwnerId: user }];
  try {
    await client.query('BEGIN');
    // Transaction-scoped synthetic metadata only. Production tables untouched.
    await client.query(`CREATE TEMP TABLE moments(owner_id uuid, id text, event_id text, document jsonb, version int DEFAULT 1) ON COMMIT DROP;
      CREATE TEMP TABLE track_collaborators(owner_id uuid, track_id text, recipient_id uuid, accepted_at timestamptz, revoked_at timestamptz) ON COMMIT DROP;
      CREATE TEMP TABLE images(owner_id uuid, moment_id text, id text) ON COMMIT DROP`);
    await client.query(`INSERT INTO pg_temp.track_collaborators VALUES ($1, 'same-track', $2, now(), null), ($1, 'second-track', $2, now(), null)`, [owners[1], user]);
    await client.query(`INSERT INTO pg_temp.moments(owner_id,id,event_id,document)
      SELECT (v->>'owner')::uuid, v->'document'->>'id', v->'document'->>'eventId', v->'document'
      FROM jsonb_array_elements($1::jsonb) v`, [JSON.stringify(documents)]);
    const all = documents.map(({ owner, document }) => ({ ...document, resourceOwnerId: owner }));
    let maximumPool = 0;
    for (const today of ['2026-04-10', '2026-04-11', '2026-01-15', '2024-02-29', '2026-02-28', '0000-02-29', '0096-02-29']) {
      const rows = await resurfacingCandidates(client, user, today, 'pg_temp');
      // Four tracks covers distinct-track preference; one and two cover the
      // fill pass; recent/stale visits exercise rank-3 suppression/reasons.
      for (const count of [1, 2, 4, accessibleTracks.length]) {
        const scope = accessibleTracks.slice(0, count);
        for (const visits of [[], scope.map(track => ({ trackOwnerId: track.resourceOwnerId, trackId: track.id, lastOpenedAt: today })), scope.map(track => ({ trackOwnerId: track.resourceOwnerId, trackId: track.id, lastOpenedAt: '2001-01-01' }))]) {
          assert.ok(rows.length <= 8 * accessibleTracks.length, `${rows.length} <= 8T`);
          maximumPool = Math.max(maximumPool, rows.length);
          const counts = new Map();
          rows.forEach(row => {
            const key = `${row.owner_id}:${row.event_id}`;
            counts.set(key, (counts.get(key) || 0) + 1);
            assert.ok(isCalendarDate(row.document.date));
          });
          assert.ok([...counts.values()].every(count => count <= 8), 'per-track bound, not merely global');
          const events = rows.map(row => ({ ...row.document, resourceOwnerId: row.owner_id }));
          for (const limit of [1, 2, 3]) {
            assert.deepEqual(selectResurfacedMemories({ events, tracks: scope, visits, today, limit }),
              selectResurfacedMemories({ events: all, tracks: scope, visits, today, limit }), `${today}, ${count} tracks, limit ${limit}`);
          }
        }
      }
    }
    const overview = await overviewMoments(client, user, 'pg_temp');
    const dates = all.map(row => row.date).filter(isCalendarDate).sort();
    assert.equal(overview.total, all.length, 'malformed dates do not erase countable memories');
    assert.equal(overview.earliest, dates[0]);
    assert.equal(overview.latest, dates.at(-1));
    assert.deepEqual(overview.years, [...new Set(dates.map(date => date.slice(0, 4)))].sort().reverse());
    for (const track of overview.tracks) {
      const expected = all.filter(row => row.resourceOwnerId === track.trackOwnerId && row.eventId === track.trackId).map(row => row.date).filter(isCalendarDate).sort();
      assert.equal(track.minDate, expected[0] || null);
      assert.equal(track.maxDate, expected.at(-1) || null);
    }
    const samples = [...invalidDates, '0000-02-29', '0096-02-29', '0100-02-29', '2000-02-29', '2024-02-29'];
    const guarded = await client.query(`SELECT v, ${sqlCalendarDate('v')} AS valid FROM unnest($1::text[]) v`, [samples]);
    guarded.rows.forEach(row => assert.equal(row.valid, isCalendarDate(row.v), `SQL calendar parity: ${row.v}`));
    // Real reduced database scopes ensure the fill pass cannot accidentally
    // rely on representatives belonging to excluded tracks.
    await client.query(`DELETE FROM pg_temp.moments WHERE event_id <> 'same-track' OR owner_id <> $1`, [user]);
    const reduced = all.filter(row => row.eventId === 'same-track' && row.resourceOwnerId === user);
    const rows = await resurfacingCandidates(client, user, '2026-04-10', 'pg_temp');
    assert.ok(rows.length <= 8);
    assert.deepEqual(selectResurfacedMemories({ events: rows.map(row => ({ ...row.document, resourceOwnerId: row.owner_id })), tracks: accessibleTracks, visits: [], today: '2026-04-10' }), selectResurfacedMemories({ events: reduced, tracks: accessibleTracks, visits: [], today: '2026-04-10' }));
    t.diagnostic(`${all.length} synthetic rows (16000 calendar matches), maximum candidate rows ${maximumPool}; <=8 per owner/track before enrichment`);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});

test('the SQL fold and the client fold agree on Vietnamese, emoji and whitespace', async t => {
  if (process.env.RUN_INTEGRATION !== '1') return t.skip('Set RUN_INTEGRATION=1 for DB-backed fold parity');
  // A dedicated pool: the app's shared pool must not be closed here, or every
  // later test in this file would hang on a dead pool.
  const pg = (await import('pg')).default;
  const dotenvDone = process.env.DATABASE_URL;
  if (!dotenvDone) return t.skip('DATABASE_URL is required for fold parity');
  const pool = new pg.Pool({ connectionString: dotenvDone, max: 2 });
  const samples = [
    'Đà Lạt', 'đà nẵng', 'BUỔI HẸN 🎉 VUI', 'nhiều   khoảng   trắng',
    'Tiệc mừng', 'Tiệc mừng'.normalize('NFD'),
    'Ăn ơi', 'Êyyy', 'Ơi trời', 'Ưu tiên', 'Ỳ ạ', 'Ữ ự', 'Đ ơ ớ',
    '', '   ', 'abc', '2026-04-10', '❤️ ✨ 🙌',
  ];
  try {
    for (const sample of samples) {
      const { rows } = await pool.query(`SELECT ${sqlFold('$1')} AS folded`, [sample]);
      assert.equal(rows[0].folded, foldSearchText(sample), `SQL fold matches the client fold for ${JSON.stringify(sample)}; sql=${JSON.stringify(rows[0].folded)} js=${JSON.stringify(foldSearchText(sample))} db=${pool.options?.connectionString?.slice(0, 40)}`);
    }
    t.diagnostic(`fold parity verified for ${samples.length} samples`);
  } finally {
    await pool.end();
  }
});

test('the needle fold matches the client fold', () => {
  for (const sample of ['Đà Lạt', 'da lat', 'BUỔI HẸN', 'nhiều   khoảng', 'Tiệc mừng'.normalize('NFD'), '']) {
    assert.equal(foldNeedle(sample), foldSearchText(sample), `needle fold matches for ${JSON.stringify(sample)}`);
  }
});

test('a cursor round-trips and refuses an incompatible scope', () => {
  const tuple = { date: '2026-04-10', time: '09:00', ownerId: UUID(), id: 'm1', direction: 'newest', scope: 'abc123' };
  const cursor = encodeCursor(tuple);
  assert.deepEqual(decodeCursor(cursor, 'abc123'), tuple);
  assert.equal(decodeCursor(null, 'abc123'), null, 'no cursor is a first page');
  assert.equal(decodeCursor('', 'abc123'), null);
  assert.equal(decodeCursor(cursor, 'different'), undefined, 'a cursor from another filter set is rejected, never reused');
  assert.equal(decodeCursor('!!!not base64!!!', 'abc123'), undefined, 'malformed is a 400, not a guess');
  assert.equal(decodeCursor(Buffer.from('{"date":"x"}').toString('base64url'), 'abc123'), undefined, 'a partial tuple is rejected');
  assert.equal(decodeCursor(encodeCursor({ ...tuple, ownerId: 'not-a-uuid' }), 'abc123'), undefined, 'a non-uuid owner is rejected');
  assert.equal(decodeCursor(encodeCursor({ ...tuple, direction: 'sideways' }), 'abc123'), undefined, 'an unknown direction is rejected');
  assert.equal(decodeCursor(encodeCursor({ ...tuple, id: '' }), 'abc123'), undefined, 'an empty id is rejected');
});

test('the scope hash covers every decision that decides eligibility', () => {
  const base = { ...EMPTY_FILTERS };
  const hash = scopeHash(base, 'newest', 'U');
  assert.equal(scopeHash(base, 'newest', 'U'), hash, 'deterministic for the same input');
  assert.notEqual(scopeHash(base, 'oldest', 'U'), hash, 'direction is part of the scope');
  assert.notEqual(scopeHash(base, 'newest', 'V'), hash, 'the caller is part of the scope');
  assert.notEqual(scopeHash({ ...base, search: 'đà' }, 'newest', 'U'), hash);
  assert.notEqual(scopeHash({ ...base, dateFrom: '2026-01-01' }, 'newest', 'U'), hash);
  assert.notEqual(scopeHash({ ...base, selectedTags: ['a'] }, 'newest', 'U'), hash);
  assert.notEqual(scopeHash({ ...base, selectedTags: ['a', 'b'] }, 'newest', 'U'), hash, 'the tag set matters');
  assert.notEqual(scopeHash({ ...base, savedOnly: true }, 'newest', 'U'), hash, 'the saved filter is part of the scope');
  assert.notEqual(scopeHash({ ...base, trackKey: { ownerId: UUID(), id: 't' } }, 'newest', 'U'), hash, 'the focused track is part of the scope');
  // Tag order is cosmetic, exactly as it is in the client comparison.
  assert.equal(scopeHash({ ...base, selectedTags: ['b', 'a'] }, 'newest', 'U'), scopeHash({ ...base, selectedTags: ['a', 'b'] }, 'newest', 'U'));
});

test('request validation bounds the page and rejects malformed input', () => {
  const userId = UUID();
  const ok = validateQueryRequest({}, userId);
  assert.equal(ok.limit, DEFAULT_LIMIT, 'a bounded default');
  assert.equal(ok.direction, 'newest');
  assert.deepEqual(ok.filters.selectedTags, []);

  assert.equal(validateQueryRequest({ limit: MAX_LIMIT }, userId).limit, MAX_LIMIT);
  assert.throws(() => validateQueryRequest({ limit: MAX_LIMIT + 1 }, userId), /limit must be an integer/);
  assert.throws(() => validateQueryRequest({ limit: 0 }, userId), /limit must be an integer/);
  assert.throws(() => validateQueryRequest({ limit: 1.5 }, userId), /limit must be an integer/);
  assert.throws(() => validateQueryRequest({ limit: 'lots' }, userId), /limit must be an integer/);
  assert.throws(() => validateQueryRequest({ sortDirection: 'sideways' }, userId), /sortDirection/);
  assert.throws(() => validateQueryRequest({ sortBy: 'title' }, userId), /sortBy/);
  assert.throws(() => validateQueryRequest({ search: 'x'.repeat(501) }, userId), /search/);
  assert.throws(() => validateQueryRequest({ selectedYear: '202' }, userId), /selectedYear/);
  assert.throws(() => validateQueryRequest({ dateFrom: '2026-02-30' }, userId), /real calendar date/);
  assert.throws(() => validateQueryRequest({ dateFrom: '2026-05-01', dateTo: '2026-04-30' }, userId), /must not be after/);
  assert.throws(() => validateQueryRequest({ selectedTags: [''] }, userId), /selectedTags/);
  assert.throws(() => validateQueryRequest({ selectedTags: ['x'.repeat(129)] }, userId), /selectedTags/);
  assert.throws(() => validateQueryRequest({ milestonesOnly: 'yes' }, userId), /booleans/);
  assert.throws(() => validateQueryRequest({ trackKey: 'nonsense' }, userId), /composite/);
  assert.throws(() => validateQueryRequest({ includeTotal: 'yes' }, userId), /booleans/);

  // A range and a year can never combine into an empty result.
  const withRange = validateQueryRequest({ selectedYear: '2024', dateFrom: '2026-01-01' }, userId);
  assert.equal(withRange.filters.selectedYear, 'all', 'entering a range clears the year');
  const withYear = validateQueryRequest({ selectedYear: '2024' }, userId);
  assert.equal(withYear.filters.selectedYear, '2024');
  // Duplicate tags collapse rather than widening the query.
  assert.deepEqual(validateQueryRequest({ selectedTags: ['a', 'a', 'b'] }, userId).filters.selectedTags, ['a', 'b']);
});

test('a valid request normalizes into one documented shape', () => {
  const request = validateQueryRequest({
    search: 'Đà Lạt', selectedYear: '2026', selectedTags: ['a'], selectedEmotions: ['joyful'],
    milestonesOnly: true, hasImagesOnly: true, limit: 25, sortDirection: 'oldest', includeTotal: true,
  }, 'U');
  assert.equal(request.limit, 25);
  assert.equal(request.direction, 'oldest');
  assert.equal(request.filters.search, 'Đà Lạt', 'display text is preserved; folding happens at comparison time');
  assert.equal(request.includeTotal, true);
  assert.equal(request.includeFacets, false);
});

test('a fixed dataset pages exactly, with no overlap and no gap', { timeout: 180000 }, async t => {
  if (process.env.RUN_INTEGRATION !== '1') return t.skip('Set RUN_INTEGRATION=1 for DB-backed pagination');
  const { app } = await import('../server.mjs');
  const { pool, createInvite, qschema } = await import('../memento-db.mjs');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { method = 'GET', token, body } = {}) {
    const headers = {};
    if (token) headers.Cookie = `memento_session=${token}`;
    if (method !== 'GET') { headers.Origin = base; headers['Content-Type'] = 'application/json'; }
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const type = res.headers.get('content-type') || '';
    return { res, data: type.includes('application/json') ? await res.json() : await res.text() };
  }
  const username = `mq_${UUID().replaceAll('-', '').slice(0, 18)}`;
  const registered = await request('/api/auth/register', { method: 'POST', body: { username, password: 'a-very-long-test-password-1', inviteCode: await createInvite(1) } });
  assert.equal(registered.res.status, 200);
  const token = registered.res.headers.get('set-cookie').match(/memento_session=([^;]+)/)[1];
  const userId = registered.data.user.id;
  const created = [];
  try {
    const track = await request('/api/tracks', { method: 'POST', token, body: { title: 'Query track', description: '', color: 'indigo', icon: 'Heart', tags: [] } });
    const trackId = track.data.track.id;
    // Deterministic, deliberately colliding sort keys: same day, some with no
    // time, one malformed date. Ordering must still be total and stable.
    const specs = [
      { id: 'q-01', date: '2026-04-10', time: '09:00', title: 'Đà Lạt sáng' },
      { id: 'q-02', date: '2026-04-10', time: '09:00', title: 'Đà Lạt chiều' },
      { id: 'q-03', date: '2026-04-10', title: 'Không giờ' },
      { id: 'q-04', date: '2026-04-11', time: '08:00', title: 'Sáng sớm' },
      // A pre-validation row: the write path now rejects this, but such rows
      // can still exist, so ordering must cope rather than crash or hide it.
      { id: 'q-05', date: 'legacy-shape', title: 'Ngày hỏng', legacy: true },
      { id: 'q-06', date: '2026-04-09', time: '23:59', title: 'Cuối ngày' },
      { id: 'q-07', date: '2026-04-10', time: '10:00', title: 'Trưa' },
    ];
    for (const spec of specs) {
      const moment = await request('/api/moments', { method: 'POST', token, body: { id: spec.id, eventId: trackId, eventOwnerId: userId, title: spec.title, date: spec.date, ...(spec.time ? { time: spec.time } : {}), description: 'x', tags: [], images: [] } });
      if (spec.legacy) continue; // inserted below, directly, as a legacy row
      assert.equal(moment.res.status, 201, `moment ${spec.id} created: ${JSON.stringify(moment.data).slice(0, 200)}`);
      created.push(spec.id);
    }
    // Insert the legacy-shaped row directly: it predates validation, and the
    // ordering contract has to hold for it rather than assume it cannot exist.
    await pool.query(
      `INSERT INTO ${qschema}.moments(owner_id, id, event_id, document) VALUES ($1,$2,$3,$4)`,
      [userId, 'q-05', trackId, { id: 'q-05', eventId: trackId, title: 'Ngày hỏng', date: 'legacy-shape', description: 'x', tags: [], images: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    );
    created.push('q-05');
    // Page through with a limit smaller than the set, both directions.
    for (const direction of ['newest', 'oldest']) {
      const seen = [];
      let cursor = null;
      let pages = 0;
      do {
        const page = await request('/api/moments/query', { method: 'POST', token, body: { limit: 2, sortDirection: direction, cursor, includeTotal: true } });
        assert.equal(page.res.status, 200, `page ${pages} in ${direction}; body=${JSON.stringify(page.data).slice(0, 400)}`);
        const identities = page.data.moments.map(m => `${m.resourceOwnerId}:${m.id}`);
        // No moment may appear twice across pages.
        assert.equal(new Set(seen.concat(identities)).size, seen.length + identities.length, `no duplicates across pages in ${direction}`);
        seen.push(...identities);
        cursor = page.data.nextCursor;
        pages += 1;
        assert.ok(pages < 20, 'pagination terminates');
      } while (cursor);
      assert.equal(seen.length, specs.length, `every memory is reachable in ${direction}`);
    }
    // Fixed-data exactness, and the contract that actually matters: the server
    // order must equal the order the client computes with compareMoments over
    // the same set, in both directions. A malformed date sorts to the sentinel
    // end, so it leads the descending page and trails the ascending one.
    const expected = specs.map(spec => ({
      date: /^\d{4}-\d{2}-\d{2}$/.test(spec.date) ? spec.date : '9999-99-99',
      time: /^\d{2}:\d{2}$/.test(spec.time ?? '') ? spec.time : '99:99',
      resourceOwnerId: userId,
      id: spec.id,
    }));
    for (const direction of ['newest', 'oldest']) {
      const page = await request('/api/moments/query', { method: 'POST', token, body: { limit: specs.length, sortDirection: direction } });
      const clientOrder = [...expected].sort((a, b) => compareMoments(a, b, direction)).map(m => m.id);
      assert.deepEqual(page.data.moments.map(m => m.id), clientOrder, `server order equals the client order for ${direction}`);
    }
    const newest = await request('/api/moments/query', { method: 'POST', token, body: { limit: 3, sortDirection: 'newest', includeTotal: true } });
    assert.deepEqual(newest.data.moments.map(m => m.id).slice(0, 3), ['q-05', 'q-04', 'q-03'], 'descending: sentinel first, then the latest day, then an untimed entry before a timed one');
    assert.ok(newest.data.nextCursor, 'more pages exist');
    const oldest = await request('/api/moments/query', { method: 'POST', token, body: { limit: 3, sortDirection: 'oldest' } });
    assert.deepEqual(oldest.data.moments.map(m => m.id).slice(0, 2), ['q-06', 'q-01'], 'ascending starts at the earliest day, tie broken by id');
    const oldestAll = await request('/api/moments/query', { method: 'POST', token, body: { limit: specs.length, sortDirection: 'oldest' } });
    assert.equal(oldestAll.data.moments.at(-1).id, 'q-05', 'a malformed date sorts last in ascending order');
    // Total matches what paging actually returns.
    assert.equal(newest.data.total, specs.length, 'the reported total equals the paged count');
    // A cursor from one page never replays against a different filter set.
    const cursor = newest.data.nextCursor;
    const incompatible = await request('/api/moments/query', { method: 'POST', token, body: { limit: 3, sortDirection: 'newest', cursor, search: 'đà' } });
    assert.equal(incompatible.res.status, 400, 'a cursor from another scope is rejected');
    const wrongDirection = await request('/api/moments/query', { method: 'POST', token, body: { limit: 3, sortDirection: 'oldest', cursor } });
    assert.equal(wrongDirection.res.status, 400, 'a cursor from another direction is rejected');
    // Bounded: the request never returns more than the limit.
    const bounded = await request('/api/moments/query', { method: 'POST', token, body: { limit: 2 } });
    assert.ok(bounded.data.moments.length <= 2, 'never more than the limit');
  } finally {
    await pool.query(`DELETE FROM ${qschema}.moments WHERE owner_id=$1`, [userId]).catch(() => {});
    await pool.query(`DELETE FROM ${qschema}.tracks WHERE owner_id=$1`, [userId]).catch(() => {});
    await pool.query(`DELETE FROM ${qschema}.users WHERE id=$1`, [userId]).catch(() => {});
    server.close();
  }
});

test('search, filters and authorization scope behave exactly as the client does', { timeout: 180000 }, async t => {
  if (process.env.RUN_INTEGRATION !== '1') return t.skip('Set RUN_INTEGRATION=1 for DB-backed query semantics');
  const { app } = await import('../server.mjs');
  const { pool, createInvite, qschema } = await import('../memento-db.mjs');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { method = 'GET', token, body } = {}) {
    const headers = {};
    if (token) headers.Cookie = `memento_session=${token}`;
    if (method !== 'GET') { headers.Origin = base; headers['Content-Type'] = 'application/json'; }
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const type = res.headers.get('content-type') || '';
    return { res, data: type.includes('application/json') ? await res.json() : await res.text() };
  }
  async function register(prefix) {
    const uname = `${prefix}_${UUID().replaceAll('-', '').slice(0, 18)}`;
    const r = await request('/api/auth/register', { method: 'POST', body: { username: uname, password: 'a-very-long-test-password-1', inviteCode: await createInvite(1) } });
    assert.equal(r.res.status, 200);
    return { id: r.data.user.id, username: uname, token: r.res.headers.get('set-cookie').match(/memento_session=([^;]+)/)[1] };
  }
  const owner = await register('mqo');
  const viewer = await register('mqv');
  let trackId;
  try {
    const track = await request('/api/tracks', { method: 'POST', token: owner.token, body: { title: 'Semantics', description: '', color: 'indigo', icon: 'Heart', tags: [] } });
    trackId = track.data.track.id;
    await request('/api/moments', { method: 'POST', token: owner.token, body: { id: 's-1', eventId: trackId, eventOwnerId: owner.id, title: 'Đà Lạt mùa sương', date: '2026-05-04', description: 'Buổi sáng trên đồi', tags: ['du lịch'], images: [] } });
    await request('/api/moments', { method: 'POST', token: owner.token, body: { id: 's-2', eventId: trackId, eventOwnerId: owner.id, title: 'Huế mưa', date: '2025-01-02', description: 'Kinh thành', tags: ['lịch sử'], isMilestone: true, images: [] } });
    const query = (token, body) => request('/api/moments/query', { method: 'POST', token, body });
    const ids = (result) => {
      assert.equal(result.res.status, 200, `query succeeded; body=${JSON.stringify(result.data).slice(0, 300)}`);
      return result.data.moments.map(m => m.id).sort();
    };

    // Diacritic- and case-insensitive search, matching the client fold.
    assert.deepEqual(ids(await query(owner.token, { search: 'da lat' })), ['s-1'], 'a plain-d search finds the Vietnamese memory');
    assert.deepEqual(ids(await query(owner.token, { search: 'DA LAT' })), ['s-1'], 'case folding survives the đ mapping');
    assert.deepEqual(ids(await query(owner.token, { search: 'sương' })), ['s-1'], 'a partial diacritic needle matches');
    assert.deepEqual(ids(await query(owner.token, { search: 'kinh thanh' })), ['s-2'], 'the story field is searchable');
    assert.deepEqual(ids(await query(owner.token, { search: 'lịch sử' })), ['s-2'], 'tags are searchable');
    assert.deepEqual(ids(await query(owner.token, { search: 'huế' })), ['s-2']);
    assert.deepEqual(ids(await query(owner.token, { search: 'không có gì' })), [], 'a non-matching needle returns nothing');

    // Range is inclusive on real calendar dates; a malformed date is not hidden.
    assert.deepEqual(ids(await query(owner.token, { dateFrom: '2026-05-04', dateTo: '2026-05-04' })), ['s-1'], 'both bounds are inclusive');
    assert.deepEqual(ids(await query(owner.token, { selectedYear: '2025' })), ['s-2']);

    // Milestones, and a year replacing the range.
    assert.deepEqual(ids(await query(owner.token, { milestonesOnly: true })), ['s-2']);
    assert.equal((await query(owner.token, { selectedYear: '2026', dateFrom: '2025-01-01', includeTotal: true })).data.total, 2, 'entering a range clears the year, so both 2025 and 2026 memories match');

    // Facets agree with the page, and are opt-in.
    const plain = await query(owner.token, {});
    assert.equal(plain.data.total, undefined, 'no total unless asked for');
    const withTotal = await query(owner.token, { includeTotal: true, includeFacets: true });
    assert.equal(withTotal.data.total, 2);
    assert.equal(withTotal.data.facets.milestones, 1, 'the facet matches the filtered page');

    // A viewer sees the shared memory but never the owner's private one.
    const invite = await request(`/api/tracks/${trackId}/collaborators`, { method: 'POST', token: owner.token, body: { username: viewer.username, role: 'viewer' } });
    assert.equal(invite.res.status, 201);
    assert.equal((await request(`/api/collaboration-invitations/${invite.data.collaborator.id}/accept`, { method: 'POST', token: viewer.token })).res.status, 200);
    // Sharing is per track, so an owner-only memory has to live on a track the
    // viewer was never invited to. Anything added to the shared track is
    // visible to the collaborator by design.
    const privateTrack = await request('/api/tracks', { method: 'POST', token: owner.token, body: { title: 'Riêng tư', description: '', color: 'indigo', icon: 'Lock', tags: [] } });
    assert.equal(privateTrack.res.status, 201);
    const second = await request('/api/moments', { method: 'POST', token: owner.token, body: { id: 's-3', eventId: privateTrack.data.track.id, eventOwnerId: owner.id, title: 'Riêng tư', date: '2024-03-03', description: 'chỉ owner', tags: [], images: [] } });
    assert.equal(second.res.status, 201);
    assert.deepEqual(ids(await query(viewer.token, { includeTotal: true })), ['s-1', 's-2'], 'the viewer sees only what was shared, never the owner-only memory');
    assert.equal((await query(viewer.token, { includeTotal: true })).data.total, 2, 'the viewer total excludes the unshared track entirely');

    // Revoking access removes it from both the page and the count.
    assert.equal((await request(`/api/tracks/${trackId}/collaborators/${viewer.id}`, { method: 'DELETE', token: owner.token })).res.status, 200);
    const afterRevoke = await query(viewer.token, { includeTotal: true });
    assert.equal(afterRevoke.data.total, 0, 'the count no longer includes revoked content');
    assert.deepEqual(afterRevoke.data.moments, [], 'and the page is empty');

    // The query is a read: it never waits on an owner mutation lock.
    let releaseLock; const lockGate = new Promise(resolve => { releaseLock = resolve; });
    let signalLock; const lockStarted = new Promise(resolve => { signalLock = resolve; });
    const { transaction } = await import('../mutation-safety.mjs');
    const lock = transaction(pool, async () => { signalLock(); await lockGate; }, owner.id, process.env.DB_SCHEMA);
    await lockStarted;
    let timeout;
    try {
      const race = await Promise.race([
        query(owner.token, { includeTotal: true }),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('the read waited on the owner mutation lock')), 2000); }),
      ]);
      assert.equal(race.data.total, 3, 'the read completed while the owner lock was held');
    } finally { clearTimeout(timeout); releaseLock(); await lock; }

    // An unauthenticated caller is refused.
    assert.equal((await request('/api/moments/query', { method: 'POST', body: {} })).res.status, 401);
  } finally {
    // Deleting the owner cascades their tracks, moments and collaborations.
    await pool.query(`DELETE FROM ${qschema}.users WHERE id IN ($1,$2)`, [owner.id, viewer.id]).catch(() => {});
    await pool.query(`DELETE FROM ${qschema}.users WHERE id IN ($1,$2)`, [owner.id, viewer.id]).catch(() => {});
    server.close();
  }
});

test('overview equals what deriving from the full set would give, across an authorization boundary', { timeout: 180000 }, async t => {
  if (process.env.RUN_INTEGRATION !== '1') return t.skip('Set RUN_INTEGRATION=1 for DB-backed overview');
  const { app } = await import('../server.mjs');
  const { pool, createInvite, qschema } = await import('../memento-db.mjs');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { method = 'GET', token, body } = {}) {
    const headers = {};
    if (token) headers.Cookie = `memento_session=${token}`;
    if (method !== 'GET') { headers.Origin = base; headers['Content-Type'] = 'application/json'; }
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const type = res.headers.get('content-type') || '';
    return { res, data: type.includes('application/json') ? await res.json() : await res.text() };
  }
  async function register(prefix) {
    const uname = `${prefix}_${UUID().replaceAll('-', '').slice(0, 18)}`;
    const r = await request('/api/auth/register', { method: 'POST', body: { username: uname, password: 'a-very-long-test-password-1', inviteCode: await createInvite(1) } });
    assert.equal(r.res.status, 200);
    return { id: r.data.user.id, username: uname, token: r.res.headers.get('set-cookie').match(/memento_session=([^;]+)/)[1] };
  }
  const owner = await register('ovo');
  const viewer = await register('ovv');
  try {
    const track = await request('/api/tracks', { method: 'POST', token: owner.token, body: { title: 'Overview track', description: '', color: 'indigo', icon: 'Heart', tags: [] } });
    const trackId = track.data.track.id;
    const privateTrack = await request('/api/tracks', { method: 'POST', token: owner.token, body: { title: 'Hidden track', description: '', color: 'indigo', icon: 'Lock', tags: [] } });
    const hiddenId = privateTrack.data.track.id;
    const mk = (id, eventId, body) => request('/api/moments', { method: 'POST', token: owner.token, body: { id, eventId, eventOwnerId: owner.id, description: 'x', tags: [], images: [], ...body } });
    assert.equal((await mk('o-1', trackId, { title: 'Đà Lạt', date: '2026-05-04', tags: ['du lịch', 'núi'], location: { city: 'Đà Lạt' } })).res.status, 201);
    assert.equal((await mk('o-2', trackId, { title: 'Huế', date: '2025-01-02', tags: ['du lịch'], isMilestone: true, location: { name: 'Kinh thành' } })).res.status, 201);
    assert.equal((await mk('o-3', hiddenId, { title: 'Riêng', date: '2024-03-03', tags: ['công việc'] })).res.status, 201);

    const overview = await request('/api/moments/overview', { token: owner.token });
    assert.equal(overview.res.status, 200);
    const o = overview.data.overview;
    assert.equal(o.total, 3, 'the owner sees all three');
    assert.equal(o.milestones, 1);
    assert.equal(o.places, 2, 'Đà Lạt city and Kinh thành name, counted once each');
    assert.equal(o.tracks.length, 2, 'both tracks have a row');
    const byTrack = Object.fromEntries(o.tracks.map(r => [r.trackId, r]));
    assert.equal(byTrack[trackId].count, 2);
    assert.equal(byTrack[trackId].milestones, 1);
    assert.equal(byTrack[hiddenId].count, 1);
    assert.deepEqual(o.tags.map(t => t.name).sort(), ['công việc', 'du lịch', 'núi']);
    assert.equal(o.tags.find(t => t.name === 'du lịch').count, 2, 'a shared tag counts both memories');
    assert.deepEqual(o.years, ['2026', '2025', '2024'], 'newest year first');
    assert.equal(o.earliest, '2024-03-03');
    assert.equal(o.latest, '2026-05-04');

    // Parity: deriving the same numbers from the full fetch must agree.
    const full = await request('/api/moments', { token: owner.token });
    const events = full.data.moments;
    assert.equal(events.length, o.total, 'total equals the full-set length');
    assert.equal(events.filter(e => e.isMilestone).length, o.milestones, 'milestones parity');
    assert.equal(events.reduce((acc, e) => acc + (e.images?.length || 0), 0), o.photos, 'photo parity');
    const places = new Set(events.map(e => e.location?.city || e.location?.name).filter(Boolean));
    assert.equal(places.size, o.places, 'unique place parity');
    const tagCounts = {};
    events.forEach(e => (e.tags || []).forEach(tag => { tagCounts[tag] = (tagCounts[tag] || 0) + 1; }));
    assert.deepEqual(Object.fromEntries(o.tags.map(t => [t.name, t.count])), tagCounts, 'tag counts parity');
    const years = new Set();
    events.forEach(e => { if (e.date && e.date.length >= 4) years.add(e.date.substring(0, 4)); });
    assert.deepEqual(o.years, [...years].sort((a, b) => b.localeCompare(a)), 'year list parity');

    // A viewer's overview excludes the unshared track entirely, both the total
    // and the per-track row.
    const invite = await request(`/api/tracks/${trackId}/collaborators`, { method: 'POST', token: owner.token, body: { username: viewer.username, role: 'viewer' } });
    assert.equal(invite.res.status, 201);
    assert.equal((await request(`/api/collaboration-invitations/${invite.data.collaborator.id}/accept`, { method: 'POST', token: viewer.token })).res.status, 200);
    const viewerOverview = await request('/api/moments/overview', { token: viewer.token });
    assert.equal(viewerOverview.data.overview.total, 2, 'the hidden track contributes nothing');
    assert.equal(viewerOverview.data.overview.tracks.length, 1, 'no row for a track the viewer cannot read');
    assert.deepEqual(viewerOverview.data.overview.tags.map(t => t.name).sort(), ['du lịch', 'núi'], 'a private tag never leaks');
    // Revoke and the count drops with it.
    assert.equal((await request(`/api/tracks/${trackId}/collaborators/${viewer.id}`, { method: 'DELETE', token: owner.token })).res.status, 200);
    assert.equal((await request('/api/moments/overview', { token: viewer.token })).data.overview.total, 0, 'authorization is current, not cached');
    // Unauthenticated callers get nothing.
    assert.equal((await request('/api/moments/overview')).res.status, 401);
  } finally {
    await pool.query(`DELETE FROM ${qschema}.users WHERE id IN ($1,$2)`, [owner.id, viewer.id]).catch(() => {});
    server.close();
  }
});

test('the resurfacing pool reaches exactly the same result as running over everything', { timeout: 240000 }, async t => {
  if (process.env.RUN_INTEGRATION !== '1') return t.skip('Set RUN_INTEGRATION=1 for DB-backed resurfacing parity');
  const { app } = await import('../server.mjs');
  const { pool, createInvite, qschema } = await import('../memento-db.mjs');
  const { selectResurfacedMemories } = await import('../src/lib/memoryResurfacing.ts');
  const { resurfacingCandidates } = await import('../moment-queries.mjs');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { method = 'GET', token, body } = {}) {
    const headers = {};
    if (token) headers.Cookie = `memento_session=${token}`;
    if (method !== 'GET') { headers.Origin = base; headers['Content-Type'] = 'application/json'; }
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const type = res.headers.get('content-type') || '';
    return { res, data: type.includes('application/json') ? await res.json() : await res.text() };
  }
  const uname = `rs_${UUID().replaceAll('-', '').slice(0, 18)}`;
  const registered = await request('/api/auth/register', { method: 'POST', body: { username: uname, password: 'a-very-long-test-password-1', inviteCode: await createInvite(1) } });
  assert.equal(registered.res.status, 200);
  const token = registered.res.headers.get('set-cookie').match(/memento_session=([^;]+)/)[1];
  const userId = registered.data.user.id;
  try {
    // Four tracks, many moments, deliberately including cases the selector
    // must ignore: future dates and a malformed date.
    const trackIds = [];
    for (let index = 0; index < 4; index += 1) {
      const track = await request('/api/tracks', { method: 'POST', token, body: { title: `Track ${index}`, description: '', color: 'indigo', icon: 'Heart', tags: [] } });
      assert.equal(track.res.status, 201);
      trackIds.push(track.data.track.id);
    }
    // Fill each track across many months so a "newest page" could never cover
    // the anniversary cases; the pool has to reach back by pattern.
    let created = 0;
    for (const trackId of trackIds) {
      for (let year = 2019; year <= 2026; year += 1) {
        for (const [month, day] of [['04', '10'], ['07', '21'], ['12', '01']]) {
          const id = `r-${trackId.slice(0, 4)}-${year}-${month}${day}`;
          const moment = await request('/api/moments', {
            method: 'POST',
            token,
            body: { id, eventId: trackId, eventOwnerId: userId, title: `Memory ${year}-${month}-${day}`, date: `${year}-${month}-${day}`, description: 'x', tags: [], images: [], ...(day === '10' && month === '04' ? { isMilestone: true } : {}) },
          });
          if (moment.res.status === 201) created += 1;
        }
      }
    }
    // A future memory and a malformed one: both must be invisible to the
    // selector whether they arrive via the full set or the pool.
    const futureTrack = trackIds[0];
    await request('/api/moments', { method: 'POST', token, body: { id: 'r-future', eventId: futureTrack, eventOwnerId: userId, title: 'Future', date: '2099-04-10', description: 'x', tags: [], images: [] } });
    await pool.query(
      `INSERT INTO ${qschema}.moments(owner_id, id, event_id, document) VALUES ($1,$2,$3,$4)`,
      [userId, 'r-broken', futureTrack, { id: 'r-broken', eventId: futureTrack, title: 'Broken', date: 'legacy-shape', description: 'x', tags: [], images: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    ).catch(() => {});

    const tracks = await request('/api/tracks', { token });
    const full = await request('/api/moments', { token });
    const allMoments = full.data.moments;
    assert.ok(allMoments.length >= 90, `a large enough corpus to make a newest-page shortcut impossible, got ${allMoments.length}`);

    const visits = (await request('/api/track-visits', { token })).data.visits;
    // Several injected local dates, including one where an anniversary and a
    // same-month-last-year candidate both exist.
    for (const today of ['2026-04-10', '2026-07-21', '2026-12-01', '2026-01-15', '2027-04-10']) {
      const poolRows = await resurfacingCandidates(pool, userId, today, process.env.DB_SCHEMA);
      const poolMoments = poolRows.map(row => ({ ...row.document, resourceOwnerId: row.owner_id, version: row.version }));
      const expected = selectResurfacedMemories({ events: allMoments, tracks: tracks.data.tracks, visits, today: new Date(`${today}T12:00:00Z`), limit: 3 });
      const actual = selectResurfacedMemories({ events: poolMoments, tracks: tracks.data.tracks, visits, today: new Date(`${today}T12:00:00Z`), limit: 3 });
      assert.deepEqual(actual, expected, `pool-based selection equals full-set selection for ${today}`);
      assert.ok(expected.length > 0 || ['2026-01-15'].includes(today), `something is surfaced for ${today}`);
      // A future and a malformed date never reach a selection.
      for (const chosen of actual) {
        assert.ok(!chosen.momentIdentity.endsWith('r-future'), 'a future memory is never surfaced');
        assert.ok(!chosen.momentIdentity.endsWith('r-broken'), 'a malformed date is never surfaced');
      }
    }

    // Bounded, in the way that actually matters: the pool is a function of the
    // calendar pattern and the track count, not of how many memories exist.
    // Adding memories that do not match the pattern must leave it untouched —
    // otherwise a large account would pay for rediscovery on every scroll.
    const poolBefore = (await resurfacingCandidates(pool, userId, '2026-04-10', process.env.DB_SCHEMA)).length;
    // Past, off-pattern dates: genuinely inside the visible range, so they are
    // counted by the account but cannot become an anniversary or a
    // same-month-last-year hit, are not milestones, and are neither the
    // earliest entry nor the milestone-first representative of their track.
    // Inserted straight into the database rather than through the API: this
    // measures query scope, and doing it over HTTP would trip the abuse
    // budget that exists to protect the real write path — weakening that
    // limit for a test would be the wrong trade.
    const noiseValues = [];
    const noiseParams = [];
    for (let index = 0; index < 60; index += 1) {
      const trackId = trackIds[index % trackIds.length];
      noiseParams.push(userId, `r-noise-${index}`, trackId, JSON.stringify({
        id: `r-noise-${index}`, eventId: trackId, title: `Noise ${index}`,
        date: `2026-03-${String((index % 9) + 1).padStart(2, '0')}`,
        description: 'x', tags: [], images: [],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }));
      // Four params per row, so the row starts one before the last index
      // pushed: owner, id, track, document.
      const offset = noiseParams.length - 3;
      noiseValues.push(`($${offset}, $${offset + 1}, $${offset + 2}, $${offset + 3}::jsonb)`);
    }
    const noiseInsert = await pool.query(
      `INSERT INTO ${qschema}.moments(owner_id, id, event_id, document) VALUES ${noiseValues.join(', ')}`,
      noiseParams,
    );
    assert.equal(noiseInsert.rowCount, 60, 'every off-pattern memory landed');
    created += noiseInsert.rowCount;
    const poolAfter = (await resurfacingCandidates(pool, userId, '2026-04-10', process.env.DB_SCHEMA)).length;
    assert.equal(poolAfter, poolBefore, `60 extra off-pattern memories do not grow the candidate pool (was ${poolBefore}, then ${poolAfter})`);

    const corpusNow = (await request('/api/moments', { token })).data.moments.length;
    assert.ok(corpusNow > allMoments.length, 'the account really did grow');
    // And the selection is still the same after the account grew.
    const tracksAfter = await request('/api/tracks', { token });
    const visitsAfter = (await request('/api/track-visits', { token })).data.visits;
    const fullAfter = await request('/api/moments', { token });
    const grownExpected = selectResurfacedMemories({ events: fullAfter.data.moments, tracks: tracksAfter.data.tracks, visits: visitsAfter, today: new Date('2026-04-10T12:00:00Z'), limit: 3 });
    const grownPool = (await resurfacingCandidates(pool, userId, '2026-04-10', process.env.DB_SCHEMA))
      .map(row => ({ ...row.document, resourceOwnerId: row.owner_id, version: row.version }));
    const grownActual = selectResurfacedMemories({ events: grownPool, tracks: tracksAfter.data.tracks, visits: visitsAfter, today: new Date('2026-04-10T12:00:00Z'), limit: 3 });
    assert.deepEqual(grownActual, grownExpected, 'parity still holds after the account grew');
    t.diagnostic(`corpus ${corpusNow} moments across ${trackIds.length} tracks -> pool of ${poolAfter} (${(poolAfter / corpusNow * 100).toFixed(1)}% of the account), unchanged by 60 added memories`);

    // Unauthenticated callers get nothing.
    assert.equal((await request('/api/moments/resurfacing', { method: 'POST', body: { today: '2026-04-10' } })).res.status, 401);
    // A malformed date is refused rather than interpreted.
    const bad = await request('/api/moments/resurfacing', { method: 'POST', token, body: { today: 'not-a-date' } });
    assert.equal(bad.res.status, 400, `malformed today is refused: ${JSON.stringify(bad.data)}`);
    // Cross-origin is refused, same as every other POST that changes state.
    const cross = await fetch(base + '/api/moments/resurfacing', {
      method: 'POST',
      headers: { Cookie: `memento_session=${token}`, 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ today: '2026-04-10' }),
    });
    assert.equal(cross.status, 403, 'same-origin guard applies to the read body too');
  } finally {
    await pool.query(`DELETE FROM ${qschema}.users WHERE id=$1`, [userId]).catch(() => {});
    server.close();
  }
});
