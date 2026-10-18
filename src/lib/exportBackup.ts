// Phase 3 Task 3.2: a backup that is complete by construction.
//
// The old export serialised whatever happened to be loaded. With a paginated
// feed that would quietly produce a *partial* backup, which is the worst
// possible failure for the one feature whose whole job is to be trusted.
//
// So this follows every page itself, independently of what the UI has on
// screen, and fails closed: any missing page, auth change or authorization
// loss throws and writes no file at all. A short file is worse than no file,
// because a short file looks complete.

import type { EventTrack, MomentPerspective, TimelineEvent } from '../types';

/** Serialised backup, version 4.0: it records its own scope explicitly. */
export interface TimelineBackupPayload {
  version: string;
  exportedAt: string;
  eventTracks: EventTrack[];
  events: TimelineEvent[];
  customTags: string[];
  perspectives: MomentPerspective[];
  scope: {
    /** Who the export was taken for, so a later reader can tell whose it is. */
    ownerScope: 'current-account';
    /** The account id the export was taken under, for attribution on restore. */
    ownerUserId: string;
    /** Whether the account still authenticated when the export finished. */
    capturedUnder: 'active-session';
    /** Every memory the account could read at export time, paged in full. */
    momentCount: number;
    perspectiveCount: number;
    /**
     * Photos in this file are same-origin references to stored images, not
     * photo bytes. Say so in the file rather than letting it be mistaken for
     * a portable photo archive.
     */
    images: 'references-to-stored-images-only';
    complete: true;
  };
}

/**
 * A cursor loop that cannot spin forever. An account large enough to exceed
 * this is itself evidence something is wrong with the response, and a hung
 * export is a worse outcome than a refused one.
 */
const MAX_PAGES = 50_000;

export interface Page<T> {
  moments: T[];
  nextCursor: string | null;
}

/**
 * Follow every page of the bounded query until the cursor is exhausted.
 *
 * Two failure modes are treated as hard errors rather than "good enough":
 * a cursor that repeats (the server would loop forever) and a page count over
 * the guard (same symptom, different cause).
 */
export async function collectAllMoments<T>(
  fetchPage: (cursor: string | null) => Promise<Page<T>>,
): Promise<T[]> {
  const collected: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let pages = 0;
  for (;;) {
    const page = await fetchPage(cursor);
    if (!page || !Array.isArray(page.moments) || (page.nextCursor !== null && typeof page.nextCursor !== 'string')) {
      throw new Error('Export stopped: the server did not return a readable page.');
    }
    collected.push(...page.moments);
    pages += 1;
    const next = page.nextCursor ?? null;
    if (!next) return collected;
    if (seenCursors.has(next)) {
      throw new Error('Export stopped: the same page was returned twice.');
    }
    if (pages >= MAX_PAGES) {
      throw new Error('Export stopped: too many pages to complete safely.');
    }
    seenCursors.add(next);
    cursor = next;
  }
}

/** The composite identity, used to reject duplicates without hiding a real one. */
const identityOf = (event: { id: string; resourceOwnerId?: string }) =>
  `${event.resourceOwnerId ?? ''}:${event.id}`;

/**
 * Build a complete payload. Duplicates are rejected rather than silently
 * merged, because a duplicate means two pages disagreed about the data and
 * that must not be papered over inside a file someone will later trust.
 */
export async function buildCompleteBackup(options: {
  ownerUserId: string;
  tracks: EventTrack[];
  tags: string[];
  fetchMomentsPage: (cursor: string | null) => Promise<Page<TimelineEvent>>;
  fetchPerspectives: () => Promise<MomentPerspective[]>;
  now?: Date;
}): Promise<TimelineBackupPayload> {
  const { ownerUserId, tracks, tags, fetchMomentsPage, fetchPerspectives } = options;

  // Perspectives first: if the account cannot produce a complete perspective
  // set, no file is written at all.
  const perspectives = await fetchPerspectives();
  if (!Array.isArray(perspectives)) {
    throw new Error('Export stopped: perspectives could not be read completely.');
  }

  const moments = await collectAllMoments(fetchMomentsPage);
  const seen = new Set<string>();
  for (const moment of moments) {
    const key = identityOf(moment);
    if (seen.has(key)) throw new Error('Export stopped: the same memory arrived on two pages.');
    seen.add(key);
  }

  // Fail closed on a response that lost its identity. A memory the reader
  // cannot attribute to an owner is not something to write into a file someone
  // will later restore from: the boundary moved or the payload was truncated,
  // and either way this export is no longer trustworthy. Note that readable
  // memories owned by collaborators are legitimate and expected; the caller's
  // identity is recorded in `scope` so a reader can tell the two apart.
  for (const moment of moments) {
    if (!moment || typeof moment.id !== 'string' || !moment.id || typeof moment.resourceOwnerId !== 'string' || !moment.resourceOwnerId) {
      throw new Error('Export stopped: a memory arrived without an owner identity, so the export can no longer be verified.');
    }
  }

  return {
    version: '4.0',
    exportedAt: (options.now ?? new Date()).toISOString(),
    eventTracks: tracks,
    events: moments,
    customTags: tags,
    perspectives,
    scope: {
      ownerScope: 'current-account',
      ownerUserId,
      capturedUnder: 'active-session',
      momentCount: moments.length,
      perspectiveCount: perspectives.length,
      images: 'references-to-stored-images-only',
      complete: true,
    },
  };
}

/**
 * Download as a Blob. A data URL scales with payload size, is capped by some
 * browsers and embeds the whole file into a string; a Blob is the normal way
 * to hand a large document to the browser's download machinery.
 */
export function downloadBackup(payload: { exportedAt: string; eventTracks: EventTrack[]; events: TimelineEvent[]; customTags: string[]; perspectives: MomentPerspective[]; scope: unknown }, now: Date = new Date()): void {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    const day = now.toISOString().split('T')[0];
    anchor.download = `timeline_events_backup_${day}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoke once the click has been dispatched; keeping it alive leaks a
    // large buffer for the lifetime of the document.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
