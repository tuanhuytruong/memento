import React, { useEffect, useRef } from 'react';
import type { BrowsePreview } from '../lib/api';
import {
  EDGE_HIT_SIZE, EDGE_IDLE_WIDTH, EDGE_SLOT_REGION,
  accumulateRailWheel, arcShape, arcX, arcPath, hitSlots, initialRailWheel,
  railMonthLabel, railTickLabel, slotOffset, tickLine, windowIndexes,
} from '../lib/monthEdgeFilmstrip';
import { PrivateImage } from './PrivateImage';

export interface MonthEdgeFilmstripProps {
  items: BrowsePreview[];
  /** Page-local index of the facing frame. */
  active: number;
  total: number;
  /** Authoritative month total for idle tick geometry; null while metadata is pending. */
  tickCount: number | null;
  month: string;
  previewWidth: number | null;
  disabled?: boolean;
  loading?: boolean;
  error?: string;
  /** Vertical position of the rail box, already collision-checked by the caller. */
  top: number;
  onNavigateItem: (item: BrowsePreview) => void;
  onHoverItem: (index: number) => void;
  onStep: (delta: -1 | 1) => void;
  onRetry: () => void;
  hasNext: boolean;
  hasPrevious: boolean;
  onExpandChange: (expanded: boolean) => void;
  expanded: boolean;
}

/** Thin off-canvas crescent with scrollable rays and exactly one facing frame.
 * Decorative SVG is hidden from assistive tech; every visible target is a real button.
 */
