import { useEffect, useState } from 'react';
import { request } from './api';
import { localCalendarDate } from './localDate';
import type { AccountOverview, EmotionKey } from '../types';

export type InsightMemory = { ownerId: string; id: string; title: string; date: string | null };
type MoodReading = { count: number; average: number; mood: EmotionKey };
type MoodSummary = { logged: number; average: number | null };
export type ArchiveInsights = {
  today: string;
  mood: MoodSummary;
  moods: MoodReading[];
  daily: (MoodReading & { day: string })[];
  health: { total: number; dated: number; withMood: number; withPlace: number; photos: number; milestones: number;
    activeTracks: number; totalTracks: number; tagCount: number; topTag: { label: string; count: number } | null;
    earliest: string | null; latest: string | null };
};
export type AtlasInsights = {
  mood: MoodSummary;
  moods: (MoodReading & { examples: InsightMemory[] })[];
  months: (MoodReading & { month: string })[];
  peak: (InsightMemory & { mood: EmotionKey; intensity: number }) | null;
  seals: Record<'joyPeaks' | 'reflectiveDays' | 'peakEntries' | 'distinctMoods' | 'monthsInYear' | 'gratefulPeaks' | 'longestStreak' | 'spanMonths', number>;
  geography: { places: number; countries: number; moments: number };
  places: { city: string; country: string | null; count: number; earliest: string | null; latest: string | null;
    mood: EmotionKey | null; imageId: string | null; examples: InsightMemory[] }[];
  associations: { kind: 'tag' | 'place'; label: string; sample: number; mood: EmotionKey; count: number; share: number; baseline: number }[];
};

type Insights = { archive: ArchiveInsights; atlas: AtlasInsights };

// Overview is the parent account snapshot, replaced on authoritative data refresh.
// Do not retain old private labels while the new scope/revision is loading.
export function useArchiveInsights<T extends keyof Insights>(view: T, overview: AccountOverview | null) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ overview: AccountOverview | null; attempt: number; data?: Insights[T]; error?: boolean }>();
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      setState({overview, attempt, error:true});
    }, 15_000);
    const query = new URLSearchParams({view});
    if (view === 'archive') query.set('today', localCalendarDate());
    request<{ insights: Insights[T] }>(`/archive-insights?${query}`, { signal: controller.signal, cache: 'no-store' })
      .then(result => {
        if (!result?.insights) throw Error('Missing insights');
        if (!controller.signal.aborted) setState({overview, attempt, data:result.insights});
      }).catch(() => {
        if (!controller.signal.aborted) setState({overview, attempt, error:true});
      }).finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [view, overview, attempt]);
  const current = state?.overview === overview && state.attempt === attempt ? state : undefined;
  return { data: current?.data, error: current?.error, retry: () => setAttempt(value => value + 1) };
}
