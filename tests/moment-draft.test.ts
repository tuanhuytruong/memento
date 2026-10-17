// Phase 1 Task 1.3: in-memory session-scoped drafts.
// These prove dirty detection is normalized, scopes never cross accounts or
// versions, and blob previews are owned by exactly one party at a time.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  draftScopeKey,
  saveMomentDraft,
  readMomentDraft,
  clearMomentDraft,
  releaseAllMomentDrafts,
  momentDraftCount,
  normalizeDraftFields,
  isDraftDirty,
  type MomentDraftFields,
} from '../src/lib/useMomentDraft';

const base = (overrides: Partial<MomentDraftFields> = {}): MomentDraftFields => ({
  trackKey: 'A:track-1',
  title: 'Đà Lạt',
  date: '2026-04-10',
  time: '09:30',
  description: 'Một buổi sáng sương mù',
  tags: ['travel'],
  emotion: undefined,
  emotionIntensity: 4,
  idea: '',
  locationName: '',
  locationCity: '',
  locationCountry: '',
  isMilestone: false,
  images: [],
  imageFiles: [],
  ...overrides,
});

test('scope keys fence by generation, mode, identity and version', () => {
  const scope = { authGeneration: 1, mode: 'edit' as const, momentId: 'm1', ownerId: 'A', expectedVersion: 3 };
  const key = draftScopeKey(scope);
  assert.equal(draftScopeKey({ ...scope }), key, 'identical scope, identical key');
  assert.notEqual(draftScopeKey({ ...scope, authGeneration: 2 }), key, 'a new account generation is a different scope');
  assert.notEqual(draftScopeKey({ ...scope, expectedVersion: 4 }), key, 'a new version is a different scope');
  assert.notEqual(draftScopeKey({ ...scope, ownerId: 'B' }), key, 'another owner is a different scope');
  assert.notEqual(draftScopeKey({ ...scope, mode: 'create' }), key, 'create and edit never share a draft');
  assert.notEqual(
    draftScopeKey({ authGeneration: 1, mode: 'edit', momentId: 'm2', ownerId: 'A', expectedVersion: 3 }),
    key,
    'another moment is a different scope',
  );
});

test('normalized comparison ignores cosmetic differences but catches real edits', () => {
  const original = base();
  assert.equal(isDraftDirty(original, base()), false, 'an unchanged form is clean');
  assert.equal(isDraftDirty(original, base({ title: '  Đà Lạt  ' })), false, 'surrounding whitespace is not an edit');
  assert.equal(isDraftDirty(original, base({ tags: ['a', 'b'] })), true, 'a new tag is an edit');
  const reordered = isDraftDirty(base({ tags: ['a', 'b'] }), base({ tags: ['b', 'a'] }));
  assert.equal(reordered, false, 'tag order is not an edit');
  assert.equal(isDraftDirty(original, base({ time: '' })), true, 'clearing the time is a real edit');
  assert.equal(isDraftDirty(original, base({ title: 'Huế' })), true, 'a new title is an edit');
  assert.equal(isDraftDirty(original, base({ description: 'khác' })), true, 'a new story is an edit');
  assert.equal(isDraftDirty(original, base({ isMilestone: true })), true, 'milestone is an edit');
  assert.equal(isDraftDirty(original, base({ emotion: 'joyful' })), true, 'an emotion is an edit');
  // An intensity change with no emotion selected is cosmetic, not an edit.
  assert.equal(isDraftDirty(original, base({ emotionIntensity: 2 })), false);
  assert.equal(isDraftDirty(original, base({ emotion: 'joyful', emotionIntensity: 2 })), true);
  // Blob previews never count (volatile); their pending files do.
  assert.equal(isDraftDirty(original, base({ images: ['blob:preview'] })), false, 'a blob preview is not an edit by itself');
});

test('normalize orders tags and folds unused intensity', () => {
  const normalized = normalizeDraftFields(base({ tags: ['b', 'a'], emotionIntensity: 5 }));
  assert.deepEqual(normalized.tags, ['a', 'b']);
  assert.equal(normalized.emotionIntensity, null, 'no emotion means no intensity to compare');
});

test('store: keep, read, clear returns blob URLs exactly once', () => {
  const key = draftScopeKey({ authGeneration: 1, mode: 'create' });
  assert.equal(readMomentDraft(key), null, 'no draft yet');
  saveMomentDraft(key, { fields: base(), blobUrls: ['blob:one', 'blob:two'] });
  assert.equal(momentDraftCount(), 1);
  const stored = readMomentDraft(key);
  assert.ok(stored);
  assert.equal(stored.fields.title, 'Đà Lạt');
  assert.deepEqual(stored.blobUrls, ['blob:one', 'blob:two']);
  // Clearing hands the URLs back for revocation, exactly once.
  const revoked = clearMomentDraft(key);
  assert.deepEqual(revoked, ['blob:one', 'blob:two']);
  assert.equal(readMomentDraft(key), null, 'cleared draft is gone');
  assert.deepEqual(clearMomentDraft(key), [], 'a second clear revokes nothing');
  assert.equal(momentDraftCount(), 0);
});

test('a stored draft never leaks into another scope', () => {
  const mine = draftScopeKey({ authGeneration: 1, mode: 'edit', momentId: 'm1', ownerId: 'A', expectedVersion: 1 });
  const nextSession = draftScopeKey({ authGeneration: 2, mode: 'edit', momentId: 'm1', ownerId: 'A', expectedVersion: 1 });
  saveMomentDraft(mine, { fields: base({ title: 'Private text' }), blobUrls: [] });
  assert.ok(readMomentDraft(mine), 'present in its own scope');
  assert.equal(readMomentDraft(nextSession), null, 'absent from the next account generation');
  releaseAllMomentDrafts();
  assert.equal(momentDraftCount(), 0);
});

test('session release clears every draft and returns all blob URLs', () => {
  const a = draftScopeKey({ authGeneration: 1, mode: 'create' });
  const b = draftScopeKey({ authGeneration: 1, mode: 'edit', momentId: 'm1', ownerId: 'A', expectedVersion: 2 });
  saveMomentDraft(a, { fields: base(), blobUrls: ['blob:a'] });
  saveMomentDraft(b, { fields: base({ title: 'Second' }), blobUrls: ['blob:b'] });
  assert.equal(momentDraftCount(), 2);
  const urls = releaseAllMomentDrafts();
  assert.deepEqual(urls.sort(), ['blob:a', 'blob:b']);
  assert.equal(momentDraftCount(), 0);
  assert.equal(readMomentDraft(a), null);
  assert.equal(readMomentDraft(b), null);
});

test('pending local files are part of dirty state; blob URLs alone are not', () => {
  const original = base();
  const withFile = base({ images: ['blob:preview'], imageFiles: [new File(['x'], 'x.png', { type: 'image/png' })] });
  assert.equal(isDraftDirty(original, base({ images: ['blob:preview'] })), false);
  assert.equal(isDraftDirty(original, withFile), true, 'an attached local file is a real edit');
});
