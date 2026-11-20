import type { TimelineEvent, EventTrack } from '../types';
import { getEmotionMeta } from '../data/emotions';
import { formatDateDisplay } from '../lib/storage';
import { trackIdentity, momentIdentity } from '../lib/resourceIdentity';
import { Bookmark, Star } from 'lucide-react';

export function CompactListView({events,tracks,onViewDetails,savedKeys}: {events: TimelineEvent[]; tracks: EventTrack[]; onViewDetails: (event: TimelineEvent) => void; savedKeys: ReadonlySet<string>}) {
  const trackMap = new Map(tracks.map(track => [trackIdentity(track), track]));
  return <section id="compact-list-table-wrap" className="archival-compact" aria-label="Compact memory index">
    <table className="archival-ledger"><thead><tr><th scope="col">Date</th><th scope="col">Memory</th><th scope="col" className="hidden md:table-cell">Track</th><th scope="col" className="hidden sm:table-cell">Mood</th><th scope="col">Media</th></tr></thead>
    <tbody>{events.map(event => {
      const key = momentIdentity(event);
      const mood = getEmotionMeta(event.emotion);
      return <tr key={key} id={`event-card-${key}`} onClick={() => onViewDetails(event)}>
        <td><time>{formatDateDisplay(event.date)}</time></td>
        <td><button type="button" className="archival-list-title" onClick={click => { click.stopPropagation(); onViewDetails(event); }}>{event.title}{event.isMilestone && <Star className="archival-wax" size={14} fill="currentColor" aria-label="Milestone" />}{savedKeys.has(key) && <Bookmark size={14} fill="currentColor" aria-label="Saved" />}</button>{event.location?.city && <p>{event.location.city}</p>}</td>
        <td className="hidden md:table-cell">{trackMap.get(`${event.resourceOwnerId}:${event.eventId}`)?.title ?? '—'}</td>
        <td className="hidden sm:table-cell">{mood ? `${mood.emoji} ${mood.label}` : '—'}</td>
        <td>{event.images.length ? `${event.images.length} img` : 'Note'}</td>
      </tr>;
    })}</tbody></table>
  </section>;
}