export const MonthEdgeFilmstrip: React.FC<MonthEdgeFilmstripProps> = ({
  items, active, total, tickCount, month, previewWidth, disabled, loading, error,
  top, onNavigateItem, onHoverItem, onStep, onRetry,
  hasNext, hasPrevious, onExpandChange, expanded,
}) => {
  const region = EDGE_SLOT_REGION;
  const shape = arcShape(region, EDGE_IDLE_WIDTH);
  const idleSlotCount = tickCount === null ? 0 : Math.min(tickCount, 5);
  const slots = hitSlots(items.length ? Math.min(items.length, 5) : idleSlotCount, region);
  const window = windowIndexes(items.length, active, slots.length);
  const activeItem = items[active];
  const monthLabel = railMonthLabel(month);
  const wheel = useRef(initialRailWheel());
  const aside = useRef<HTMLElement | null>(null);
  const grace = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  // The wheel is scoped to the rail region only, and vertical input is consumed solely
  // when the rail can actually handle a step. Otherwise the document keeps scrolling.
  useEffect(() => {
    const node = aside.current;
    if (!node) return;
    const handler = (event: WheelEvent) => {
      const result = accumulateRailWheel(wheel.current, {
        deltaY: event.deltaY, deltaX: event.deltaX, deltaMode: event.deltaMode,
        ctrlKey: event.ctrlKey, timeStamp: event.timeStamp,
      });
      wheel.current = result.state;
      if (!result.handled) return;
      const direction = result.step as -1 | 0 | 1;
      if (!direction) return;
      const atStart = activeRef.current <= 0 && !hasPrevious;
      const atEnd = activeRef.current >= items.length - 1 && !hasNext;
      if ((direction < 0 && atStart) || (direction > 0 && atEnd)) return;
      event.preventDefault();
      onStep(direction);
    };
    node.addEventListener('wheel', handler, { passive: false });
    return () => node.removeEventListener('wheel', handler);
  }, [hasNext, hasPrevious, items.length, onStep]);

  useEffect(() => () => { if (grace.current) clearTimeout(grace.current); }, []);

  const hold = () => {
    if (grace.current) clearTimeout(grace.current);
    grace.current = null;
    onExpandChange(true);
  };
  // Pointer grace: moving from a tick into the preview must not close it.
  const release = () => {
    if (grace.current) clearTimeout(grace.current);
    grace.current = setTimeout(() => { grace.current = null; onExpandChange(false); }, 260);
  };

  const ordinal = (index: number) => index + 1;

  return <aside
    ref={aside}
    id="month-edge-rail"
    data-testid="month-edge-rail"
    data-month={month}
    aria-label={`Month filmstrip for ${monthLabel}`}
    role="group"
    style={{ top, height: region + EDGE_HIT_SIZE, width: EDGE_IDLE_WIDTH }}
    className="fixed right-0 z-30 hidden select-none lg:block"
    onPointerEnter={hold}
    onPointerLeave={release}
    onFocusCapture={hold}
    onBlurCapture={release}
    onKeyDown={(event) => {
      if (event.key === 'Escape' && expanded) {
        event.stopPropagation();
        onExpandChange(false);
        const node = aside.current?.querySelector<HTMLElement>('[data-rail-slot][aria-current="true"]');
        node?.focus();
      }
    }}
  >
    <svg aria-hidden="true" className="pointer-events-none absolute right-0 text-amber-500/80 dark:text-amber-300/70" width={EDGE_IDLE_WIDTH} height={region} viewBox={`0 0 ${EDGE_IDLE_WIDTH} ${region}`}>
      <path d={arcPath(shape, region)} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {slots.map((slot) => {
        const line = tickLine(slotOffset(slot, region), shape, region, expanded && activeItem && window[slot.index] === active ? 14 : 8);
        return <line key={slot.index} {...line} stroke="currentColor" strokeWidth="1" strokeLinecap="round" />;
      })}
    </svg>

    <div aria-hidden="true" className="absolute bottom-0 right-0 flex h-11 w-14 flex-col items-center justify-center rounded-l-xl border border-r-0 border-stone-200 bg-white/95 text-[10px] font-semibold leading-tight text-stone-600 shadow-sm dark:border-stone-700 dark:bg-stone-900/95 dark:text-stone-300">
      <span className="text-[11px] text-amber-700 dark:text-amber-300">{monthLabel.split(' ')[0]}</span>
      <span>{monthLabel.split(' ')[1] ?? ''}</span>
    </div>

    <div className="absolute right-0" style={{ top: 0, height: region }}>
      {items.length > 0 && slots.map((slot) => {
        const index = window[slot.index];
        if (index === undefined) return null;
        const item = items[index];
        // Cache the selected item for immediate re-entry, but show no bold tick once the rail closes.
        const isActive = expanded && index === active;
        const offset = slotOffset(slot, region);
        return <button
          key={`${item.ownerId}:${item.id}:${index}`}
          type="button"
          data-rail-slot={index}
          aria-current={isActive ? 'true' : undefined}
          aria-label={railTickLabel(item, ordinal(index), total || items.length)}
          disabled={disabled}
          style={{ top: slot.top, height: slot.height, width: EDGE_IDLE_WIDTH, paddingLeft: Math.max(0, arcX(offset, shape) - 2) }}
          onPointerEnter={() => onHoverItem(index)}
          onFocus={() => onHoverItem(index)}
          onClick={() => onHoverItem(index)}
          className="absolute right-0 flex items-center justify-start bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:opacity-40"
        >
          <span className={`block rounded-full transition-[width,background-color] motion-reduce:transition-none ${isActive ? 'h-[3px] bg-amber-600 dark:bg-amber-300' : 'h-[2px] bg-stone-400/80 dark:bg-stone-500/80'}`} style={{ width: isActive ? 18 : 9 }} />
        </button>;
      })}
    </div>

    {/* One focused frame, never a ring of thumbnails. */}
    {expanded && activeItem && <div
      data-testid="edge-film-preview"
      className="absolute rounded-2xl border border-stone-200 bg-white/98 p-2.5 shadow-xl shadow-stone-900/10 backdrop-blur-sm dark:border-stone-700 dark:bg-stone-900/98"
      style={{ right: EDGE_IDLE_WIDTH + 8, width: previewWidth ?? 176, top: Math.max(0, Math.min(region - 168, region / 2 - 84)) }}
    >
      <button type="button" disabled={disabled} onClick={() => onNavigateItem(activeItem)} aria-label={`Go to memory: ${activeItem.title || 'Untitled memory'}`} className="block w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:opacity-40">
        {activeItem.thumbUrl
          ? <PrivateImage src={activeItem.thumbUrl} variant="thumb" alt="" loading="eager" className="mb-2 h-[112px] w-full overflow-hidden rounded-xl" />
          : <div className="mb-2 flex h-[72px] items-center justify-center rounded-xl bg-amber-50 px-2 text-center text-[11px] leading-snug text-amber-800 dark:bg-stone-800 dark:text-amber-200">{activeItem.excerpt || 'A memory in words'}</div>}
        <time className="text-[11px] text-stone-500">{activeItem.date || 'Undated'}</time>
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug break-words">{activeItem.title || 'Untitled memory'}</h3>
        {activeItem.excerpt && <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-stone-500 break-words">{activeItem.excerpt}</p>}
      </button>
      <p role="status" className="mt-1 min-h-4 text-[10px] text-stone-500">{loading ? 'Loading month previews…' : error || `${ordinal(active)} of ${Math.max(total, items.length)} in ${monthLabel}`}</p>
      {error && <button type="button" onClick={onRetry} className="mt-1 min-h-11 w-full rounded-lg border border-stone-200 text-[11px] font-semibold dark:border-stone-700">Retry</button>}
    </div>}

  </aside>;
};
