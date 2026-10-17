import React, { useEffect, useMemo, useState } from 'react';
import type { EventTrack, TimelineEvent } from '../types';
import { momentIdentity, trackIdentity } from '../lib/resourceIdentity';
import { selectResurfacedMemories, type MemoryVisit, type ResurfacingReason } from '../lib/memoryResurfacing';
import { PrivateImage } from './PrivateImage';
import { formatDateDisplay } from '../lib/storage';
import { dataApi } from '../lib/api';

interface Props {
  tracks: readonly EventTrack[];
  visits: readonly MemoryVisit[];
  /**
   * Session generation, so a response that arrives after an account switch is
   * discarded instead of surfacing the previous account's memories.
   */
  sessionGeneration: number;
  revision?: number;
  /** Opens the existing moment detail flow with the exact owner+moment identity. */
  onOpen: (event: TimelineEvent) => void;
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function reasonLabel(reason: ResurfacingReason, event: TimelineEvent, today: string): string {
  if (reason === 'anniversary') {
    const years = Number(today.slice(0, 4)) - Number(event.date.slice(0, 4));
    return `On this day · ${years} year${years === 1 ? '' : 's'} ago`;
  }
  if (reason === 'month-last-year') return 'This month last year';
  if (reason === 'track-not-revisited') return "A chapter you haven't revisited";
  if (reason === 'track-to-revisit') return 'A chapter to revisit';
  return 'Where this chapter began';
}

/**
 * Compact, deterministic rediscovery section.
 *
 * Selection is still the same pure function, run over a candidate pool the
 * server assembles to be exactly sufficient for it — bounded by track count
 * and calendar pattern rather than by account size. That matters because the
 * timeline is paginated now: choosing from "what happens to be loaded" would
 * silently stop finding anniversaries from years back.
 *
 * A failure here simply hides the section. Rediscovery is a pleasure, not a
 * requirement, and it must never take the timeline down with it.
 */
export function MemoryResurfacing({ tracks, visits, sessionGeneration, revision, onOpen }: Props) {
  const [today, setToday] = useState(() => localDayKey(new Date()));
  const [candidates, setCandidates] = useState<readonly TimelineEvent[]>([]);
  const [expanded, setExpanded] = useState(false);

  // Recompute the local calendar day after midnight, a timezone change or tab focus.
  useEffect(() => {
    let timer: number;
    const refresh = () => {
      window.clearTimeout(timer);
      setToday(previous => {
        const next = localDayKey(new Date());
        return previous === next ? previous : next;
      });
      const now = new Date();
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2).getTime() - now.getTime();
      timer = window.setTimeout(refresh, Math.max(1000, nextMidnight));
    };
    refresh();
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
    };
  }, []);

  // Fetch the bounded candidate pool whenever the local day changes or the
  // account does. The generation fence matters: without it a slow response
  // from the previous session could surface that account's memories here.
  useEffect(() => {
    const generation = sessionGeneration;
    let cancelled = false;
    setCandidates([]);
    dataApi.resurfacingCandidates(today)
      .then(result => {
        if (cancelled || generation !== sessionGeneration) return;
        setCandidates(Array.isArray(result.moments) ? result.moments : []);
      })
      .catch(() => {
        // Rediscovery is optional: an empty section is correct, an error
        // banner over a working timeline would not be.
        if (!cancelled && generation === sessionGeneration) setCandidates([]);
      });
    return () => { cancelled = true; };
  }, [today, sessionGeneration, revision]);

  const cards = useMemo(() => {
    const selection = selectResurfacedMemories({ events: candidates, tracks, visits, today, limit: 3 });
    return selection.flatMap(selection1 => {
      const event = candidates.find(item => momentIdentity(item) === selection1.momentIdentity);
      const track = tracks.find(item => trackIdentity(item) === selection1.trackIdentity);
      if (!event || !track) return [];
      return [{ key: selection1.momentIdentity, event, track, reason: selection1.reason }];
    });
  }, [candidates, tracks, visits, today]);

  // No result is preferable to a misleading fallback; ordinary navigation and
  // Blindbox remain available below/alongside this section.
  if (!cards.length) return null;

  return (
    <section aria-labelledby="memory-resurfacing-title" id="memory-resurfacing" className="mb-6">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h2 id="memory-resurfacing-title" className="text-sm font-semibold text-stone-800 dark:text-stone-100">Ngày ấy · Remember when</h2>
          <p className="text-xs text-stone-500">Memories worth returning to, chosen from your own timeline.</p>
        </div>
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {cards.map((card, index) => (
          <li key={card.key} className={index > 0 && !expanded ? 'hidden sm:block' : ''}>
            <button
              type="button"
              onClick={() => onOpen(card.event)}
              className="flex min-h-11 w-full min-w-0 flex-col gap-2 rounded-xl border border-stone-200 bg-white p-3 text-left transition hover:border-amber-300 hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-amber-800 dark:hover:bg-stone-800/60"
            >
              <span className="w-full min-w-0 truncate text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                {reasonLabel(card.reason, card.event, today)}
              </span>
              {card.event.images[0] && (
                <PrivateImage src={card.event.images[0]} variant="thumb" alt="" loading="lazy" className="h-24 w-full shrink-0 overflow-hidden rounded-lg" />
              )}
              <span className="w-full min-w-0 truncate text-sm font-semibold text-stone-800 dark:text-stone-100">{card.event.title}</span>
              <span className="w-full min-w-0 truncate text-xs text-stone-500">
                {formatDateDisplay(card.event.date)} · {card.track.title}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {cards.length > 1 && (
        <button
          type="button"
          onClick={() => setExpanded(value => !value)}
          className="mt-2 min-h-11 w-full rounded-lg border border-stone-200 px-3 text-sm font-medium text-stone-600 hover:bg-stone-50 dark:border-stone-800 dark:text-stone-300 dark:hover:bg-stone-800 sm:hidden"
        >
          {expanded ? 'Show less' : `See more (${cards.length - 1} more)`}
        </button>
      )}
    </section>
  );
}
