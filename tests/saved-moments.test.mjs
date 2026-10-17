import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_FILE || '.env.local' });

const { setSaved, listSaved, savedCount, savedIdentities, decodeSavedCursor, savedKey } = await import('../saved-moments.mjs');

/** Records every statement so the desired-state semantics are visible. */
function fakeClient(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      return { rows };
    },
  };
}

test('savedKey is the composite identity, never a bare id', () => {
  assert.equal(savedKey('A', 'm1'), 'A:m1');
  assert.notEqual(savedKey('A', 'm1'), savedKey('B', 'm1'), 'the same id under another owner is a different memory');
});

test('decodeSavedCursor accepts a real cursor and rejects anything else', () => {
  const cursor = { savedAt: '2026-04-10T09:00:00.000Z', ownerId: crypto.randomUUID(), id: 'm1' };
  const encoded = Buffer.from(JSON.stringify(cursor)).toString('base64url');
  assert.deepEqual(decodeSavedCursor(encoded), cursor);
  assert.equal(decodeSavedCursor(null), null, 'no cursor is a first page');
  assert.equal(decodeSavedCursor(''), null);
  assert.equal(decodeSavedCursor('!!!not base64!!!'), undefined, 'malformed is a 400, never a guess');
  assert.equal(decodeSavedCursor(Buffer.from('{"savedAt":"nope","ownerId":"a","id":"b"}').toString('base64url')), undefined, 'an unparsable date is rejected');
  assert.equal(decodeSavedCursor(Buffer.from('{"ownerId":"a","id":"b"}').toString('base64url')), undefined, 'a missing field is rejected');
});

test('saving is an idempotent desired state, not a toggle', async () => {
  const on = fakeClient([{ saved: true }]);
  assert.deepEqual(await setSaved(on, 'U', { ownerId: 'O', id: 'm1' }, true, 'sch'), { ownerId: 'O', id: 'm1', saved: true });
  assert.match(on.calls[0].sql, /^INSERT INTO "sch"\.saved_moments/);
  assert.match(on.calls[0].sql, /ON CONFLICT \(user_id, moment_owner_id, moment_id\) DO NOTHING/);
  assert.deepEqual(on.calls[0].params, ['U', 'O', 'm1']);

  // Saving an already-saved memory issues the same statement and stays saved.
  const again = fakeClient([{ saved: true }]);
  assert.equal((await setSaved(again, 'U', { ownerId: 'O', id: 'm1' }, true, 'sch')).saved, true);

  const off = fakeClient([{ saved: false }]);
  assert.equal((await setSaved(off, 'U', { ownerId: 'O', id: 'm1' }, false, 'sch')).saved, false);
  assert.match(off.calls[0].sql, /^DELETE FROM "sch"\.saved_moments/);
  assert.deepEqual(off.calls[0].params, ['U', 'O', 'm1'], 'unsaving targets one user and one memory');
  // Unsaving twice is still a clean no-op.
  const offAgain = fakeClient([{ saved: false }]);
  assert.equal((await setSaved(offAgain, 'U', { ownerId: 'O', id: 'm1' }, false, 'sch')).saved, false);
});

test('the list is paginated newest-first and never returns content', async () => {
  // The service asks the database for limit + 1 rows, so a full page with more
  // to come arrives as three rows here.
  const page = fakeClient([
    { moment_owner_id: 'O', moment_id: 'm4', saved_at: new Date('2026-04-11T09:00:00Z') },
    { moment_owner_id: 'O', moment_id: 'm3', saved_at: new Date('2026-04-10T09:00:00Z') },
    { moment_owner_id: 'O', moment_id: 'm2', saved_at: new Date('2026-04-09T09:00:00Z') },
  ]);
  const result = await listSaved(page, 'U', { limit: 2 }, 'sch');
  assert.equal(result.items.length, 2, 'the extra row beyond the limit is dropped');
  assert.equal(result.items[0].id, 'm4', 'newest first');
  assert.deepEqual(Object.keys(result.items[0]).sort(), ['id', 'ownerId', 'savedAt'], 'no story, photo or title is returned');
  assert.ok(result.nextCursor, 'a full page advertises the next cursor');
  assert.deepEqual(decodeSavedCursor(result.nextCursor), { savedAt: '2026-04-10T09:00:00.000Z', ownerId: 'O', id: 'm3' }, 'the cursor points at the last row of the emitted page, not the probe row');
  assert.match(page.calls[0].sql, /LIMIT \$2/, 'limit is parameterized');
  assert.equal(page.calls[0].params.at(-1), 3, 'one extra row is fetched to detect a next page');
  assert.match(page.calls[0].sql, /saved_at DESC/, 'newest first');
  assert.doesNotMatch(page.calls[0].sql, /OFFSET/, 'keyset pagination, never an offset');

  const last = fakeClient([{ moment_owner_id: 'O', moment_id: 'm1', saved_at: new Date('2026-04-08T09:00:00Z') }]);
  assert.equal((await listSaved(last, 'U', { limit: 2 }, 'sch')).nextCursor, null, 'a partial page ends the listing');
});

