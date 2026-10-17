// Phase 3 Task 3.2: backup completeness. The export is the one feature whose
// job is to be trusted later, so a partial file is a worse failure than no
// file — every case here is about refusing rather than approximating.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectAllMoments, buildCompleteBackup, type Page } from '../src/lib/exportBackup';

const moment = (id: string, owner = 'A') => ({ id, resourceOwnerId: owner, title: id, date: '2026-01-01' }) as never;

/** Serve a fixed set of pages and record how it was called. */
function paged(pages: Page<never>[]) {
  const calls: (string | null)[] = [];
  const fetchPage = async (cursor: string | null) => {
    calls.push(cursor);
    if (cursor === null) return pages[0];
    const index = Number(cursor);
    if (!Number.isInteger(index) || index < 0 || index >= pages.length) throw new Error(`bad cursor ${cursor}`);
    return pages[index];
  };
  return { fetchPage, calls };
}

test('every page is followed until the cursor is exhausted', async () => {
  const pages: Page<never>[] = [
    { moments: [moment('m1'), moment('m2')], nextCursor: '1' },
    { moments: [moment('m3')], nextCursor: '2' },
    { moments: [moment('m4'), moment('m5')], nextCursor: null },
  ];
  const { fetchPage, calls } = paged(pages);
  const all = await collectAllMoments(fetchPage);
  assert.deepEqual(all.map(e => (e as { id: string }).id), ['m1', 'm2', 'm3', 'm4', 'm5']);
  assert.deepEqual(calls, [null, '1', '2'], 'started once, then followed each cursor in order');
});

test('an empty account exports an empty file rather than throwing', async () => {
  const all = await collectAllMoments(async () => ({ moments: [], nextCursor: null }));
  assert.deepEqual(all, []);
});

test('a failed page propagates and writes nothing', async () => {
  await assert.rejects(
    () => collectAllMoments(async (cursor) => {
      if (cursor === null) return { moments: [moment('m1')], nextCursor: '1' };
      throw new Error('authorization lost');
    }),
    /authorization lost/,
    'a missing page is a hard failure, not a short file',
  );
});

test('a repeating cursor is refused instead of looping forever', async () => {
  let calls = 0;
  await assert.rejects(
    async () => collectAllMoments(async () => { calls += 1; return { moments: [moment(`m${calls}`)], nextCursor: 'same' }; }),
    /same page was returned twice/,
  );
  assert.equal(calls, 2, 'detected on the second page, not after spinning');
});

test('an unbounded response is refused rather than accepted', async () => {
  await assert.rejects(
    async () => collectAllMoments(async (cursor) => ({
      moments: [moment(`m${cursor ?? '0'}`)],
      nextCursor: String(Number(cursor ?? '0') + 1),
    })),
    /too many pages/,
  );
});

test('a malformed page is refused', async () => {
  await assert.rejects(() => collectAllMoments(async () => ({} as Page<never>)), /readable page/);
  await assert.rejects(() => collectAllMoments(async () => ({ moments: undefined as never, nextCursor: null })), /readable page/);
});

test('a memory arriving on two pages fails the export instead of being merged', async () => {
  const pages: Page<never>[] = [
    { moments: [moment('m1')], nextCursor: '1' },
    { moments: [moment('m1'), moment('m2')], nextCursor: null },
  ];
  const { fetchPage } = paged(pages);
  await assert.rejects(
    () => buildCompleteBackup({
      ownerUserId: 'A',
      tracks: [],
      tags: ['x'],
      fetchMomentsPage: fetchPage,
      fetchPerspectives: async () => [],
    }),
    /same memory arrived on two pages/,
    'two pages disagreeing about the data must not be silently reconciled',
  );
});

test('the same id under two owners is not a duplicate', async () => {
  const pages: Page<never>[] = [
    { moments: [moment('m1', 'A'), moment('m1', 'B')], nextCursor: null },
  ];
  const { fetchPage } = paged(pages);
  const payload = await buildCompleteBackup({
    ownerUserId: 'A', tracks: [], tags: [], fetchMomentsPage: fetchPage, fetchPerspectives: async () => [],
  });
  assert.equal(payload.events.length, 2, 'composite identity, never a bare id');
});

test('an unreadable perspective set fails the whole export', async () => {
  await assert.rejects(
    () => buildCompleteBackup({
      ownerUserId: 'A',
      tracks: [],
      tags: [],
      fetchMomentsPage: async () => ({ moments: [moment('m1')], nextCursor: null }),
      fetchPerspectives: async () => (undefined as never),
    }),
    /perspectives could not be read completely/,
    'perspectives are fetched first so nothing is written when they fail',
  );
});

test('a memory without an owner identity fails closed', async () => {
  await assert.rejects(
    () => buildCompleteBackup({
      ownerUserId: 'A',
      tracks: [],
      tags: [],
      fetchMomentsPage: async () => ({ moments: [{ id: 'm1' } as never], nextCursor: null }),
      fetchPerspectives: async () => [],
    }),
    /without an owner identity/,
  );
  await assert.rejects(
    () => buildCompleteBackup({
      ownerUserId: 'A',
      tracks: [],
      tags: [],
      fetchMomentsPage: async () => ({ moments: [{ resourceOwnerId: 'A' } as never], nextCursor: null }),
      fetchPerspectives: async () => [],
    }),
    /without an owner identity/,
    'a missing id is the same failure',
  );
});

test('a complete payload records its own scope and version', async () => {
  const now = new Date('2026-04-10T09:00:00.000Z');
  const payload = await buildCompleteBackup({
    ownerUserId: 'A',
    tracks: [{ id: 't1' }] as never,
    tags: ['du lịch'],
    fetchMomentsPage: async () => ({ moments: [moment('m1'), moment('m2')], nextCursor: null }),
    fetchPerspectives: async () => [{ id: 'p1' }] as never,
    now,
  });
  assert.equal(payload.version, '4.0');
  assert.equal(payload.exportedAt, '2026-04-10T09:00:00.000Z');
  assert.equal(payload.scope.momentCount, 2);
  assert.equal(payload.scope.perspectiveCount, 1);
  assert.equal(payload.scope.complete, true);
  assert.equal(payload.scope.ownerScope, 'current-account');
  assert.equal(payload.scope.ownerUserId, 'A');
  assert.equal(payload.scope.images, 'references-to-stored-images-only', 'images are references, not photo bytes');
  assert.deepEqual(payload.customTags, ['du lịch']);
  assert.equal(payload.events.length, 2);
});
