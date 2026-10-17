import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_FILE || '.env.local' });

const { app } = await import('../server.mjs');
const { pool, createInvite, hashInvite, qschema } = await import('../memento-db.mjs');

test('track visit state is visitor-private, access-checked and single-query', { timeout: 120000 }, async t => {
  if (process.env.RUN_INTEGRATION !== '1') return t.skip('Set RUN_INTEGRATION=1 for DB-backed visit-state integration');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { method = 'GET', token, body } = {}) {
    const headers = {};
    if (token) headers.Cookie = `memento_session=${token}`;
    if (['POST', 'PUT', 'DELETE'].includes(method)) {
      headers.Origin = base;
      if (body !== undefined) { headers['Content-Type'] = 'application/json'; }
    }
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const type = res.headers.get('content-type') || '';
    return { res, data: type.includes('application/json') ? await res.json() : await res.text() };
  }
  async function register() {
    const username = `vt_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
    const invite = await createInvite(1);
    const registered = await request('/api/auth/register', { method: 'POST', body: { username, password: 'a-very-long-test-password-1', inviteCode: invite } });
    assert.equal(registered.res.status, 200);
    return {
      id: registered.data.user.id,
      username,
      token: registered.res.headers.get('set-cookie').match(/memento_session=([^;]+)/)[1],
      inviteHash: hashInvite(invite),
    };
  }

  const owner = await register();
  const viewer = await register();
  const outsider = await register();
  let trackId;
  try {
    const track = await request('/api/tracks', { method: 'POST', token: owner.token, body: { title: 'Visit track', description: '', color: 'indigo', icon: 'Cpu', tags: [] } });
    assert.equal(track.res.status, 201);
    trackId = track.data.track.id;

    // Exact identity is mandatory: no bare-id guess, no ambiguous owner resolution.
    assert.equal((await request(`/api/tracks/${trackId}/visit`, { method: 'PUT', token: owner.token, body: {} })).res.status, 400);
    assert.equal((await request(`/api/tracks/${trackId}/visit`, { method: 'PUT', token: owner.token, body: { ownerId: 'not-a-uuid' } })).res.status, 400);
    assert.equal((await request(`/api/tracks/${crypto.randomUUID()}/visit`, { method: 'PUT', token: owner.token, body: { ownerId: owner.id } })).res.status, 404);

    const ownerVisit = await request(`/api/tracks/${trackId}/visit`, { method: 'PUT', token: owner.token, body: { ownerId: owner.id } });
    assert.equal(ownerVisit.res.status, 200);
    assert.ok(ownerVisit.data.visit.lastOpenedAt);

    // Outsiders cannot record visits against somebody else's exact track.
    assert.equal((await request(`/api/tracks/${trackId}/visit`, { method: 'PUT', token: outsider.token, body: { ownerId: owner.id } })).res.status, 404);

    // Invite the viewer, accept, then record the viewer's own visit.
    const invite = await request(`/api/tracks/${trackId}/collaborators`, { method: 'POST', token: owner.token, body: { username: viewer.username, role: 'viewer' } });
    assert.equal(invite.res.status, 201);
    const pending = await request('/api/collaboration-invitations', { token: viewer.token });
    assert.equal((await request(`/api/collaboration-invitations/${pending.data.invitations[0].id}/accept`, { method: 'POST', token: viewer.token })).res.status, 200);
    const viewerVisit = await request(`/api/tracks/${trackId}/visit`, { method: 'PUT', token: viewer.token, body: { ownerId: owner.id } });
    assert.equal(viewerVisit.res.status, 200);

    // Repeated writes keep a single row and never move the timestamp backwards.
    await new Promise(resolve => setTimeout(resolve, 20));
    const secondWrite = await request(`/api/tracks/${trackId}/visit`, { method: 'PUT', token: owner.token, body: { ownerId: owner.id } });
    assert.equal(secondWrite.res.status, 200);
    assert.ok(new Date(secondWrite.data.visit.lastOpenedAt) >= new Date(ownerVisit.data.visit.lastOpenedAt));
    const rows = await pool.query(`SELECT count(*)::int AS n FROM ${qschema}.track_visit_state WHERE user_id=$1 AND track_owner_id=$2 AND track_id=$3`, [owner.id, owner.id, trackId]);
    assert.equal(rows.rows[0].n, 1);

    // Privacy: each visitor sees only their own timestamps, never the other account's.
    const ownerList = await request('/api/track-visits', { token: owner.token });
    assert.equal(ownerList.res.status, 200);
    assert.deepEqual(ownerList.data.visits.map(v => `${v.trackOwnerId}:${v.trackId}`), [`${owner.id}:${trackId}`]);
    const viewerList = await request('/api/track-visits', { token: viewer.token });
    assert.deepEqual(viewerList.data.visits.map(v => `${v.trackOwnerId}:${v.trackId}`), [`${owner.id}:${trackId}`]);
    const outsiderList = await request('/api/track-visits', { token: outsider.token });
    assert.deepEqual(outsiderList.data.visits, []);

    // List reads must not scale queries with rows (auth query + one list query).
    const originalQuery = pool.query.bind(pool);
    let queryCount = 0;
    pool.query = (...args) => { queryCount += 1; return originalQuery(...args); };
    try { await request('/api/track-visits', { token: owner.token }); }
    finally { pool.query = originalQuery; }
    assert.ok(queryCount <= 2, `expected at most 2 queries for the visit list, saw ${queryCount}`);

    // Identity collision: the same track id under another owner stays a different track.
    const collision = await request('/api/tracks', { method: 'POST', token: viewer.token, body: { id: trackId, title: 'Collision', description: '', color: 'indigo', icon: 'Cpu', tags: [] } });
    assert.equal(collision.res.status, 201);
    assert.equal((await request(`/api/tracks/${trackId}/visit`, { method: 'PUT', token: owner.token, body: { ownerId: viewer.id } })).res.status, 404);
    const viewerOwnVisit = await request(`/api/tracks/${trackId}/visit`, { method: 'PUT', token: viewer.token, body: { ownerId: viewer.id } });
    assert.equal(viewerOwnVisit.res.status, 200);
    const viewerAfterCollision = await request('/api/track-visits', { token: viewer.token });
    assert.equal(viewerAfterCollision.data.visits.length, 2);
    assert.deepEqual(viewerAfterCollision.data.visits.map(v => `${v.trackOwnerId}:${v.trackId}`).sort(), [`${owner.id}:${trackId}`, `${viewer.id}:${trackId}`].sort());

    // Revocation removes the collaborator's subsequent read/write access to the state.
    assert.equal((await request(`/api/tracks/${trackId}/collaborators/${viewer.id}`, { method: 'DELETE', token: owner.token })).res.status, 200);
    assert.equal((await request(`/api/tracks/${trackId}/visit`, { method: 'PUT', token: viewer.token, body: { ownerId: owner.id } })).res.status, 404);
    const viewerAfterRevoke = await request('/api/track-visits', { token: viewer.token });
    assert.ok(viewerAfterRevoke.data.visits.every(v => !(v.trackOwnerId === owner.id && v.trackId === trackId)), 'revoked visit rows must disappear from the list');
    assert.ok(viewerAfterRevoke.data.visits.some(v => v.trackOwnerId === viewer.id), 'the visitor\'s own other track remains visible');

    // Deleting the parent track cascades its visit rows away.
    assert.equal((await request(`/api/tracks/${trackId}`, { method: 'DELETE', token: owner.token })).res.status, 200);
    trackId = undefined;
    const ownerFinal = await request('/api/track-visits', { token: owner.token });
    assert.deepEqual(ownerFinal.data.visits, [], 'deleting the parent track removes the owner\'s visit rows');
    const cascade = await pool.query(`SELECT count(*)::int AS n FROM ${qschema}.track_visit_state WHERE track_owner_id=$1`, [owner.id]);
    assert.equal(cascade.rows[0].n, 0);
  } finally {
    if (trackId && owner.token) await request(`/api/tracks/${trackId}`, { method: 'DELETE', token: owner.token }).catch(() => {});
    for (const account of [owner, viewer, outsider]) {
      if (account.token) await request('/api/auth/logout', { method: 'POST', token: account.token }).catch(() => {});
      await pool.query(`DELETE FROM ${qschema}.users WHERE id=$1`, [account.id]).catch(() => {});
      await pool.query(`DELETE FROM ${qschema}.invites WHERE code_hash=$1`, [account.inviteHash]).catch(() => {});
    }
    await new Promise(resolve => server.close(resolve));
  }
});
