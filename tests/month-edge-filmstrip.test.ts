import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EDGE_ARC_SLOTS, EDGE_HIT_SIZE, EDGE_IDLE_WIDTH, EDGE_PREVIEW_MAX, EDGE_PREVIEW_MIN, EDGE_RAIL_HEIGHT, EDGE_SLOT_REGION,
  accumulateRailWheel, arcPath, arcShape, arcX, hitSlots, initialRailWheel,
  placeRail, previewWidthFor, railMonthLabel, railStep, railTickLabel, slotCountFor, slotOffset, tickLine, windowIndexes,
} from '../src/lib/monthEdgeFilmstrip.ts';

const at = (id: string) => ({ ownerId: 'owner', id, date: '2026-10-15', title: `Title ${id}` });

test('arc centre is off-canvas, so the widget is a shallow crescent and never a full sun', () => {
  for (const region of [220, 160, 88]) {
    const shape = arcShape(region);
    assert(shape.centerX > shape.bulge, `centre ${shape.centerX} must sit outside the ${shape.bulge}px box`);
    assert(shape.radius > shape.bulge, 'radius exceeds the exposed bulge');
    assert(shape.span > 0 && shape.span < Math.PI, 'visible span is a partial arc');
    const apex = arcX(0, shape);
    assert.equal(apex, 0, "the arc apex sits on the box's inner edge");
    const edge = Math.round((shape.radius * Math.sin(shape.span / 2)) * 0.8);
    for (const offset of [-edge, -40, 40, edge]) {
      assert(arcX(offset, shape) > apex, 'ticks recede toward the viewport edge away from the apex');
      assert(arcX(offset, shape) < shape.bulge, 'ticks stay inside the exposed bulge');
      assert.equal(arcX(offset, shape), arcX(-offset, shape), 'the crescent is symmetric');
    }
  }
});

test('the drawn arc is an open path inside the box, never a closed circle', () => {
  const shape = arcShape();
  const path = arcPath(shape);
  assert(path.startsWith('M ') && !path.endsWith('Z'), 'arc path is open');
  assert.equal((path.match(/A /g) ?? []).length, 1, 'one arc segment only');
  // Parse the move and the single arc endpoint explicitly; arc flags are not coordinates.
  const move = /^M (-?[0-9.]+) (-?[0-9.]+)/.exec(path);
  const arc = /A ([0-9.]+) ([0-9.]+) 0 0 1 (-?[0-9.]+) (-?[0-9.]+)$/.exec(path);
  assert(move && arc, `unexpected arc path ${path}`);
  const startX = Number(move![1]);
  const endX = Number(arc![3]);
  assert(Number(arc![1]) === shape.radius, 'the arc uses the off-canvas circle radius');
  for (const x of [startX, endX]) assert(x >= -1 && x <= shape.bulge + 1, `path x ${x} within the box`);
  assert.equal(startX, endX, 'both arc ends sit at the same inset from the viewport edge');
  assert(startX > arcX(0, shape), 'the arc apex reaches further inward than its ends');
  const tick = tickLine(-40, shape);
  assert(tick.x1 >= 0 && tick.x2 <= shape.bulge && tick.x2 > tick.x1);
  assert.equal(slotOffset({ index: 0, top: 0, height: EDGE_HIT_SIZE }, EDGE_SLOT_REGION), -EDGE_SLOT_REGION / 2 + EDGE_HIT_SIZE / 2);
});

test('hit slots are disjoint and each at least 44px, so a thin tick is not a thin target', () => {
  for (const count of [1, 3, 5]) {
    const slots = hitSlots(count);
    assert.equal(slots.length, count);
    for (const slot of slots) assert(slot.height >= EDGE_HIT_SIZE, `slot ${slot.index} height ${slot.height}`);
    for (let index = 1; index < slots.length; index++) {
      assert.equal(slots[index].top, slots[index - 1].top + slots[index - 1].height, 'slots do not overlap');
    }
  }
  assert.equal(slotCountFor(220), 5);
  assert.equal(slotCountFor(88), 2);
  assert.equal(slotCountFor(10), 1);
  assert.deepEqual(hitSlots(0), []);
});

test('window indexes are chronological, capped and clamped at both edges', () => {
  assert.deepEqual(windowIndexes(0, 0), []);
  assert.deepEqual(windowIndexes(1, 0), [0]);
  assert.deepEqual(windowIndexes(3, 2), [0, 1, 2]);
  assert.deepEqual(windowIndexes(24, 0), [0, 1, 2, 3, 4]);
  assert.deepEqual(windowIndexes(24, 12), [10, 11, 12, 13, 14]);
  assert.deepEqual(windowIndexes(24, 23), [19, 20, 21, 22, 23]);
  assert.deepEqual(windowIndexes(24, -5), [0, 1, 2, 3, 4]);
  assert.equal(new Set(windowIndexes(24, 12)).size, EDGE_ARC_SLOTS);
  assert.deepEqual(windowIndexes(2, 0, 5), [0, 1], 'a short page never fabricates indexes');
});

