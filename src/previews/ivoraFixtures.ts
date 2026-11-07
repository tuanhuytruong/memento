import type { EmotionKey, TimelineEvent, EventTrack } from '../types';

export const previewTracks: EventTrack[] = [
  { id: 'weekends', resourceOwnerId: 'preview', title: 'Weekends', description: 'Small days, kept close.', color: 'amber', icon: 'Sun', tags: ['home'], createdAt: '2026-01-01', updatedAt: '2026-01-01', accessRole: 'viewer' },
  { id: 'together', resourceOwnerId: 'preview', title: 'Together', description: 'People and shared tables.', color: 'rose', icon: 'Heart', tags: ['friends'], createdAt: '2026-01-01', updatedAt: '2026-01-01', accessRole: 'viewer' },
];

function memory(id: string, eventId: string, title: string, date: string, description: string, emotion: EmotionKey, tags: string[], place?: string): TimelineEvent {
  return { id, resourceOwnerId: 'preview', eventId, title, date, description, emotion, tags, images: [], createdAt: date, updatedAt: date, version: 1, location: place ? { name: place } : undefined,
    reactions: ['❤️', '🥹', '😂', '✨', '🙌', '🎉'].map((emoji, index) => ({ emoji: emoji as '❤️'|'🥹'|'😂'|'✨'|'🙌'|'🎉', count: index === 0 ? 2 : 0, usernames: index === 0 ? ['minh', 'an'] : [], selected: false })) };
}

export const previewMemories = [
  memory('morning-market', 'weekends', 'A slow morning at the market', '2026-06-14', 'We bought too many flowers, then walked home by the long way. Nothing urgent waited for us.', 'joyful', ['weekend', 'flowers'], 'Bến Thành'),
  memory('second-coffee', 'weekends', 'The second pot of coffee', '2026-06-08', 'Rain held the afternoon still. A book stayed open on the table and that was enough.', 'serene', ['home', 'quiet'], 'At home'),
  memory('strawberries', 'together', 'Room for one more', '2026-05-25', 'A small table, too many strawberries, and all our favourite people arriving one by one.', 'grateful', ['friends', 'garden'], 'The garden table'),
  memory('night-walk', 'together', 'Walking until the city softened', '2026-05-19', 'The streets were warm after the rain. We did not decide where to go, so the evening chose for us.', 'reflective', ['city', 'walk'], 'District 1'),
] as const;
