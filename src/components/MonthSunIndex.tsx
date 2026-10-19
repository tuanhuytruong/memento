import React from 'react';
import type { BrowsePreview } from '../lib/api';
import { PrivateImage } from './PrivateImage';

export const SUN_RAY_LIMIT = 10;
export interface SunRay { index: number; angle: number; x: number; y: number; item: BrowsePreview }

/** Clockwise, deterministic positions keep DOM/keyboard order independent of spatial order. */
export function sunRays(items: BrowsePreview[], start = 0): SunRay[] {
  const visible = items.slice(start, start + SUN_RAY_LIMIT);
  return visible.map((item, index) => {
    const angle = -90 + (360 * index) / Math.max(visible.length, 1);
    const radians = angle * Math.PI / 180;
    return { index: start + index, angle, x: 50 + Math.cos(radians) * 37, y: 50 + Math.sin(radians) * 37, item };
  });
}
export function sunRayLabel(item: BrowsePreview, ordinal: number, total: number) {
  return `Memory ${ordinal} of ${total}: ${item.date || 'Undated'} · ${item.title || 'Untitled memory'}`;
}

export const MonthSunIndex: React.FC<{
  items: BrowsePreview[]; activeIndex: number; rayStart: number; disabled?: boolean;
  onSelect: (index: number) => void;
}> = ({ items, activeIndex, rayStart, disabled, onSelect }) => {
  const rays = sunRays(items, rayStart);
  const selected = items[activeIndex];
  return <section className="relative mx-auto aspect-square w-full max-w-[470px] min-h-[320px]" aria-label="Month sun index">
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" aria-hidden="true">
      {rays.map(ray => <line key={ray.index} x1="50" y1="50" x2={ray.x} y2={ray.y} stroke="currentColor" strokeWidth="0.7" className="text-amber-400/70 dark:text-amber-300/50" />)}
      <circle cx="50" cy="50" r="20" className="fill-amber-100 stroke-amber-400 dark:fill-amber-950 dark:stroke-amber-600" strokeWidth="0.8" />
    </svg>
    <div className="absolute left-1/2 top-1/2 z-10 flex h-[40%] w-[40%] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full text-center pointer-events-none px-3">
      <strong className="text-sm font-semibold leading-tight">{selected?.date ? new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(`${selected.date.slice(0, 7)}-01T12:00:00`)) : 'Undated'}</strong>
      <span className="mt-1 text-xs text-stone-500">{items.length} memories</span>
    </div>
    <ol className="absolute inset-0 m-0 list-none p-0">
      {rays.map(ray => <li key={`${ray.item.ownerId}:${ray.item.id}:${ray.index}`} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${ray.x}%`, top: `${ray.y}%` }}>
        <button type="button" disabled={disabled} aria-current={activeIndex === ray.index ? 'true' : undefined} aria-label={sunRayLabel(ray.item, ray.index + 1, items.length)} onMouseEnter={() => onSelect(ray.index)} onFocus={() => onSelect(ray.index)} onClick={() => onSelect(ray.index)} className={`flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border-2 bg-stone-100 text-xs font-semibold shadow-sm transition motion-reduce:transition-none dark:bg-stone-800 ${activeIndex === ray.index ? 'border-amber-500 ring-2 ring-amber-300 dark:ring-amber-700' : 'border-stone-300 hover:border-amber-400 dark:border-stone-600'}`}>
          {ray.item.thumbUrl ? <PrivateImage src={ray.item.thumbUrl} variant="thumb" alt="" className="h-full w-full" loading="lazy" /> : <span aria-hidden="true">{ray.index + 1}</span>}
        </button>
      </li>)}
    </ol>
  </section>;
};
