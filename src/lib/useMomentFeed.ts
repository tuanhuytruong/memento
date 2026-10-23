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
  previousCursor?: string | null;
  target?: {ownerId:string;id:string};
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

export function isFeedAccessFailure(error: unknown): boolean {
  return [401,403,404].includes((error as {status?:number})?.status ?? 0);
}

export interface MomentFeedState {
  items: TimelineEvent[];
  total: number | null;
  hasMore: boolean;
  loading: boolean;
  /** Only same-scope cursor append keeps the existing cards mounted. */
  appendLoading: boolean;
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

/** Two-sided eviction shares exactly the same policy for documents and boundary cursors. */
export function retainDirectional<T>(pages:T[],maximum:number,navigation:'next'|'previous'):T[]{return navigation==='previous'?pages.slice(0,maximum):pages.slice(-maximum);}
export function useMomentFeed(options: {
  fetchPage: (args: { cursor: string | null; navigation?: 'next'|'previous'; query: MomentFeedQuery; signal: AbortSignal }) => Promise<MomentFeedPage>;
  fetchSeek?: (query:MomentFeedQuery,target:{ownerId:string;id:string}|{month:string},signal:AbortSignal)=>Promise<MomentFeedPage>;
  query: MomentFeedQuery;
  generation: number;
  enabled?: boolean;
  paused?: boolean;
  maxRetainedPages?: number;
}): MomentFeedState & {
  snapshot: boolean;
  settled: boolean;
  retry: () => void;
  /** Successful retried navigation hands its committed page to App landing. */
  retryLanding: {page:MomentFeedPage;requestId:number}|null;
  seek: (target:{ownerId:string;id:string}|{month:string},signal?:AbortSignal)=>Promise<MomentFeedPage|null>;
  loadPrevious:()=>void;
  hasPrevious:boolean;
  seeking:boolean;
  navigationTarget:{ownerId:string;id:string}|{month:string}|null;
  loadMore: () => void;
  older: () => void;
  newer: () => void;
  refresh: () => void;
} {
  const { fetchPage, fetchSeek, query, generation, enabled = true, paused = false, maxRetainedPages = 5 } = options;
  const [hasPrevious,setHasPrevious]=useState(false);
  const [seeking,setSeeking]=useState(false);
  const [navigationTarget,setNavigationTarget]=useState<{ownerId:string;id:string}|{month:string}|null>(null);
  const pageBounds=useRef<MomentFeedPage[]>([]);
  const anchor=useRef<{ownerId:string;id:string}|{month:string}|null>(null);
  const [pages, setPages] = useState<TimelineEvent[][]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [appendLoading, setAppendLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropped, setDropped] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);

  // Identity of the current query + account. Any change invalidates in-flight
  // work and the retained pages together, so one request can never complete
  // into another account's list.
  const scope = feedScopeHash(query, generation);
  const [landedScope, setLandedScope] = useState<string | null>(null);
  const [landedGeneration, setLandedGeneration] = useState(generation);
  const [denied, setDenied] = useState(false);
  const failedOperation = useRef<(() => void) | null>(null);
  const [retryLanding,setRetryLanding]=useState<{page:MomentFeedPage;requestId:number}|null>(null);
  const currentScope = useRef({ scope, enabled, paused });
  currentScope.current = { scope, enabled, paused };
  const activeController = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const requestId = useRef(0);
  const cursorRef = useRef<string | null>(null);
  const firstCursorRef = useRef<string | null | undefined>(undefined);

