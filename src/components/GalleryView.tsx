import type { TimelineEvent, EventTrack } from '../types';
import { getEmotionMeta } from '../data/emotions';
import { formatDateDisplay } from '../lib/storage';
import { trackIdentity, momentIdentity } from '../lib/resourceIdentity';
import { PrivateImage } from './PrivateImage';
import { useLocalPhotos } from '../lib/localPhoto';

function GalleryTile({event, track, hero, onOpen}: {event: TimelineEvent; track?: EventTrack; hero: boolean; onOpen: () => void}) {
  const [pending] = useLocalPhotos(event.id, event.resourceOwnerId);
  const preview = event.images[0];
  const mood = getEmotionMeta(event.emotion);
  return <article className="archival-gallery-card" id={`event-card-${momentIdentity(event)}`} data-hero={hero && !!(preview || pending)}>
    <button className="archival-gallery-tile" onClick={onOpen}>
      {preview || pending ? <>
        {preview ? <PrivateImage src={preview} variant={hero ? 'display' : 'thumb'} loading="lazy" alt="" className="archival-gallery-image" /> : <img className="archival-gallery-image object-cover" src={pending.url} alt="" />}
        <div className="archival-gallery-caption"><p>{formatDateDisplay(event.date)}{event.location?.city && ` · ${event.location.city}`}{event.isMilestone && ' · Milestone'}</p><h3>{event.title}</h3>{!preview && pending && <span>{pending.status}</span>}</div>
      </> : <div className="archival-gallery-note"><p>{formatDateDisplay(event.date)}{mood && <span>{mood.emoji} {mood.label}</span>}</p><div><h3>{event.title}</h3><p className="line-clamp-4">{event.description}</p></div><small>{track?.title ?? 'Written note'} · Read entry</small></div>}
    </button>
  </article>;
}

export function GalleryView({events, tracks, onViewDetails}: {events: TimelineEvent[]; tracks: EventTrack[]; onViewDetails: (event: TimelineEvent) => void}) {
  const trackMap = new Map(tracks.map(track => [trackIdentity(track), track]));
  return <section id="gallery-view-grid" className="archival-gallery" aria-label="Memory gallery">
    {events.map((event, index) => <GalleryTile key={momentIdentity(event)} event={event} track={trackMap.get(`${event.resourceOwnerId}:${event.eventId}`)} hero={index === 0 && events.length >= 3} onOpen={() => onViewDetails(event)} />)}
  </section>;
}
