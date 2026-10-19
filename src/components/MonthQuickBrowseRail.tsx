import React, { useEffect, useRef, useState } from 'react';
import { dataApi } from '../lib/api';
import { monthKeyForDate } from '../lib/monthBrowse';
import { EDGE_IDLE_WIDTH, EDGE_RAIL_HEIGHT, placeRail, previewWidthFor, railStep } from '../lib/monthEdgeFilmstrip';
import { useMonthRailPreview } from '../lib/useMonthRailPreview';
import type { MomentFeedQuery } from '../lib/useMomentFeed';
import { MonthEdgeFilmstrip } from './MonthEdgeFilmstrip';

/** Exterior rail controller. It measures the real content gutter before mounting and never
 * requests month metadata until a genuine hover/focus/wheel interaction begins. */
export const MonthQuickBrowseRail: React.FC<{
  onNavigate: (item: import('../lib/api').BrowsePreview) => void;
  disabled?: boolean;
  hidden: boolean;
  empty: boolean;
  query: MomentFeedQuery;
  generation: number;
}> = ({ onNavigate, disabled, hidden, empty, query, generation }) => {
  // Suppress the rail until a rendered feed card resolves its visible month.
  // This prevents an initial-frame 'Undated' flash while the first page loads.
  const [month, setMonth] = useState<string | null>(null);
  const [finePointer, setFinePointer] = useState(false);
  const [safe, setSafe] = useState(false);
  const [top, setTop] = useState(0);
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [interacted, setInteracted] = useState(false);
  const [active, setActive] = useState(0);
  // Metadata is deliberately separate from preview media: it lets the idle rail reflect
  // the visible month's real bounded tick count immediately after scroll, without
  // fetching any memory previews or images until the user interacts.
  const [monthCounts, setMonthCounts] = useState<Map<string, number> | null>(null);
  const railActive = !hidden && !empty && finePointer && safe && interacted && month !== null;
  const preview = useMonthRailPreview({
    active: railActive,
    // Warm one bounded JSON preview page for the visible month. Photo bytes stay lazy
    // because the preview frame and its PrivateImage mount only after real interaction.
    warm: !hidden && !empty && finePointer && safe && month !== null,
    month: month ?? 'undated', query, generation,
  });
  const activeRef = useRef(0);
  activeRef.current = active;

  const updateVisibleMonth = () => {
    const card = [...document.querySelectorAll<HTMLElement>('[id^="event-card-"]')].find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.bottom > 120 && rect.top < innerHeight * 0.7;
    });
    if (!card) return;
    const date = card.querySelector('time')?.getAttribute('datetime') || card.getAttribute('data-memory-date') || '';
    const next = monthKeyForDate(date);
    setMonth((current) => current === next ? current : next);
  };

  useEffect(() => {
    if (hidden || empty) return;
    const controller = new AbortController();
    setMonthCounts(null);
    dataApi.browseMonths({ ...query, limit: 120 }, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      const next = new Map(result.months.map((entry) => [entry.key, entry.count]));
      if (result.undatedCount) next.set('undated', result.undatedCount);
      setMonthCounts(next);
    }).catch(() => { if (!controller.signal.aborted) setMonthCounts(new Map()); });
    return () => controller.abort();
  }, [empty, hidden, generation, query.search, query.selectedYear, query.dateFrom, query.dateTo, query.trackKey, query.sortDirection, query.hasImagesOnly, query.milestonesOnly, query.savedOnly]);

  useEffect(() => {
    if (hidden || empty) return;
    // Chromium's headless matcher can report `hover: none` despite exposing a mouse;
    // coarse-pointer remains the authoritative mobile exclusion, while desktop keeps
    // keyboard access to the same semantic controls.
    const pointer = matchMedia('(min-width: 1024px) and (not (pointer: coarse))');
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const eligible = pointer.matches;
        setFinePointer(eligible);
        if (!eligible || document.querySelector('[role="dialog"],#memory-actions,[data-floating-actions][data-open="true"]')) {
          setSafe(false); setExpanded(false); return;
        }
        const main = document.querySelector<HTMLElement>('main[aria-busy]');
        // The usable gutter is the actual rendered timeline edge, not the main
        // container box (which has desktop right padding reserved for the rail).
        const cards = Array.from(document.querySelectorAll<HTMLElement>('[id^="event-card-"]'));
        const right = cards.length
          ? Math.max(...cards.map((card) => card.getBoundingClientRect().right))
          : (main?.getBoundingClientRect().right ?? innerWidth);
        const gutter = Math.max(0, innerWidth - right);
        // Preserve the timeline width: the edge preview may layer above the trailing
        // whitespace/card edge rather than permanently reserving a 16rem feed gutter.
        const width = previewWidthFor(Math.max(gutter, EDGE_IDLE_WIDTH + 8 + 128));
        const position = placeRail({ viewportHeight: innerHeight, railHeight: EDGE_RAIL_HEIGHT });
        const usable = width !== null && position !== null;
        setPreviewWidth(width);
        setTop(position ?? 0);
        setSafe(usable);
        if (!usable) setExpanded(false);
        updateVisibleMonth();
      });
    };
    const observer = new ResizeObserver(update);
    if (document.body) observer.observe(document.body);
    // Feed pages replace their card subtree without necessarily changing the body box.
    // Observe only that subtree and coalesce via the existing animation-frame update.
    const feed = document.querySelector('main[aria-busy]');
    const mutations = new MutationObserver(update);
    if (feed) mutations.observe(feed, { childList: true, subtree: true });
    pointer.addEventListener('change', update);
    addEventListener('resize', update);
    addEventListener('scroll', update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      mutations.disconnect();
      cancelAnimationFrame(frame);
      pointer.removeEventListener('change', update);
      removeEventListener('resize', update);
      removeEventListener('scroll', update);
    };
  }, [empty, hidden]);

  // A new visible month is a different rail scope. Discard ephemeral selection and require
  // another deliberate interaction; the hook aborts/fences any prior request.
  useEffect(() => {
    setInteracted(false);
    setExpanded(false);
    setActive(0);
  }, [month, generation, query.search, query.selectedYear, query.dateFrom, query.dateTo, query.trackKey, query.sortDirection, query.hasImagesOnly, query.milestonesOnly, query.savedOnly]);

  useEffect(() => {
    setActive((value) => Math.max(0, Math.min(preview.items.length - 1, value)));
  }, [preview.items.length, preview.page]);

  const useRail = () => {
    if (!safe || hidden || empty) return;
    setInteracted(true);
    setExpanded(true);
  };
  const step = (delta: -1 | 1) => {
    useRail();
    const result = railStep(activeRef.current, preview.items.length, delta, preview.hasNext, preview.hasPrevious);
    setActive(result.index);
    if (result.page === 'next') preview.nextPage();
    if (result.page === 'previous') preview.previousPage();
  };

  if (hidden || empty || !finePointer || !safe || month === null) return null;
  return <MonthEdgeFilmstrip
    items={preview.items}
    active={active}
    total={preview.total}
    tickCount={monthCounts?.get(month) ?? null}
    month={month}
    previewWidth={previewWidth}
    disabled={disabled || (preview.loading && !preview.items.length)}
    loading={preview.loading}
    error={preview.error}
    top={top}
    onNavigateItem={onNavigate}
    onHoverItem={(index) => { useRail(); setActive(index); }}
    onStep={step}
    onRetry={preview.retry}
    hasNext={preview.hasNext}
    hasPrevious={preview.hasPrevious}
    onExpandChange={(next) => { if (next) useRail(); else setExpanded(false); }}
    expanded={expanded}
  />;
};
