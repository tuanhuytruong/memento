// Phase 1 Task 1.1: local date construction at midnight boundaries.
// TZ is set before each construction because Node honours process.env.TZ at
// runtime for new Date() on Linux; both a positive (Asia/Bangkok, +07) and a
// negative (America/New_York, -05/-04) offset are covered, plus year
// transition and invalid dates.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  localCalendarDate,
  localClockTime,
  isRealCalendarDate,
  isCalendarDateString,
  calendarDateToLocalInstant,
  memoryCalendarDate,
} from '../src/lib/localDate';

const withTZ = async (tz: string, work: () => void) => {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try { work(); } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
};

test('an instant near local midnight maps to the LOCAL calendar day, not the UTC day', () => {
  // 2026-04-10 23:30 Bangkok = 2026-04-10 16:30 UTC: same day.
  // 2026-04-10 06:30 Bangkok = 2026-04-09 23:30 UTC: DIFFERENT day.
  withTZ('Asia/Bangkok', () => {
    assert.equal(localCalendarDate(new Date(2026, 3, 10, 23, 30)), '2026-04-10');
    assert.equal(localCalendarDate(new Date(2026, 3, 10, 0, 0)), '2026-04-10', 'exactly local midnight belongs to the new day');
    assert.equal(localCalendarDate(new Date(2026, 3, 10, 0, 0, 0, 999)), '2026-04-10');
    assert.equal(localCalendarDate(new Date(2026, 3, 9, 23, 59, 59, 999)), '2026-04-09', 'one millisecond before local midnight is the old day');
    assert.equal(localClockTime(new Date(2026, 3, 10, 0, 5)), '00:05');
  });
  // A negative UTC offset flips the direction: 22:00 local on the 10th is
  // already 03:00 UTC on the 11th, but the memory stays on the 10th.
  withTZ('America/New_York', () => {
    assert.equal(localCalendarDate(new Date(2026, 3, 10, 22, 0)), '2026-04-10');
    assert.equal(localCalendarDate(new Date(2026, 3, 10, 0, 1)), '2026-04-10');
    assert.equal(localCalendarDate(new Date(2026, 3, 9, 23, 59)), '2026-04-09');
    assert.equal(localClockTime(new Date(2026, 3, 10, 23, 5)), '23:05');
  });
});

test('the UTC-based default is exactly the bug this helper removes', () => {
  withTZ('Asia/Bangkok', () => {
    // 06:30 Bangkok on the 10th is 23:30 UTC on the 9th.
    const instant = new Date(2026, 3, 10, 6, 30);
    assert.equal(instant.toISOString().slice(0, 10), '2026-04-09', 'the old default would have said the 9th');
    assert.equal(localCalendarDate(instant), '2026-04-10', 'the local default says the 10th');
  });
});

test('year transition constructs the right local day', () => {
  withTZ('Asia/Bangkok', () => {
    assert.equal(localCalendarDate(new Date(2026, 11, 31, 23, 59)), '2026-12-31');
    assert.equal(localCalendarDate(new Date(2027, 0, 1, 0, 0)), '2027-01-01');
  });
  withTZ('America/New_York', () => {
    assert.equal(localCalendarDate(new Date(2026, 11, 31, 23, 59)), '2026-12-31');
    assert.equal(localCalendarDate(new Date(2027, 0, 1, 0, 0)), '2027-01-01');
  });
});

test('calendar validity rejects overflow and malformed dates', () => {
  assert.equal(isRealCalendarDate('2026-02-30'), false, 'Feb 30 must never roll into March');
  assert.equal(isRealCalendarDate('2026-13-01'), false);
  assert.equal(isRealCalendarDate('2026-00-10'), false);
  assert.equal(isRealCalendarDate('2026-04-31'), false);
  assert.equal(isRealCalendarDate('2026-4-1'), false, 'shape is strict: two-digit month and day');
  assert.equal(isRealCalendarDate('2024-02-29'), true, 'leap day is real');
  assert.equal(isRealCalendarDate('2026-02-29'), false, 'non-leap Feb 29 is not');
  assert.equal(isRealCalendarDate(''), false);
  assert.equal(isRealCalendarDate(null), false);
  assert.equal(isCalendarDateString('2026-04-10T10:00:00Z'), false, 'shape check is date-only');
});

test('a calendar date resolves to a local-midnight instant or null, never a guess', () => {
  withTZ('Asia/Bangkok', () => {
    const instant = calendarDateToLocalInstant('2026-04-10');
    assert.ok(instant);
    assert.equal(instant.getFullYear(), 2026);
    assert.equal(instant.getMonth(), 3);
    assert.equal(instant.getDate(), 10);
    assert.equal(instant.getHours(), 0);
    assert.equal(instant.getMinutes(), 0);
  });
  assert.equal(calendarDateToLocalInstant('2026-02-30'), null);
  assert.equal(calendarDateToLocalInstant('nonsense'), null);
});

test('a memory keeps the calendar day its author chose, even in timestamp form', () => {
  assert.equal(memoryCalendarDate('2026-04-10'), '2026-04-10');
  // The author wrote this instant with an explicit +07:00 offset; the calendar
  // day is the literal prefix, and re-rendering it in UTC would say the 9th.
  assert.equal(memoryCalendarDate('2026-04-10T23:30:00+07:00'), '2026-04-10');
  assert.equal(memoryCalendarDate('2026-04-10T00:30:00Z'), '2026-04-10');
  assert.equal(memoryCalendarDate('2026-12-31T23:59:59-05:00'), '2026-12-31');
});
