import test from 'node:test';
import assert from 'node:assert/strict';
import { isMonthKey, monthKeyForDate, orderMonths, selectAvailableMonth, stepMonth, clampMonthIndex, initialWheelGesture, accumulateMonthWheel, navigationIdentity, putPreviewPage, getPreviewPage } from '../src/lib/monthBrowse.ts';

test('strict real calendar including leap centuries and year zero', () => {
  for (const key of ['0000-01', '2026-12', '9999-12', 'undated']) assert.equal(isMonthKey(key), true);
  for (const key of ['2026-00', '2026-13', '26-01', '2026-1', '2026-01-01', ' undated']) assert.equal(isMonthKey(key), false);
  assert.equal(monthKeyForDate('2000-02-29'), '2000-02');
  assert.equal(monthKeyForDate('0000-02-29'), '0000-02');
  for (const date of ['1900-02-29', '2025-02-29', '2026-04-31', '2026-01-00', '2026-13-01', '2026-01-01T00:00:00Z', '', null, undefined]) assert.equal(monthKeyForDate(date), 'undated');
});
test('sparse months follow sort, year boundaries, undated and missing selection', () => {
  const months = ['2025-12', '2026-02', 'undated', '2025-12', 'bad'];
  assert.deepEqual(orderMonths(months, 'newest'), ['undated', '2026-02', '2025-12']);
  assert.deepEqual(orderMonths(months, 'oldest'), ['2025-12', '2026-02', 'undated']);
  assert.equal(selectAvailableMonth(months, '2025-12', 'newest'), '2025-12');
  assert.equal(selectAvailableMonth(months, '2026-01', 'newest'), 'undated');
  assert.equal(selectAvailableMonth([], '2026-01', 'newest'), null);
  assert.equal(stepMonth(months, '2026-02', 1, 'newest'), '2025-12');
  assert.equal(stepMonth(months, '2025-12', 1, 'newest'), '2025-12');
  assert.equal(stepMonth(months, 'absent', -1, 'oldest'), '2025-12');
  assert.equal(clampMonthIndex(99, 3), 2);
  assert.equal(clampMonthIndex(-3, 3), 0);
  assert.equal(clampMonthIndex(1, 0), -1);
});
test('wheel accumulates threshold once per idle-delimited burst, ignores pinch and horizontal gestures', () => {
  let state = initialWheelGesture();
  let result = accumulateMonthWheel(state, { deltaY: 30, timeStamp: 0 });
  assert.equal(result.step, 0); state = result.state;
  result = accumulateMonthWheel(state, { deltaY: 30, timeStamp: 20 });
  assert.equal(result.step, 0); state = result.state;
  result = accumulateMonthWheel(state, { deltaY: 30, timeStamp: 40 });
  assert.equal(result.step, 1); state = result.state;
  result = accumulateMonthWheel(state, { deltaY: -1000, timeStamp: 60 });
  assert.equal(result.step, 0); state = result.state;
  result = accumulateMonthWheel(state, { deltaY: -90, timeStamp: 300 });
  assert.equal(result.step, -1);
  assert.deepEqual(accumulateMonthWheel(state, { deltaY: 999, ctrlKey: true, timeStamp: 500 }), { state, step: 0, handled: false });
  assert.equal(accumulateMonthWheel(initialWheelGesture(), { deltaY: 90, deltaX: 100, timeStamp: 0 }).handled, false);
  assert.equal(accumulateMonthWheel(initialWheelGesture(), { deltaY: 5, deltaMode: 1, timeStamp: 0 }).step, 1);
  assert.equal(accumulateMonthWheel(initialWheelGesture(), { deltaY: Number.NaN, timeStamp: 0 }).handled, false);
});
test('navigation keys separate account, scope, month, page and composite target without delimiter collisions', () => {
  const base = { account: 'a', scope: 's', month: '2026-01' as const, page: 'first', target: { ownerId: 'o', id: 'id' } };
  const key = navigationIdentity(base);
  for (const changed of [{ account: 'b' }, { scope: 't' }, { month: 'undated' as const }, { page: 'next' }, { target: { ownerId: 'other', id: 'id' } }]) assert.notEqual(navigationIdentity({ ...base, ...changed }), key);
  assert.notEqual(navigationIdentity({ account: 'a|b', scope: 'c' }), navigationIdentity({ account: 'a', scope: 'b|c' }));
});
test('preview LRU keeps at most three pages, reads touch, replacement immutable', () => {
  let cache = new Map<string, number[]>();
  for (let i = 0; i < 3; i++) cache = putPreviewPage(cache, String(i), [i]);
  const before = cache;
  const hit = getPreviewPage(cache, '0');
  assert.deepEqual(hit.value, [0]); cache = hit.cache;
  cache = putPreviewPage(cache, '3', [3]);
  assert.deepEqual([...cache.keys()], ['2', '0', '3']);
  assert.deepEqual([...before.keys()], ['0', '1', '2']);
  assert.equal(getPreviewPage(cache, '1').value, undefined);
  cache = putPreviewPage(cache, '0', [99]);
  assert.equal(cache.size, 3); assert.deepEqual(cache.get('0'), [99]);
  for (let i = 4; i < 100; i++) cache = putPreviewPage(cache, String(i), [i]);
  assert.equal(cache.size, 3);
});
