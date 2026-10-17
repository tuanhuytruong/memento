import type { EventTrack, TimelineEvent } from '../types';
import { momentIdentity, trackIdentity } from './resourceIdentity';

export type ResurfacingReason =
  | 'anniversary'
  | 'month-last-year'
  | 'track-not-revisited'
  | 'track-to-revisit'
  | 'first-recorded-entry';

/** Minimal visit data returned by the private track-visit endpoint. */
export interface MemoryVisit {
  trackId: string;
  trackOwnerId?: string | null;
  lastOpenedAt: string;
}

export interface ResurfacedMemory {
  momentIdentity: string;
  trackIdentity: string;
  reason: ResurfacingReason;
}

export interface SelectResurfacedMemoriesOptions {
  events: readonly TimelineEvent[];
  tracks: readonly EventTrack[];
  visits: readonly MemoryVisit[];
  /** A browser-local calendar date (or Date whose local date is used). */
  today: string | Date;
  limit?: number;
}

interface DatedEvent {
  event: TimelineEvent;
  date: string;
  momentIdentity: string;
  trackIdentity: string;
}

interface Candidate extends ResurfacedMemory {
  rank: number;
  date: string;
  tieKey: string;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_PREFIX = /^(\d{4})-(\d{2})-(\d{2})T/;
const DAY_MS = 24 * 60 * 60 * 1000;

function validCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Date-only values retain their written day; timestamps use the runtime's local day. */
function localCalendarDate(value: string | Date): string | null {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    return `${String(value.getFullYear()).padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }

  const dateOnly = DATE_ONLY.exec(value);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return validCalendarDate(Number(year), Number(month), Number(day)) ? value : null;
  }

  const timestamp = ISO_PREFIX.exec(value);
  if (!timestamp) return null;
  const [, year, month, day] = timestamp;
  if (!validCalendarDate(Number(year), Number(month), Number(day))) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return `${String(parsed.getFullYear()).padStart(4, '0')}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

function dayNumber(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  const utc = new Date(0);
  utc.setUTCHours(0, 0, 0, 0);
  utc.setUTCFullYear(year, month - 1, day);
  return Math.floor(utc.getTime() / DAY_MS);
}

function dateParts(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Select up to three currently-accessible memories. This function performs no I/O;
 * caller-provided tracks are the access boundary and owner+id identities are always
 * matched together. Reason labels are data only; presentation copy belongs in UI.
 */
export function selectResurfacedMemories({
  events,
  tracks,
  visits,
  today,
  limit = 3,
}: SelectResurfacedMemoriesOptions): ResurfacedMemory[] {
  const todayDate = localCalendarDate(today);
  if (!todayDate) return [];
  const todayParts = dateParts(todayDate);
  const maxResults = Number.isFinite(limit) ? Math.min(3, Math.max(0, Math.floor(limit))) : 0;
  if (maxResults === 0) return [];

  const accessibleTracks = new Map<string, EventTrack>();
  for (const track of tracks) {
    const identity = trackIdentity(track);
    if (!accessibleTracks.has(identity)) accessibleTracks.set(identity, track);
  }

  // A removed/revoked track or mismatched owner never makes it into the candidate pool.
  const datedEvents: DatedEvent[] = [];
  for (const event of events) {
    const ownerTrackIdentity = trackIdentity({ id: event.eventId, resourceOwnerId: event.resourceOwnerId });
    if (!accessibleTracks.has(ownerTrackIdentity)) continue;
    const date = localCalendarDate(event.date);
    if (!date || date > todayDate) continue;
    datedEvents.push({ event, date, momentIdentity: momentIdentity(event), trackIdentity: ownerTrackIdentity });
  }
  datedEvents.sort((a, b) => compareText(a.date, b.date) || compareText(a.momentIdentity, b.momentIdentity));
  const uniqueEvents = new Map<string, DatedEvent>();
  for (const item of datedEvents) if (!uniqueEvents.has(item.momentIdentity)) uniqueEvents.set(item.momentIdentity, item);
  const validEvents = [...uniqueEvents.values()];

  // If duplicate/stale visit records are supplied, retain the latest valid local date
  // for the exact track identity; unusable history is never described as stale.
  const latestVisitByTrack = new Map<string, string>();
  for (const visit of visits) {
    const identity = trackIdentity({ id: visit.trackId, resourceOwnerId: visit.trackOwnerId });
    if (!accessibleTracks.has(identity)) continue;
    const lastOpened = localCalendarDate(visit.lastOpenedAt);
    if (!lastOpened || lastOpened > todayDate) continue;
    const previous = latestVisitByTrack.get(identity);
    if (!previous || lastOpened > previous) latestVisitByTrack.set(identity, lastOpened);
  }

  const candidates: Candidate[] = [];
  const seenCandidate = new Set<string>();
  const add = (item: DatedEvent, reason: ResurfacingReason, rank: number) => {
    if (seenCandidate.has(item.momentIdentity)) return;
    seenCandidate.add(item.momentIdentity);
    candidates.push({
      momentIdentity: item.momentIdentity,
      trackIdentity: item.trackIdentity,
      reason,
      rank,
      date: item.date,
      // Stable within a day and independent of input order; identity breaks same-date ties.
      tieKey: `${todayDate}|${item.date}|${item.momentIdentity}`,
    });
  };

  // Rank 1: same month/day in any earlier year (including leap-day exact matches only).
  for (const item of validEvents) {
    const parts = dateParts(item.date);
    if (parts.year < todayParts.year && parts.month === todayParts.month && parts.day === todayParts.day) {
      add(item, 'anniversary', 1);
    }
  }

  // Rank 2: same month exactly one year earlier. Anniversary candidates already win.
  for (const item of validEvents) {
    const parts = dateParts(item.date);
    if (parts.year === todayParts.year - 1 && parts.month === todayParts.month) {
      add(item, 'month-last-year', 2);
    }
  }

  // Rank 3: one representative for each unvisited/stale track, milestone first then oldest.
  const eventsByTrack = new Map<string, DatedEvent[]>();
  for (const item of validEvents) {
    const group = eventsByTrack.get(item.trackIdentity) ?? [];
    group.push(item);
    eventsByTrack.set(item.trackIdentity, group);
  }
  for (const [identity, group] of eventsByTrack) {
    const lastOpened = latestVisitByTrack.get(identity);
    if (lastOpened && dayNumber(todayDate) - dayNumber(lastOpened) < 90) continue;
    const reason: ResurfacingReason = lastOpened ? 'track-not-revisited' : 'track-to-revisit';
    const representative = [...group].sort((a, b) =>
      Number(Boolean(b.event.isMilestone)) - Number(Boolean(a.event.isMilestone)) ||
      compareText(a.date, b.date) || compareText(a.momentIdentity, b.momentIdentity),
    )[0];
    if (representative) add(representative, reason, 3);
  }

  // Rank 4: earliest valid past entry in each track, explicitly not a life-event claim.
  for (const group of eventsByTrack.values()) {
    const earliest = [...group].sort((a, b) => compareText(a.date, b.date) || compareText(a.momentIdentity, b.momentIdentity))[0];
    if (earliest) add(earliest, 'first-recorded-entry', 4);
  }

  candidates.sort((a, b) => a.rank - b.rank || compareText(a.tieKey, b.tieKey));

  const selected: Candidate[] = [];
  const selectedMoments = new Set<string>();
  const selectedTracks = new Set<string>();
  // Prefer one result per track where possible, without allowing lower-ranked
  // duplicates to crowd out distinct-track memories.
  for (const candidate of candidates) {
    if (selected.length >= maxResults) break;
    if (selectedTracks.has(candidate.trackIdentity)) continue;
    selected.push(candidate);
    selectedMoments.add(candidate.momentIdentity);
    selectedTracks.add(candidate.trackIdentity);
  }
  if (selected.length < maxResults) {
    for (const candidate of candidates) {
      if (selected.length >= maxResults) break;
      if (selectedMoments.has(candidate.momentIdentity)) continue;
      selected.push(candidate);
      selectedMoments.add(candidate.momentIdentity);
    }
  }

  return selected.map(({ momentIdentity: selectedMoment, trackIdentity: selectedTrack, reason }) => ({
    momentIdentity: selectedMoment,
    trackIdentity: selectedTrack,
    reason,
  }));
}
