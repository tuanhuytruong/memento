// Outbox state machine, cap and TTL, on the degraded path Node provides (no
// IndexedDB). The browser-persistent behaviour is covered by the live harness; these
// assertions pin the rules that must hold even when only the in-memory store works.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OUTBOX_COMMITTED_TTL_MS,
  OUTBOX_MAX_ITEMS,
  outboxEvictExpired,
  outboxLoad,
  outboxOldestUncommitted,
  outboxPut,
  outboxPurgeAll,
  outboxSnapshot,
  outboxUpdate,
} from '../src/lib/photoOutbox.ts';

const OWNER = 'owner-a';
const blob = () => new Blob([new Uint8Array(2048)], { type: 'image/jpeg' });

function put(uploadId: string, overrides: { uploaderAccountId?: string; resourceOwnerId?: string; momentId?: string; createdAt?: number; state?: 'pending' | 'committed'; bytes?: number } = {}) {
  return outboxPut({
    uploadId,
    uploaderAccountId: overrides.uploaderAccountId ?? OWNER,
    resourceOwnerId: overrides.resourceOwnerId ?? overrides.uploaderAccountId ?? OWNER,
    momentId: overrides.momentId ?? 'moment-1',
    blob: blob(),
    name: `${uploadId}.jpg`,
    type: 'image/jpeg',
    bytes: overrides.bytes ?? 2048,
    ...(overrides.createdAt === undefined ? {} : { createdAt: overrides.createdAt }),
    ...(overrides.state === undefined ? {} : { state: overrides.state }),
  });
}

test('a queued photo is durable before the first attempt and never leaks its store key', async () => {
  await outboxPurgeAll();
  await outboxLoad(OWNER);
  const stored = await put('up-1');
  assert.equal(stored.state, 'pending');
  assert.equal(stored.attempts, 0);
  assert.equal('key' in stored, false, 'the IndexedDB primary key is an implementation detail');
  const snapshot = outboxSnapshot(OWNER);
  assert.equal(snapshot.length, 1);
  assert.equal(snapshot[0].uploadId, 'up-1');
  assert.equal(snapshot[0].momentId, 'moment-1');
});

test('state moves pending → uploading → committed and attempts are counted', async () => {
  await outboxLoad(OWNER);
  await put('up-2');
  const uploading = await outboxUpdate(OWNER, 'up-2', { state: 'uploading', attempts: 1, lastAttemptAt: 1_000 });
  assert.equal(uploading?.state, 'uploading');
  assert.equal(uploading?.attempts, 1);
  const committed = await outboxUpdate(OWNER, 'up-2', { state: 'committed' });
  assert.equal(committed?.state, 'committed');
  assert.equal(outboxSnapshot(OWNER).find((record) => record.uploadId === 'up-2')?.state, 'committed');
});

test('updating an unknown upload is a no-op instead of a throw', async () => {
  assert.equal(await outboxUpdate(OWNER, 'missing', { state: 'committed' }), null);
});

test('the cap is enforced and committed photos are the ones evicted', async () => {
  await outboxPurgeAll();
  await outboxLoad(OWNER);
  // One old committed photo plus a queue that overflows the cap: the committed blob
  // is the cheap loss, the queued ones are the user's only copy.
  await put('committed-old', { state: 'committed', createdAt: 1 });
  for (let index = 0; index < OUTBOX_MAX_ITEMS; index += 1) {
    await put(`queued-${index}`, { createdAt: 10 + index });
  }
  const snapshot = outboxSnapshot(OWNER);
  assert.ok(snapshot.length <= OUTBOX_MAX_ITEMS, `cap holds (${snapshot.length} <= ${OUTBOX_MAX_ITEMS})`);
  assert.equal(snapshot.some((record) => record.uploadId === 'committed-old'), false, 'committed photo left first');
  assert.ok(snapshot.filter((record) => record.state !== 'committed').length >= OUTBOX_MAX_ITEMS - 1, 'queued photos survive');
});

