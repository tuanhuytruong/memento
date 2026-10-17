// Phase 2 Task 2.1: one normalization, one date policy, one sort order.
// These are the semantics the client list and the server query must share.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  foldSearchText,
  searchableText,
  isDateOnlyLiteral,
  validateDateRange,
  applyFilterPatch,
  matchesMomentFilters,
  momentSortTuple,
  compareMoments,
  EMPTY_FILTERS,
  type MomentFilterState,
} from '../src/lib/momentFilters';

const filters = (overrides: Partial<MomentFilterState> = {}): MomentFilterState => ({ ...EMPTY_FILTERS, ...overrides });

test('search folding is Unicode-correct for Vietnamese, emoji and whitespace', () => {
  assert.equal(foldSearchText('Đà Lạt'), foldSearchText('da lat'), 'đ/Đ folds to d/D');
  assert.equal(foldSearchText('ĐÀ LẠT'), foldSearchText('dà lạt'), 'case folding survives the đ mapping');
  assert.equal(foldSearchText('đà nẵng'), 'da nang');
  // Composed vs decomposed input must compare equal.
  const composed = 'Tiệc mừng';
  const decomposed = composed.normalize('NFD');
  assert.notEqual(composed, decomposed, 'the fixture really is two different byte sequences');
  assert.equal(foldSearchText(composed), foldSearchText(decomposed), 'NFC makes them comparable');
  assert.equal(foldSearchText('  nhiều   khoảng   trắng  '), 'nhieu khoang trang', 'whitespace runs collapse');
  assert.equal(foldSearchText(''), '');
  assert.equal(foldSearchText('   '), '');
  // Emoji survive folding untouched.
  assert.equal(foldSearchText('buổi hẹn 🎉 vui'), 'buoi hen 🎉 vui');
});

test('search covers exactly the documented fields, and only those', () => {
  const event = {
    title: 'Đà Lạt',
    description: 'Sương mù trên đồi',
    idea: 'Mua thêm áo ấm',
    tags: ['travel'],
    emotion: 'joyful',
    location: { name: 'Chợ đêm', city: 'Da Lat', country: 'Vietnam' },
  };
  const text = searchableText(event);
  for (const needle of ['Đà Lạt', 'sương mù', 'áo ấm', 'travel', 'joyful', 'chợ đêm', 'vietnam']) {
    assert(text.includes(foldSearchText(needle)), `searchable text covers ${needle}`);
  }
  // Collaborator perspective bodies are deliberately NOT part of global search.
  const noPerspective = searchableText({ title: 'một cuốn nhật ký' });
  assert(!noPerspective.includes('perspective'));
});

test('date-only literals are shape-checked and calendar-checked', () => {
  assert.equal(isDateOnlyLiteral('2026-04-10'), true);
  assert.equal(isDateOnlyLiteral('2026-02-30'), false, 'February never has 30 days');
  assert.equal(isDateOnlyLiteral('2024-02-29'), true, 'a real leap day');
  assert.equal(isDateOnlyLiteral('2026-02-29'), false, 'not a leap year');
  assert.equal(isDateOnlyLiteral('2026-13-01'), false);
  assert.equal(isDateOnlyLiteral('2026-00-10'), false);
  assert.equal(isDateOnlyLiteral('2026-4-10'), false, 'unpadded months are not literals');
  assert.equal(isDateOnlyLiteral('2026-04-10T00:00:00Z'), false, 'timestamps are a different contract');
  assert.equal(isDateOnlyLiteral(20260410), false);
  assert.equal(isDateOnlyLiteral(null), false);
});

test('range validation rejects malformed and inverted bounds', () => {
  assert.equal(validateDateRange('', ''), null, 'an unset range is valid');
  assert.equal(validateDateRange('2026-01-01', '2026-12-31'), null);
  assert.equal(validateDateRange('2026-01-01', '2026-01-01'), null, 'a single day is a valid range');
  assert.match(String(validateDateRange('nope', '')), /From date must be a real calendar date/);
  assert.match(String(validateDateRange('', '2026-02-30')), /To date must be a real calendar date/);
  assert.match(String(validateDateRange('2026-05-01', '2026-04-30')), /must not be after/);
});

test('selecting a year replaces the range; entering a range clears the year', () => {
  const withRange = applyFilterPatch(filters({ dateFrom: '2026-01-01', dateTo: '2026-06-30' }), { selectedYear: '2025' });
  assert.equal(withRange.selectedYear, '2025');
  assert.equal(withRange.dateFrom, '', 'the year takes over');
  assert.equal(withRange.dateTo, '');
  const backToAll = applyFilterPatch(withRange, { selectedYear: 'all' });
  assert.equal(backToAll.selectedYear, 'all');
  const withYear = applyFilterPatch(filters({ selectedYear: '2024' }), { dateFrom: '2026-01-01' });
  assert.equal(withYear.selectedYear, 'all', 'the range takes over');
  assert.equal(withYear.dateFrom, '2026-01-01');
  // Unrelated patches must not disturb the date controls.
  const ranged = filters({ dateFrom: '2026-01-01', dateTo: '2026-06-30' });
  const searchOnly = applyFilterPatch(ranged, { search: 'đà lạt' });
  assert.equal(searchOnly.dateFrom, '2026-01-01', 'a search patch leaves the range alone');
  assert.equal(searchOnly.dateTo, '2026-06-30');
  assert.equal(searchOnly.selectedYear, 'all');
  // Both bounds arriving together are one range, not two independent edits.
  const bothBounds = applyFilterPatch(filters({ selectedYear: '2023' }), { dateFrom: '2026-01-01', dateTo: '2026-03-31' });
  assert.equal(bothBounds.selectedYear, 'all');
  assert.equal(bothBounds.dateFrom, '2026-01-01');
  assert.equal(bothBounds.dateTo, '2026-03-31');
});

