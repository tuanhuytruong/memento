import { Bell, ChevronRight, X } from 'lucide-react';
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
  inSheet?: boolean;
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
export function MemoryResurfacing({ tracks, visits, sessionGeneration, revision, onOpen, inSheet = false }: Props) {
  const [today, setToday] = useState(() => localDayKey(new Date()));
  const [candidates, setCandidates] = useState<readonly TimelineEvent[]>([]);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState('');
  const [loaded, setLoaded] = useState(false);

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
    setLoaded(false);
    dataApi.resurfacingCandidates(today)
      .then(result => {
        if (cancelled || generation !== sessionGeneration) return;
        setLoaded(true);
        setCandidates(Array.isArray(result.moments) ? result.moments : []);
      })
      .catch(() => {
        // Rediscovery is optional: an empty section is correct, an error
        // banner over a working timeline would not be.
        if (!cancelled && generation === sessionGeneration) { setCandidates([]); setLoaded(true); }
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

  if (!cards.length) return inSheet ? <p role="status">{loaded ? 'No memories to revisit today.' : 'Looking for memories…'}</p> : null;
  const card = cards[index % cards.length];
  if (!inSheet && dismissed === today) return null;
  return <section aria-label="Resurfaced memory" id={inSheet ? undefined : 'memory-resurfacing'} className="archival-resurfacing">
    {card.event.images[0] && <button className="archival-resurfacing-photo" aria-label={`Revisit ${card.event.title}`} onClick={() => onOpen(card.event)}><PrivateImage src={card.event.images[0]} variant="thumb" alt="" /></button>}
    <div className="archival-resurfacing-copy"><div><span className="archival-wax">{card.reason === 'anniversary' ? <><Bell size={12} />{reasonLabel(card.reason, card.event, today)}</> : 'From your archive'}</span><span>·</span><time>{formatDateDisplay(card.event.date)}</time></div><h2><button onClick={() => onOpen(card.event)}>{card.event.title}</button></h2>{card.event.idea && <p className="line-clamp-1 italic">“{card.event.idea}”</p>}</div>
    <div className="archival-resurfacing-actions"><button className="archival-control" onClick={() => onOpen(card.event)}>Revisit <ChevronRight size={14} /></button>{cards.length > 1 && <button data-keep-sheet onClick={() => setIndex(i => i + 1)}>Another</button>}{!inSheet && <button aria-label="Dismiss resurfaced memory" onClick={() => setDismissed(today)}><X size={16} /></button>}</div>
  </section>;
}
