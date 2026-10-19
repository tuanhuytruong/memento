import { useCallback, useEffect, useRef, useState } from 'react';
import { dataApi, type BrowsePage } from './api';
import { feedScopeHash, type MomentFeedQuery } from './useMomentFeed';
import type { RailDirection } from './monthEdgeFilmstrip';

/** Rail-specific preview lifecycle. Kept separate from `useMonthBrowse` so the detailed
 * browser's stable contract is untouched: no metadata request, no dialog state, no year.
 *
 * Contract:
 * - nothing is fetched until the caller reports a real interaction (`active`);
 * - pages stay bounded (24 items, at most three cached pages) and only advance on gesture;
 * - every response is fenced by auth generation, query scope, month and request sequence;
 * - a failure keeps the last valid page and records the exact cursor operation for Retry.
 */
export function useMonthRailPreview({ active, month, query, generation }: {
  active: boolean;
  month: string;
  query: MomentFeedQuery;
  generation: number;
}) {
  const scope = feedScopeHash(query, generation);
  const [page, setPage] = useState<BrowsePage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  const cache = useRef(new Map<string, BrowsePage>());
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const key = `${scope}|${month}`;
  const currentKey = useRef(key);
  currentKey.current = key;
  // Retry must replay the failed cursor operation, never the month's first page.
  const failed = useRef<{ cursor: string | null; navigation: RailDirection } | null>(null);

  const reset = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    sequence.current += 1;
    cache.current.clear();
    failed.current = null;
    setPage(null);
    setError('');
    setLoading(false);
  }, []);

  // Account, filter scope or displayed-month change: drop everything, including late results.
  useEffect(() => {
    reset();
  }, [reset, key, revision]);

  const load = useCallback(async (cursor: string | null, navigation: RailDirection) => {
    const requestKey = currentKey.current;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    const id = ++sequence.current;
    const cacheKey = `${requestKey}|${navigation}|${cursor ?? ''}`;
    const alive = () => currentKey.current === requestKey && !next.signal.aborted && id === sequence.current;

    setLoading(true);
    setError('');
    try {
      let result = cache.current.get(cacheKey);
      if (result) {
        cache.current.delete(cacheKey);
        cache.current.set(cacheKey, result);
      } else {
        result = await dataApi.browsePreview({ ...query, month, limit: 24, cursor, navigation }, next.signal);
        if (!alive()) return;
        cache.current.set(cacheKey, result);
        while (cache.current.size > 3) cache.current.delete(cache.current.keys().next().value!);
      }
      if (!alive()) return;
      failed.current = null;
      setPage(result);
    } catch (cause) {
      if (!alive()) return;
      failed.current = { cursor, navigation };
      setError(cause instanceof Error ? cause.message : 'Previews unavailable');
    } finally {
      if (alive()) setLoading(false);
    }
  }, [month, query]);

  const started = useRef('');
  useEffect(() => {
    if (!active) return;
    if (started.current === key) return;
    started.current = key;
    void load(null, 'next');
  }, [active, key, load]);

  // Leaving the rail aborts in-flight work; the bounded cache survives for the same month.
  useEffect(() => {
    if (active) return;
    started.current = '';
    controller.current?.abort();
    sequence.current += 1;
    setLoading(false);
  }, [active]);

  useEffect(() => () => {
    controller.current?.abort();
    sequence.current += 1;
  }, []);

  const nextPage = useCallback(() => {
    if (!page?.nextCursor) return;
    void load(page.nextCursor, 'next');
  }, [load, page]);

  const previousPage = useCallback(() => {
    if (!page?.previousCursor) return;
    void load(page.previousCursor, 'previous');
  }, [load, page]);

  const retry = useCallback(() => {
    const attempt = failed.current;
    if (attempt) {
      void load(attempt.cursor, attempt.navigation);
      return;
    }
    setRevision((value) => value + 1);
  }, [load]);

  return {
    items: page?.items ?? [],
    total: page?.total ?? 0,
    page: page?.month ?? month,
    loading,
    error,
    retry,
    nextPage,
    previousPage,
    hasNext: Boolean(page?.nextCursor),
    hasPrevious: Boolean(page?.previousCursor),
  };
}