test('search matches diacritic-insensitively while display text is untouched', () => {
  const event = { title: 'Đà Lạt', description: 'Buổi sáng sương mù', date: '2026-04-10', tags: ['Travel'] };
  assert.equal(matchesMomentFilters(event, filters({ search: 'da lat' })), true);
  assert.equal(matchesMomentFilters(event, filters({ search: 'DA LAT' })), true);
  assert.equal(matchesMomentFilters(event, filters({ search: 'sương' })), true);
  assert.equal(matchesMomentFilters(event, filters({ search: 'travel' })), true, 'tags are searchable');
  assert.equal(matchesMomentFilters(event, filters({ search: 'huế' })), false);
  assert.equal(event.title, 'Đà Lạt', 'the stored/display title is never rewritten');
});

test('tag selection is OR semantics on folded equality, not substring', () => {
  const event = { title: 'x', date: '2026-01-01', tags: ['gia đình', 'travel'] };
  assert.equal(matchesMomentFilters(event, filters({ selectedTags: ['travel'] })), true);
  assert.equal(matchesMomentFilters(event, filters({ selectedTags: ['Gia Đình'] })), true, 'case/diacritic-insensitive equality');
  assert.equal(matchesMomentFilters(event, filters({ selectedTags: ['travel', 'food'] })), true, 'any match wins');
  assert.equal(matchesMomentFilters(event, filters({ selectedTags: ['gia'] })), false, 'no substring matching');
  assert.equal(matchesMomentFilters(event, filters({ selectedTags: [] })), true);
});

test('the date range is inclusive on local calendar dates', () => {
  const event = { title: 'x', date: '2026-04-10' };
  assert.equal(matchesMomentFilters(event, filters({ dateFrom: '2026-04-10', dateTo: '2026-04-10' })), true, 'bounds are inclusive');
  assert.equal(matchesMomentFilters(event, filters({ dateFrom: '2026-04-10' })), true);
  assert.equal(matchesMomentFilters(event, filters({ dateTo: '2026-04-10' })), true);
  assert.equal(matchesMomentFilters(event, filters({ dateTo: '2026-04-09' })), false);
  assert.equal(matchesMomentFilters(event, filters({ dateFrom: '2026-04-11' })), false);
  // A malformed memory date is never silently hidden by a range filter.
  assert.equal(matchesMomentFilters({ title: 'x', date: 'legacy' }, filters({ dateFrom: '2026-01-01' })), true);
});

test('a future memory date is filtered like any other date, not special-cased', () => {
  const future = { title: 'Kế hoạch Noel', date: '2099-12-25' };
  assert.equal(matchesMomentFilters(future, filters({ dateFrom: '2099-01-01', dateTo: '2099-12-31' })), true);
  assert.equal(matchesMomentFilters(future, filters({ selectedYear: '2099' })), true);
  assert.equal(matchesMomentFilters(future, filters({ dateTo: '2026-12-31' })), false);
});

test('sort order is deterministic and tie-broken by owner then id', () => {
  const a = { title: 'a', date: '2026-04-10', time: '09:00', resourceOwnerId: 'A', id: 'm1' };
  const b = { title: 'b', date: '2026-04-10', time: '09:00', resourceOwnerId: 'A', id: 'm2' };
  const c = { title: 'c', date: '2026-04-10', time: '08:00', resourceOwnerId: 'B', id: 'm0' };
  const list = [a, b, c];
  const oldest = [...list].sort((x, y) => compareMoments(x, y, 'oldest'));
  assert.deepEqual(oldest.map(m => m.id), ['m0', 'm1', 'm2'], 'time first, then id');
  const newest = [...list].sort((x, y) => compareMoments(x, y, 'newest'));
  assert.deepEqual(newest.map(m => m.id), ['m2', 'm1', 'm0'], 'newest is the exact reverse');
  // A missing time sorts after a present one within the same day.
  const noTime = { title: 'd', date: '2026-04-10', resourceOwnerId: 'A', id: 'm9' };
  assert.deepEqual([...list, noTime].sort((x, y) => compareMoments(x, y, 'oldest')).map(m => m.id), ['m0', 'm1', 'm2', 'm9']);
  // A malformed date sorts last rather than being parsed by the browser.
  const badDate = { title: 'e', date: 'not-a-date', resourceOwnerId: 'A', id: 'mZ' };
  assert.equal([...list, badDate].sort((x, y) => compareMoments(x, y, 'oldest')).pop()?.id, 'mZ');
  assert.deepEqual(momentSortTuple(badDate), ['9999-99-99', '99:99', 'A', 'mZ']);
});

test('sorting is stable for identical tuples', () => {
  const one = { title: 'x', date: '2026-01-01', resourceOwnerId: 'A', id: 'same' };
  const two = { title: 'y', date: '2026-01-01', resourceOwnerId: 'A', id: 'same' };
  assert.equal(compareMoments(one, two, 'newest'), 0);
  assert.equal(compareMoments(one, two, 'oldest'), 0);
});