  const run = useCallback(async (mode: 'initial' | 'more' | 'previous', existing: TimelineEvent[][], retryCursor?: string | null) => {
    if (!enabled || paused) return;
    setRetryLanding(null);
    const id = ++requestId.current;
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    busy.current = true;
    setLoading(true);
    setAppendLoading(mode !== 'initial');
    setError(null);
    const requestedCursor = retryCursor !== undefined ? retryCursor : mode === 'more' ? cursorRef.current : mode === 'previous' ? pageBounds.current[0]?.previousCursor ?? null : null;
    failedOperation.current = () => { void run(mode, existing, requestedCursor); };
    try {
      const page = await fetchPage({ cursor: requestedCursor, navigation: mode === 'previous' ? 'previous':'next', query, signal: controller.signal });
      if (id !== requestId.current || currentScope.current.scope !== scope || !currentScope.current.enabled || currentScope.current.paused) return; // superseded: never land
      const next = mode === 'more' ? [...existing, page.moments] : mode === 'previous' ? [page.moments,...existing] : [page.moments];
      const bounds = mode === 'more' ? [...pageBounds.current,page] : mode === 'previous' ? [page,...pageBounds.current] : [page];
      const slid = mode === 'previous' ? {pages:next.slice(0,maxRetainedPages),dropped:Math.max(0,next.length-maxRetainedPages)} : slideWindow(next,maxRetainedPages);
      pageBounds.current=retainDirectional(bounds,maxRetainedPages,mode==='previous'?'previous':'next');
      setHasPrevious(!!pageBounds.current[0]?.previousCursor);
      setLandedScope(scope);
      setLandedGeneration(generation);
      setDenied(false);
      failedOperation.current = null;
      setPages(slid.pages);
      setDropped(dropped => dropped + slid.dropped);
      cursorRef.current = pageBounds.current.at(-1)?.nextCursor ?? null;
      setCursor(cursorRef.current);
      if (mode === 'initial') {
        firstCursorRef.current = null;
        setTotal(typeof page.total === 'number' ? page.total : null);
      } else if (typeof page.total === 'number') {
        setTotal(page.total);
      }
    } catch (failure) {
      if (id !== requestId.current || currentScope.current.scope !== scope || !currentScope.current.enabled || currentScope.current.paused) return;
      if ((failure as { name?: string })?.name === 'AbortError') return;
      if (isFeedAccessFailure(failure)) {
        // Denial invalidates the captured documents AND cursor operation.
        // Reauthorize the whole window instead of merging historical pages.
        failedOperation.current=()=>{void run('initial',[],null);};
        anchor.current=null;setNavigationTarget(null);firstCursorRef.current=undefined;setDropped(0);
        setPages([]); pageBounds.current=[]; setDenied(true); setLandedScope(null); setTotal(null); setCursor(null); cursorRef.current=null; setHasPrevious(false);
      }
      setError(failure instanceof Error ? failure.message : 'Could not load memories. Please retry.');
    } finally {
      if (id === requestId.current && currentScope.current.scope === scope && currentScope.current.enabled && !currentScope.current.paused) { busy.current = false; setLoading(false); setAppendLoading(false); }
    }
  }, [fetchPage, query, scope, enabled, paused, generation, maxRetainedPages]);

