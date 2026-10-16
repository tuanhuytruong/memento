import test from 'node:test';
import assert from 'node:assert/strict';
import type { EventTrack, TimelineEvent } from '../src/types';
import { selectResurfacedMemories, type MemoryVisit, type ResurfacingReason } from '../src/lib/memoryResurfacing';

const track = (id: string, owner = 'owner-a'): EventTrack => ({
  id, resourceOwnerId: owner, title: id, description: '', color: '', icon: '', tags: [],
  createdAt: '2020-01-01', updatedAt: '2020-01-01',
});
const event = (id: string, eventId: string, date: string, owner = 'owner-a', extra: Partial<TimelineEvent> = {}): TimelineEvent => ({
  id, eventId, resourceOwnerId: owner, title: id, date, description: '', tags: [], images: [],
  createdAt: date, updatedAt: date, ...extra,
});
const visit = (trackId: string, lastOpenedAt: string, trackOwnerId = 'owner-a'): MemoryVisit => ({ trackId, trackOwnerId, lastOpenedAt });
const reasons = (result: ReturnType<typeof selectResurfacedMemories>): ResurfacingReason[] => result.map(x => x.reason);

test('uses injected local calendar dates for date-only values and ISO timestamps', () => {
  const previousTz = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    const result = selectResurfacedMemories({
      events: [event('date-only', 't', '2024-06-15'), event('timestamp', 't', '2024-06-16T06:30:00Z')],
      tracks: [track('t')], visits: [], today: '2025-06-15', limit: 3,
    });
    assert.deepEqual(result.map(x => x.momentIdentity), ['owner-a:date-only', 'owner-a:timestamp']);
    assert.deepEqual(reasons(result), ['anniversary', 'anniversary']);
  } finally {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  }
});

test('recognizes Feb 29 anniversaries only on Feb 29 and otherwise uses truthful month reason', () => {
  const onLeapDay = selectResurfacedMemories({
    events: [event('leap', 't', '2020-02-29')], tracks: [track('t')], visits: [], today: '2024-02-29',
  });
  assert.deepEqual(reasons(onLeapDay), ['anniversary']);

  const onNonLeapYear = selectResurfacedMemories({
    events: [event('leap', 't', '2024-02-29')], tracks: [track('t')], visits: [], today: '2025-02-28',
  });
  assert.deepEqual(reasons(onNonLeapYear), ['month-last-year']);
});

test('handles year boundaries, invalid dates, and future moments without inventing history', () => {
  const result = selectResurfacedMemories({
    events: [
      event('jan-first', 't', '2025-01-01'),
      event('future', 't', '2026-12-31'),
      event('invalid', 't', '2025-02-30'),
      event('bad', 't', 'not-a-date'),
    ],
    tracks: [track('t')], visits: [], today: '2026-01-01',
  });
  assert.deepEqual(result.map(x => x.momentIdentity), ['owner-a:jan-first']);
  assert.deepEqual(reasons(result), ['anniversary']);
});

test('returns fewer than the limit when only one eligible memory exists', () => {
  const result = selectResurfacedMemories({
    events: [event('only', 't', '2024-10-16')], tracks: [track('t')], visits: [], today: '2025-10-16', limit: 3,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].reason, 'anniversary');
});

test('keeps equal moment and track IDs distinct across exact owners', () => {
  const result = selectResurfacedMemories({
    events: [event('same-id', 'same-track', '2024-10-16', 'owner-b'), event('same-id', 'same-track', '2024-10-16', 'owner-a')],
    tracks: [track('same-track', 'owner-a'), track('same-track', 'owner-b')], visits: [], today: '2025-10-16', limit: 3,
  });
  assert.deepEqual(result.map(x => x.momentIdentity), ['owner-a:same-id', 'owner-b:same-id']);
  assert.deepEqual(result.map(x => x.trackIdentity), ['owner-a:same-track', 'owner-b:same-track']);
});

test('uses neutral no-history reason and distinguishes a real stale visit from a recent visit', () => {
  const events = [event('never-opened', 'never', '2025-01-01'), event('stale', 'stale-track', '2025-01-02'), event('recent', 'recent-track', '2025-01-03')];
  const tracks = [track('never'), track('stale-track'), track('recent-track')];
  const withoutHistory = selectResurfacedMemories({ events, tracks, visits: [], today: '2025-10-16', limit: 3 });
  assert.deepEqual(withoutHistory.map(x => x.reason), ['track-to-revisit', 'track-to-revisit', 'track-to-revisit']);

  const withHistory = selectResurfacedMemories({
    events, tracks,
    visits: [visit('stale-track', '2025-07-18T12:00:00Z'), visit('recent-track', '2025-10-15T12:00:00Z')],
    today: '2025-10-16', limit: 3,
  });
  assert.ok(withHistory.some(x => x.momentIdentity === 'owner-a:stale' && x.reason === 'track-not-revisited'));
  assert.ok(!withHistory.some(x => x.trackIdentity === 'owner-a:recent-track' && x.reason === 'track-to-revisit'));
});

test('chooses one chapter representative, favoring milestones then the oldest valid moment', () => {
  const events = [
    event('old-non-milestone', 't', '2020-01-01'),
    event('new-milestone', 't', '2023-01-01', 'owner-a', { isMilestone: true }),
    event('old-milestone', 't', '2021-01-01', 'owner-a', { isMilestone: true }),
  ];
  const result = selectResurfacedMemories({ events, tracks: [track('t')], visits: [], today: '2025-10-16', limit: 3 });
  assert.deepEqual(result.map(x => x.momentIdentity), ['owner-a:old-milestone', 'owner-a:old-non-milestone']);
  assert.deepEqual(result.map(x => x.reason), ['track-to-revisit', 'first-recorded-entry']);
});

test('ignores removed tracks and stale visit records that do not match exact accessible identities', () => {
  const result = selectResurfacedMemories({
    events: [event('removed', 'gone', '2024-10-16'), event('wrong-owner-track', 'current', '2024-10-16', 'owner-b')],
    tracks: [track('current', 'owner-a')], visits: [visit('gone', '2020-01-01'), visit('current', '2020-01-01', 'owner-b')],
    today: '2025-10-16',
  });
  assert.deepEqual(result, []);
});

test('limits results to three unique moments and uses deterministic day/identity tie-breaks', () => {
  const result = selectResurfacedMemories({
    events: [
      event('z', 'tz', '2024-10-16'), event('a', 'ta', '2024-10-16'), event('b', 'tb', '2024-10-16'), event('c', 'tc', '2024-10-16'),
      event('a', 'ta', '2024-10-16'),
    ],
    tracks: [track('tz'), track('ta'), track('tb'), track('tc')], visits: [], today: '2025-10-16', limit: 99,
  });
  assert.equal(result.length, 3);
  assert.equal(new Set(result.map(x => x.momentIdentity)).size, 3);
  assert.deepEqual(result.map(x => x.momentIdentity), ['owner-a:a', 'owner-a:b', 'owner-a:c']);
  assert.equal(selectResurfacedMemories({ events: [], tracks: [], visits: [], today: '2025-10-16', limit: 0 }).length, 0);
});