test('committed blobs expire after 24h, uncommitted ones are kept', async () => {
  await outboxPurgeAll();
  await outboxLoad(OWNER);
  await put('done', { state: 'committed', createdAt: 1_000 });
  await put('owed', { state: 'pending', createdAt: 1_000 });
  const young = await outboxEvictExpired(OWNER, 1_000 + OUTBOX_COMMITTED_TTL_MS - 1);
  assert.equal(young, 0, 'nothing expires before the TTL');
  const old = await outboxEvictExpired(OWNER, 1_000 + OUTBOX_COMMITTED_TTL_MS);
  assert.equal(old, 1);
  const remaining = outboxSnapshot(OWNER).map((record) => record.uploadId);
  assert.deepEqual(remaining, ['owed'], 'a photo the server never acknowledged is never evicted by time');
});

test('resume picks the oldest moment and keeps its photos in order', async () => {
  await outboxPurgeAll();
  await outboxLoad(OWNER);
  await put('second-moment', { momentId: 'moment-2', createdAt: 20 });
  await put('first-moment-b', { momentId: 'moment-1', createdAt: 11 });
  await put('first-moment-a', { momentId: 'moment-1', createdAt: 10 });
  await put('already-committed', { momentId: 'moment-1', createdAt: 1, state: 'committed' });
  const queue = outboxOldestUncommitted(OWNER);
  assert.equal(queue?.momentId, 'moment-1');
  assert.equal(queue?.uploaderAccountId, OWNER, 'the resume path re-uploads under the same owner');
  assert.deepEqual(queue?.files.map((entry) => entry.uploadId), ['first-moment-a', 'first-moment-b']);
  assert.ok(queue?.files.every((entry) => entry.file instanceof File), 'a stored blob is re-uploaded as a File');
});

test('one account never sees another account queued photo', async () => {
  await outboxPurgeAll();
  await outboxLoad(OWNER);
  await put('mine');
  await put('theirs', { uploaderAccountId: 'owner-b' });
  assert.deepEqual(outboxSnapshot(OWNER).map((record) => record.uploadId), ['mine']);
  await outboxLoad('owner-b');
  assert.deepEqual(outboxSnapshot('owner-b').map((record) => record.uploadId), ['theirs']);
  assert.deepEqual(outboxSnapshot(OWNER), [], 'a stale owner view is empty rather than wrong');
  assert.equal(outboxOldestUncommitted(null), null);
});

test('signing out purges every queued photo', async () => {
  await outboxLoad(OWNER);
  await put('forget-me');
  await outboxPurgeAll();
  assert.deepEqual(outboxSnapshot(OWNER), []);
  assert.equal(outboxOldestUncommitted(OWNER), null);
});

test('a purge invalidates the old outbox epoch and no old record can be updated afterward', async () => {
  await outboxPurgeAll();
  await outboxLoad(OWNER);
  await put('late-old-session');
  await outboxPurgeAll();
  assert.equal(await outboxUpdate(OWNER, 'late-old-session', { state: 'committed' }), null);
  assert.deepEqual(outboxSnapshot(OWNER), []);
  await outboxLoad('owner-b');
  await put('fresh-session', { uploaderAccountId: 'owner-b' });
  assert.deepEqual(outboxSnapshot('owner-b').map((record) => record.uploadId), ['fresh-session']);
});


test('editor queue is partitioned by uploader while retaining a distinct destination owner', async () => {
  await outboxPurgeAll();
  await outboxLoad('editor-e');
  await put('editor-to-owner', { uploaderAccountId: 'editor-e', resourceOwnerId: 'owner-o', momentId: 'owner-moment' });
  const queue = outboxOldestUncommitted('editor-e');
  assert.equal(queue?.uploaderAccountId, 'editor-e');
  assert.equal(queue?.resourceOwnerId, 'owner-o');
  assert.equal(queue?.momentId, 'owner-moment');
  await outboxLoad('owner-o');
  assert.equal(outboxOldestUncommitted('owner-o'), null, 'resource owner cannot inherit the editor device queue');
});