test('rail steps clamp at loaded edges and only then request a bounded page', () => {
  assert.deepEqual(railStep(0, 24, -1, true, false), { index: 0, page: null });
  assert.deepEqual(railStep(0, 24, -1, true, true), { index: 0, page: 'previous' });
  assert.deepEqual(railStep(23, 24, 1, false, true), { index: 23, page: null });
  assert.deepEqual(railStep(23, 24, 1, true, true), { index: 23, page: 'next' });
  assert.deepEqual(railStep(5, 24, 1, true, true), { index: 6, page: null });
  assert.deepEqual(railStep(0, 0, 1, true, true), { index: 0, page: null });
  assert.deepEqual(railStep(99, 24, 5, false, false), { index: 23, page: null });
});

test('wheel accumulation fires one step per settled gesture and ignores pinch/horizontal input', () => {
  let state = initialRailWheel();
  let steps = 0;
  for (const deltaY of [40, 40, 40]) {
    const result = accumulateRailWheel(state, { deltaY, timeStamp: 100 + steps * 10 + 5 });
    state = result.state;
    steps += Math.abs(result.step);
    assert(result.handled);
  }
  assert.equal(steps, 1, 'rapid pixel deltas produce exactly one step');

  const settled = accumulateRailWheel(initialRailWheel(), { deltaY: 100, timeStamp: 10_000 });
  assert.equal(settled.step, 1);
  const reverse = accumulateRailWheel(settled.state, { deltaY: -100, timeStamp: 10_050 });
  assert.equal(reverse.step, 0, 'the same gesture cannot reverse-fire');
  const later = accumulateRailWheel(reverse.state, { deltaY: -100, timeStamp: 10_400 });
  assert.equal(later.step, -1, 'a new gesture after idle fires the opposite direction');

  assert.equal(accumulateRailWheel(initialRailWheel(), { deltaY: 120, deltaX: 200, timeStamp: 1 }).handled, false);
  assert.equal(accumulateRailWheel(initialRailWheel(), { deltaY: 120, ctrlKey: true, timeStamp: 1 }).handled, false);
  assert.equal(accumulateRailWheel(initialRailWheel(), { deltaY: 0, timeStamp: 1 }).handled, false);
  assert.equal(accumulateRailWheel(initialRailWheel(), { deltaY: 120, deltaMode: 1, timeStamp: 1 }).step, 1, 'line deltas are normalised');
  assert.equal(accumulateRailWheel(initialRailWheel(), { deltaY: 120, deltaMode: 2, timeStamp: 1 }).step, 1, 'page deltas are normalised');
  assert.equal(accumulateRailWheel(initialRailWheel(), { deltaY: 200, timeStamp: 5 }).direction, 1);
  assert.equal(accumulateRailWheel(initialRailWheel(), { deltaY: -200, timeStamp: 5 }).direction, -1);
});

test('placement keeps the rail inside the viewport and off known overlay bands', () => {
  const height = EDGE_RAIL_HEIGHT;
  const centred = placeRail({ viewportHeight: 900 });
  assert.equal(centred, Math.round((900 - height) / 2));
  assert.equal(placeRail({ viewportHeight: 100 }), null, 'no room for the rail');
  const blocked = placeRail({ viewportHeight: 900, blocked: [{ top: centred! - 60, bottom: centred! + height + 60 }] });
  assert.equal(blocked, null, 'a fully blocking band hides the rail instead of covering it');
  const partial = placeRail({ viewportHeight: 900, blocked: [{ top: 0, bottom: 200 }] });
  assert(partial !== null && partial >= 200, 'a top band pushes the rail down');
  assert.equal(placeRail({ viewportHeight: 900, railHeight: 900 }), null, 'oversized rail cannot be placed');
});

test('preview width respects the free gutter or refuses to mount', () => {
  assert.equal(previewWidthFor(600), EDGE_PREVIEW_MAX);
  assert.equal(previewWidthFor(EDGE_IDLE_WIDTH + 8 + 150), 150);
  assert.equal(previewWidthFor(EDGE_IDLE_WIDTH + 8 + EDGE_PREVIEW_MIN - 1), null);
  assert.equal(previewWidthFor(EDGE_IDLE_WIDTH + 8 + EDGE_PREVIEW_MIN), EDGE_PREVIEW_MIN);
  assert.equal(previewWidthFor(0), null);
});

test('labels stay chronological and readable for undated or malformed months', () => {
  assert.match(railTickLabel(at('x'), 2, 11), /Memory 2 of 11: 2026-10-15 · Title x/);
  assert.match(railTickLabel({ date: null, title: '' }, 1, 1), /Memory 1 of 1: Undated · Untitled memory/);
  assert.equal(railMonthLabel('undated'), 'Undated');
  assert.match(railMonthLabel('2026-10'), /2026/);
  assert.equal(railMonthLabel('nonsense'), 'Undated');
});
