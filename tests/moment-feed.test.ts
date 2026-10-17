// Phase 3 Task 3.2: the parts of the feed that decide what the user sees.
// These are pure on purpose: the retained window and the identity de-dup are
// exactly the two places a feed can quietly grow without bound or show a
// memory twice after a concurrent edit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { feedScopeHash, dedupeByIdentity, slideWindow, type MomentFeedQuery } from '../src/lib/useMomentFeed';

const event = (id: string, ownerId = 'A') => ({ id, resourceOwnerId: ownerId }) as never;

test('the scope hash covers every decision that changes which rows are eligible', () => {
  const base: MomentFeedQuery = {};
  const hash = feedScopeHash(base, 1);
  assert.equal(feedScopeHash({}, 1), hash, 'deterministic for the same input');
  assert.notEqual(feedScopeHash({}, 2), hash, 'the account generation is part of the scope');
  assert.notEqual(feedScopeHash({ search: 'đà' }, 1), hash);
  assert.notEqual(feedScopeHash({ selectedYear: '2026' }, 1), hash);
  assert.notEqual(feedScopeHash({ dateFrom: '2026-01-01' }, 1), hash);
  assert.notEqual(feedScopeHash({ dateTo: '2026-12-31' }, 1), hash);
  assert.notEqual(feedScopeHash({ selectedTags: ['a'] }, 1), hash);
  assert.notEqual(feedScopeHash({ selectedEmotions: ['joyful'] }, 1), hash);
  assert.notEqual(feedScopeHash({ milestonesOnly: true }, 1), hash);
  assert.notEqual(feedScopeHash({ hasImagesOnly: true }, 1), hash);
  assert.notEqual(feedScopeHash({ savedOnly: true }, 1), hash, 'the saved filter is part of the scope');
  assert.notEqual(feedScopeHash({ trackKey: 'A:t1' }, 1), hash);
  assert.notEqual(feedScopeHash({ sortDirection: 'oldest' }, 1), hash);
  // Tag order is cosmetic, exactly as it is on the server.
  assert.equal(feedScopeHash({ selectedTags: ['b', 'a'] }, 1), feedScopeHash({ selectedTags: ['a', 'b'] }, 1));
});

test('a limit change does not invalidate the cursor', () => {
  // Paging with a different page size continues the same ordered scan, so it
  // must not be treated as a different filter set.
  assert.equal(feedScopeHash({ search: 'x', limit: 40 }, 1), feedScopeHash({ search: 'x', limit: 100 }, 1));
});

test('a memory appearing in two pages is shown once, keeping first position', () => {
  const pages = [
    [event('m1'), event('m2')],
    [event('m2'), event('m3')],
    [event('m1'), event('m4')],
  ];
  const merged = dedupeByIdentity(pages);
  assert.deepEqual(merged.map(e => (e as { id: string }).id), ['m1', 'm2', 'm3', 'm4']);
  assert.equal(merged.length, 4, 'exactly four memories, not six rows');
});

test('the same id under a different owner is a different memory', () => {
  const merged = dedupeByIdentity([[event('m1', 'A')], [event('m1', 'B')]]);
  assert.equal(merged.length, 2, 'composite identity, never a bare id');
});

test('the retained window is bounded however far the user pages', () => {
  const page = (n: number) => [{ id: `m${n}` }];
  let pages: { id: string }[][] = [];
  for (let index = 0; index < 12; index += 1) {
    pages = [...pages, page(index)];
    pages = slideWindow(pages, 5).pages;
    assert.ok(pages.length <= 5, `never more than 5 pages, got ${pages.length}`);
  }
  assert.equal(pages.length, 5);
  assert.equal(pages[0][0].id, 'm7', 'the oldest retained page is the most recent one that fit');
  assert.equal(pages[4][0].id, 'm11', 'the newest page is retained');

  const slid = slideWindow([[1], [2], [3], [4], [5], [6], [7]], 5);
  assert.equal(slid.dropped, 2, 'the caller is told how many pages were released');
  assert.deepEqual(slid.pages, [[3], [4], [5], [6], [7]]);
  const within = slideWindow([[1], [2]], 5);
  assert.equal(within.dropped, 0, 'nothing is dropped while the window has room');
  assert.equal(slideWindow([], 5).pages.length, 0);
});

test('an empty first page is a valid, non-erroring state', () => {
  assert.deepEqual(dedupeByIdentity([[]]), []);
  assert.equal(slideWindow([[]], 5).pages.length, 1);
});
