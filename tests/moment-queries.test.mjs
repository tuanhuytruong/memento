import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_FILE || '.env.local' });

const { sqlFold, foldNeedle, encodeCursor, decodeCursor, scopeHash, validateQueryRequest, queryMoments, queryFacets, DEFAULT_LIMIT, MAX_LIMIT } = await import('../moment-queries.mjs');
const { foldSearchText, EMPTY_FILTERS, compareMoments } = await import('../src/lib/momentFilters.ts');

const UUID = () => crypto.randomUUID();

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
