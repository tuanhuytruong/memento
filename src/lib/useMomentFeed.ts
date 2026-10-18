// Phase 3 Task 3.2: one cursor feed for the main views.
//
// The app previously fetched the caller's entire accessible set at startup and
// every consumer derived from it. This hook is the replacement for the list
// itself: an explicit, cancellable cursor feed with a BOUNDED retained window.
//
// It is deliberately not an infinite list. Keeping every page the user has
// ever scrolled past would make the client's memory grow without limit and
// quietly recreate the problem the server-side bound solves, so at most
// `maxRetainedPages` pages are held and older ones are dropped, with an
// explicit way to move the window instead of silently discarding state.
//
// Three fences keep results honest across account switches:
//   * `generation` — a stale response from a previous account is discarded.
//   * `requestId` — an aborted or superseded request can never land.
//   * `scopeHash` — the server rejects a cursor minted for another filter set,
//     and this mirrors that check client-side so we do not even ask.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TimelineEvent } from '../types';

export interface MomentFeedQuery {
  search?: string;
  selectedYear?: string;
  dateFrom?: string;
  dateTo?: string;
  selectedTags?: string[];
  selectedEmotions?: string[];
  milestonesOnly?: boolean;
  hasImagesOnly?: boolean;
  savedOnly?: boolean;
  trackKey?: string | null;
  sortDirection?: 'newest' | 'oldest';
  limit?: number;
}

export interface MomentFeedPage {
  moments: TimelineEvent[];
  nextCursor: string | null;
  total?: number;
}

/** Deterministic client-side mirror of the server scope hash. */
export function feedScopeHash(query: MomentFeedQuery, generation: number): string {
  const canonical = JSON.stringify({
    g: generation,
    q: query.search ?? '',
    y: query.selectedYear ?? 'all',
    f: query.dateFrom ?? '',
    t: query.dateTo ?? '',
    s: [...(query.selectedTags ?? [])].sort(),
    e: [...(query.selectedEmotions ?? [])].sort(),
    m: Boolean(query.milestonesOnly),
    i: Boolean(query.hasImagesOnly),
    v: Boolean(query.savedOnly),
    k: query.trackKey ?? null,
    d: query.sortDirection ?? 'newest',
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * De-duplicate by composite identity. A live feed is not a snapshot: an edit
 * or a move between two page requests can make a memory appear twice, and the
 * honest response is to show it once and offer Refresh rather than pretend the
 * pages were consistent.
 */
export function dedupeByIdentity(pages: TimelineEvent[][]): TimelineEvent[] {
  const seen = new Set<string>();
  const merged: TimelineEvent[] = [];
  for (const page of pages) {
    for (const event of page) {
      const key = `${event.resourceOwnerId}:${event.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(event);
    }
  }
  return merged;
}

export interface MomentFeedState {
  items: TimelineEvent[];
  total: number | null;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  /** True when older pages were dropped to stay inside the retained window. */
  windowShifted: boolean;
  loadedPages: number;
}

/**
 * The retained window is what makes this bounded. When loading a new page
 * would exceed it, the oldest page is dropped and the window slides, so the
 * client never holds an unbounded number of pages regardless of how far the
 * user scrolls.
 */
export function slideWindow<T>(pages: T[][], maxPages: number): { pages: T[][]; dropped: number } {
  if (pages.length <= maxPages) return { pages, dropped: 0 };
  const dropped = pages.length - maxPages;
  return { pages: pages.slice(dropped), dropped };
}

export function useMomentFeed(options: {
  fetchPage: (args: { cursor: string | null; query: MomentFeedQuery; signal: AbortSignal }) => Promise<MomentFeedPage>;
  query: MomentFeedQuery;
  generation: number;
  enabled?: boolean;
  maxRetainedPages?: number;
}): MomentFeedState & {
  loadMore: () => void;
  older: () => void;
  newer: () => void;
  refresh: () => void;
} {
  const { fetchPage, query, generation, enabled = true, maxRetainedPages = 5 } = options;
  const [pages, setPages] = useState<TimelineEvent[][]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropped, setDropped] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);

  // Identity of the current query + account. Any change invalidates in-flight
  // work and the retained pages together, so one request can never complete
  // into another account's list.
  const scope = feedScopeHash(query, generation);
  const [landedScope, setLandedScope] = useState(scope);
  const currentScope = useRef({ scope, enabled });
  currentScope.current = { scope, enabled };
  const activeController = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const requestId = useRef(0);
  const cursorRef = useRef<string | null>(null);
  const firstCursorRef = useRef<string | null | undefined>(undefined);

  const run = useCallback(async (mode: 'initial' | 'more', existing: TimelineEvent[][]) => {
    if (!enabled) return;
    const id = ++requestId.current;
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    busy.current = true;
    setLoading(true);
    setError(null);
    try {
      const page = await fetchPage({ cursor: mode === 'more' ? cursorRef.current : null, query, signal: controller.signal });
      if (id !== requestId.current || currentScope.current.scope !== scope || !currentScope.current.enabled) return; // superseded: never land
      const next = mode === 'more' ? [...existing, page.moments] : [page.moments];
      const slid = slideWindow(next, maxRetainedPages);
      setLandedScope(scope);
      setPages(slid.pages);
      setDropped(dropped => dropped + slid.dropped);
      cursorRef.current = page.nextCursor;
      setCursor(page.nextCursor);
      if (mode === 'initial') {
        firstCursorRef.current = null;
        setTotal(typeof page.total === 'number' ? page.total : null);
      } else if (typeof page.total === 'number') {
        setTotal(page.total);
      }
    } catch (failure) {
      if (id !== requestId.current || currentScope.current.scope !== scope || !currentScope.current.enabled) return;
      if ((failure as { name?: string })?.name === 'AbortError') return;
      setError(failure instanceof Error ? failure.message : 'Could not load memories. Please retry.');
    } finally {
      if (id === requestId.current) { busy.current = false; setLoading(false); }
    }
  }, [fetchPage, query, scope, enabled, maxRetainedPages]);

  // Reset whenever the account or the filter scope changes.
  useEffect(() => {
    requestId.current += 1;
    cursorRef.current = null;
    firstCursorRef.current = undefined;
    setPages([]);
    setCursor(null);
    setTotal(null);
    setDropped(0);
    setError(null);
    if (enabled) void run('initial', []);
    return () => { activeController.current?.abort(); requestId.current += 1; busy.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, enabled, reloadToken]);

  const loadMore = useCallback(() => {
    if (busy.current || !cursor) return;
    void run('more', pages);
  }, [loading, cursor, pages, run]);

  /** Slide the retained window back toward older content and fetch past it. */
  const older = useCallback(() => {
    if (busy.current || !cursor) return;
    void run('more', pages);
  }, [loading, cursor, pages, run]);

  /** Move the window back toward newer content; a fresh first page. */
  const newer = useCallback(() => {
    if (busy.current) return;
    setDropped(0);
    void run('initial', []);
  }, [loading, run]);

  const refresh = useCallback(() => {
    setDropped(0);
    setReloadToken(token => token + 1);
  }, []);

  return {
    items: enabled && landedScope === scope ? dedupeByIdentity(pages) : [],
    total: enabled && landedScope === scope ? total : null,
    hasMore: enabled && landedScope === scope && cursor !== null,
    loading,
    error,
    windowShifted: dropped > 0,
    loadedPages: pages.length,
    loadMore,
    older,
    newer,
    refresh,
  };
}