  // Reset whenever the account or the filter scope changes.
  useEffect(() => {
    requestId.current += 1;
    if (landedScope !== scope) cursorRef.current = null;
    firstCursorRef.current = undefined;
    if (!enabled || landedGeneration !== generation) {
      setPages([]); setLandedScope(null); setDenied(false); setLandedGeneration(generation);
    }
    if (landedScope !== scope || !enabled || landedGeneration !== generation) {
      pageBounds.current=[];setHasPrevious(false);setCursor(null);
    }
    anchor.current=null;setNavigationTarget(null);setSeeking(false);
    setDropped(0);
    setError(null);
    failedOperation.current=null;setRetryLanding(null);
    setLoading(false);setAppendLoading(false);
    if (enabled && !paused) void run('initial', []);
    return () => { activeController.current?.abort(); requestId.current += 1; busy.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, enabled, paused, generation, reloadToken]);

  const loadMore = useCallback(() => {
    if (busy.current || paused || landedScope !== scope || !cursor) return;
    void run('more', pages);
  }, [loading, cursor, pages, run, paused, landedScope, scope]);

  /** Slide the retained window back toward older content and fetch past it. */
  const older = useCallback(() => {
    if (busy.current || paused || landedScope !== scope || !cursor) return;
    void run('more', pages);
  }, [loading, cursor, pages, run, paused, landedScope, scope]);

  /** Move the window back toward newer content; a fresh first page. */
  const newer = useCallback(() => {
    if (busy.current || paused || landedScope !== scope) return;
    setDropped(0);anchor.current=null;setNavigationTarget(null);
    void run('initial', []);
  }, [loading, run, paused, landedScope, scope]);

  const loadPrevious=useCallback(()=>{if(!busy.current && !paused && landedScope===scope && hasPrevious)void run('previous',pages);},[hasPrevious,pages,run,paused,landedScope,scope]);
  const seek=useCallback(async(target:{ownerId:string;id:string}|{month:string}, external?:AbortSignal,refreshing=false,retrying=false)=>{
    if(!enabled || paused || (!refreshing && landedScope!==scope) || !fetchSeek || busy.current)return null;
    setRetryLanding(null);
    const id=++requestId.current;activeController.current?.abort();const controller=new AbortController();activeController.current=controller;
    const abort=()=>controller.abort();external?.addEventListener('abort',abort,{once:true});if(external?.aborted)controller.abort();
    busy.current=true;setSeeking(true);setError(null);failedOperation.current=()=>{void seek(target,undefined,true,true);};
    try{const page=await fetchSeek(query,target,controller.signal);
      if(controller.signal.aborted||id!==requestId.current||scope!==currentScope.current.scope||!currentScope.current.enabled||currentScope.current.paused)return null;
      failedOperation.current=null;if(retrying)setRetryLanding({page,requestId:id});setDenied(false);setLandedGeneration(generation);pageBounds.current=[page];setPages([page.moments]);setLandedScope(scope);cursorRef.current=page.nextCursor;setCursor(page.nextCursor);setHasPrevious(!!page.previousCursor);setTotal(page.total??null);setDropped(0);anchor.current=page.target??target;setNavigationTarget('month'in target?target:{month:page.moments[0]?.date?.slice(0,7)||'undated'});return page;
    }catch(e){if(!controller.signal.aborted&&id===requestId.current&&scope===currentScope.current.scope&&currentScope.current.enabled&&!currentScope.current.paused){setError(e instanceof Error?e.message:'Memory unavailable. Reset to start.');if(isFeedAccessFailure(e)){failedOperation.current=()=>{void run('initial',[],null);};anchor.current=null;setNavigationTarget(null);firstCursorRef.current=undefined;setDropped(0);setDenied(true);setLandedScope(null);setTotal(null);setPages([]);pageBounds.current=[];setHasPrevious(false);setCursor(null);cursorRef.current=null;}}return null;}
    finally{external?.removeEventListener('abort',abort);if(id===requestId.current&&scope===currentScope.current.scope&&currentScope.current.enabled&&!currentScope.current.paused){busy.current=false;setSeeking(false);}}
  },[fetchSeek,query,scope,enabled,paused,landedScope,generation,run]);
  const refresh = useCallback(() => {
    setDropped(0);
    if(anchor.current && fetchSeek){void seek(anchor.current,undefined,true);return;}
    setReloadToken(token => token + 1);
  }, [seek,fetchSeek]);

  return {
    snapshot: enabled && !denied && landedGeneration === generation && landedScope !== null && (paused || landedScope !== scope),
    settled: enabled && !denied && landedGeneration === generation && landedScope === scope,
    retry: () => { if(currentScope.current.enabled&&!currentScope.current.paused&&currentScope.current.scope===scope&&!busy.current)failedOperation.current?.(); },
    retryLanding: enabled&&!paused&&!denied&&landedScope===scope&&retryLanding?.requestId===requestId.current?retryLanding:null,
    items: enabled && !denied && landedGeneration === generation ? dedupeByIdentity(pages) : [],
    total: enabled && !paused && !denied && landedGeneration === generation && landedScope === scope ? total : null,
    hasMore: enabled && !paused && !denied && landedGeneration === generation && landedScope === scope && cursor !== null,
    loading,
    appendLoading: enabled && landedScope === scope && appendLoading,
    error,
    windowShifted: dropped > 0,
    loadedPages: pages.length,
    loadMore,
    loadPrevious,hasPrevious: enabled && !paused && !denied && landedScope===scope && hasPrevious,seeking,seek,navigationTarget,
    older,
    newer,
    refresh,
  };
}
