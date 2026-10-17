import { type EmotionKey, type EventTrack, type TimelineEvent } from '../types';
import { foldSearchText } from './momentFilters';

export type BlindboxIntent = 'surprise' | 'comfort' | 'courage' | 'spark' | 'reflection' | 'celebration';

const INTENT_EMOTIONS: Record<Exclude<BlindboxIntent, 'surprise'>, EmotionKey[]> = {
  comfort: ['serene', 'grateful', 'nostalgic'],
  courage: ['challenged', 'proud', 'focused'],
  spark: ['inspired', 'excited'],
  reflection: ['reflective', 'nostalgic', 'grateful'],
  celebration: ['joyful', 'proud', 'excited'],
};

export type BlindboxResult = { event: TimelineEvent; fallback: boolean };

// Folding is shared with the main search, so a query typed as "da lat" finds
// "Đà Lạt" in a Blindbox too instead of quietly behaving differently.
function words(value: string) {
  return foldSearchText(value).split(/\s+/).filter((word) => word.length >= 2).slice(0, 12);
}

function corpus(event: TimelineEvent, track?: EventTrack) {
  return foldSearchText([event.title, event.description, event.idea, event.tags?.join(' '), event.location?.name, event.location?.city, track?.title].filter(Boolean).join(' '));
}

export function revealMemory(events: TimelineEvent[], tracks: EventTrack[], intent: BlindboxIntent, query: string, random = Math.random): BlindboxResult | null {
  if (!events.length) return null;
  const byId = new Map(tracks.map((track) => [track.id, track]));
  const queryWords = words(query);
  const emotions = intent === 'surprise' ? [] : INTENT_EMOTIONS[intent];
  const scored = events.map((event) => {
    let score = 0;
    if (emotions.includes(event.emotion as EmotionKey)) score += 3;
    const text = corpus(event, byId.get(event.eventId));
    score += queryWords.filter((word) => text.includes(word)).length * 2;
    return { event, score };
  });
  const best = Math.max(...scored.map((item) => item.score));
  const candidates = best > 0 ? scored.filter((item) => item.score === best).map((item) => item.event) : events;
  return { event: candidates[Math.floor(random() * candidates.length)], fallback: best === 0 && (intent !== 'surprise' || queryWords.length > 0) };
}

export function reflectionPrompt(event: TimelineEvent) {
  if (event.idea?.trim()) return event.idea.trim();
  if (event.description?.trim()) return event.description.trim().slice(0, 240);
  return 'What does this moment bring back for you?';
}