test('the stored row holds only an identity and a timestamp', async () => {
  const client = fakeClient([{ moment_owner_id: crypto.randomUUID(), moment_id: 'm1', saved_at: new Date() }]);
  const rows = await client.query('SELECT s.moment_owner_id, s.moment_id, s.saved_at FROM saved s', []);
  const columns = Object.keys(rows.rows[0]);
  assert.deepEqual(columns.sort(), ['moment_id', 'moment_owner_id', 'saved_at'], 'no copied content column exists');
});

test('count and identity reads both intersect with current authorization', async () => {
  // The list can never outrun what the caller may actually read, so both reads
  // must carry the same two existence checks: the moment still exists, and the
  // caller still owns it or holds an accepted, unrevoked collaboration.
  const countClient = fakeClient([{ count: 0 }]);
  assert.equal(await savedCount(countClient, 'U', 'sch'), 0);
  const countSql = countClient.calls[0].sql;
  assert.match(countSql, /FROM "sch"\.saved_moments/);
  assert.match(countSql, /EXISTS \(/, 'the count is intersected, never a raw row count');
  assert.match(countSql, /accepted_at IS NOT NULL AND c\.revoked_at IS NULL/, 'a revoked collaboration stops counting');

  const identitiesClient = fakeClient([{ moment_owner_id: 'O', moment_id: 'm1' }]);
  assert.deepEqual(await savedIdentities(identitiesClient, 'U', 'sch'), ['O:m1']);
  const identitySql = identitiesClient.calls[0].sql;
  assert.match(identitySql, /EXISTS \(/, 'identities are intersected the same way');
  assert.match(identitySql, /accepted_at IS NOT NULL AND c\.revoked_at IS NULL/);
  // Neither read selects a document, image or title column.
  assert.doesNotMatch(countSql + identitySql, /document|title|image/i);
});

test('saving is private, idempotent and access-checked', { timeout: 120000 }, async t => {
  if (process.env.RUN_INTEGRATION !== '1') return t.skip('Set RUN_INTEGRATION=1 for DB-backed saved-state integration');
  const { app } = await import('../server.mjs');
  const { pool, createInvite, qschema } = await import('../memento-db.mjs');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { method = 'GET', token, body } = {}) {
    const headers = {};
    if (token) headers.Cookie = `memento_session=${token}`;
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      headers.Origin = base;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const type = res.headers.get('content-type') || '';
    return { res, data: type.includes('application/json') ? await res.json() : await res.text() };
  }
  async function register(prefix) {
    const username = `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 18)}`;
    const r = await request('/api/auth/register', { method: 'POST', body: { username, password: 'a-very-long-test-password-1', inviteCode: await createInvite(1) } });
    assert.equal(r.res.status, 200);
    return { id: r.data.user.id, token: r.res.headers.get('set-cookie').match(/memento_session=([^;]+)/)[1], username };
  }

  const owner = await register('svo');
  const editor = await register('sve');
  const outsider = await register('svx');
  let momentId, trackId;
  try {
    const track = await request('/api/tracks', { method: 'POST', token: owner.token, body: { title: 'Saved state track', description: '', color: 'indigo', icon: 'Heart', tags: [] } });
    assert.equal(track.res.status, 201); trackId = track.data.track.id;
    const moment = await request('/api/moments', { method: 'POST', token: owner.token, body: { eventId: trackId, eventOwnerId: owner.id, title: 'A memory worth keeping', date: '2026-04-10', description: 'body', tags: [], images: [] } });
    assert.equal(moment.res.status, 201); momentId = moment.data.moment.id;

    // Unauthenticated and invalid input are refused before any state changes.
    assert.equal((await request(`/api/moments/${momentId}/saved`, { method: 'PUT', body: { ownerId: owner.id, active: true } })).res.status, 401);
    assert.equal((await request(`/api/moments/${momentId}/saved`, { method: 'PUT', token: owner.token, body: { active: true } })).res.status, 400);
    assert.equal((await request(`/api/moments/${momentId}/saved`, { method: 'PUT', token: owner.token, body: { ownerId: owner.id } })).res.status, 400);
    assert.equal((await request(`/api/moments/${momentId}/saved`, { method: 'PUT', token: owner.token, body: { ownerId: 'not-a-uuid', active: true } })).res.status, 400);

    // Two users save the same memory independently.
    const invite = await request(`/api/tracks/${trackId}/collaborators`, { method: 'POST', token: owner.token, body: { username: editor.username, role: 'editor' } });
    assert.equal(invite.res.status, 201);
    const accept = await request(`/api/collaboration-invitations/${invite.data.collaborator.id}/accept`, { method: 'POST', token: editor.token });
    assert.equal(accept.res.status, 200);

    for (const user of [owner, editor]) {
      const saved = await request(`/api/moments/${momentId}/saved`, { method: 'PUT', token: user.token, body: { ownerId: owner.id, active: true } });
      assert.equal(saved.res.status, 200); assert.equal(saved.data.saved.saved, true);
    }
    // Idempotent: repeating either state is the same fact, and there is no
    // toggle endpoint to race.
    assert.equal((await request(`/api/moments/${momentId}/saved`, { method: 'PUT', token: owner.token, body: { ownerId: owner.id, active: true } })).data.saved.saved, true);
    const list = await request('/api/saved', { token: owner.token });
    assert.equal(list.res.status, 200);
    assert.deepEqual(list.data.saved, [{ ownerId: owner.id, id: momentId }], 'owner sees exactly their own save');
    assert.equal(list.data.count, 1);
    assert.equal((await request('/api/saved', { token: editor.token })).data.count, 1, 'the editor has their own independent save');
    // Saving is invisible to the memory's author.
    const ownerSeesOwnList = await request('/api/saved', { token: owner.token });
    assert.equal(ownerSeesOwnList.data.saved.length, 1);

    // The stored row carries no content at all.
    const row = await pool.query(`SELECT * FROM ${qschema}.saved_moments WHERE user_id=$1`, [owner.id]);
    assert.equal(row.rowCount, 1);
    assert.deepEqual(Object.keys(row.rows[0]).sort(), ['moment_id', 'moment_owner_id', 'saved_at', 'user_id']);

    // An outsider cannot save what they cannot read, and learns nothing.
    const denied = await request(`/api/moments/${momentId}/saved`, { method: 'PUT', token: outsider.token, body: { ownerId: owner.id, active: true } });
    assert.equal(denied.res.status, 404);
    assert.equal((await request('/api/saved', { token: outsider.token })).data.count, 0);

    // Revoking access hides the memory and the count without leaking an id.
    assert.equal((await request(`/api/tracks/${trackId}/collaborators/${editor.id}`, { method: 'DELETE', token: owner.token })).res.status, 200);
    const afterRevoke = await request('/api/saved', { token: editor.token });
    assert.equal(afterRevoke.data.count, 0, 'the count no longer includes a memory they cannot read');
    assert.deepEqual(afterRevoke.data.saved, [], 'and no id or title is leaked');
    const page = await request('/api/saved/moments', { token: editor.token });
    assert.equal(page.res.status, 200);
    assert.deepEqual(page.data.items, [], 'the paginated view agrees with the count');
    // Re-saving after revocation is refused, not silently accepted.
    assert.equal((await request(`/api/moments/${momentId}/saved`, { method: 'PUT', token: editor.token, body: { ownerId: owner.id, active: true } })).res.status, 404);

    // An unsaved memory disappears from both list and count.
    assert.equal((await request(`/api/moments/${momentId}/saved`, { method: 'PUT', token: owner.token, body: { ownerId: owner.id, active: false } })).data.saved.saved, false);
    const afterUnsave = await request('/api/saved', { token: owner.token });
    assert.equal(afterUnsave.data.count, 0);
    assert.deepEqual(afterUnsave.data.saved, []);

    // Deleting the memory cascades its saves away rather than dangling.
    await request(`/api/moments/${momentId}/saved`, { method: 'PUT', token: owner.token, body: { ownerId: owner.id, active: true } });
    assert.equal((await request(`/api/moments/${momentId}`, { method: 'DELETE', token: owner.token, body: { ownerId: owner.id } })).res.status, 200);
    assert.equal((await pool.query(`SELECT 1 FROM ${qschema}.saved_moments WHERE moment_owner_id=$1 AND moment_id=$2`, [owner.id, momentId])).rowCount, 0, 'deleting the memory cascades the save');
    assert.deepEqual((await request('/api/saved', { token: owner.token })).data.saved, []);

    // A stale result never survives a logout.
    await request('/api/auth/logout', { method: 'POST', token: owner.token });
    assert.equal((await request('/api/saved', { token: owner.token })).res.status, 401);
  } finally {
    await pool.query(`DELETE FROM ${qschema}.saved_moments WHERE moment_id=$1`, [momentId]).catch(() => {});
    await pool.query(`DELETE FROM ${qschema}.users WHERE id IN ($1,$2,$3)`, [owner.id, editor.id, outsider.id]).catch(() => {});
    server.close();
  }
});
