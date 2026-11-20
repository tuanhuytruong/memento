import { ReactionControls, type ReactionControlProps } from './ReactionControls';
import React from 'react';
import {
  MapPin,
  Lightbulb,
  Star,
  Edit2,
  Trash2,
} from 'lucide-react';
import { TimelineEvent, EventTrack } from '../types';
import { getEmotionMeta } from '../data/emotions';
import { getEventIconComponent } from '../data/eventThemes';
import { formatDateDisplay, getRelativeTime } from '../lib/storage';
import { PrivateImage } from './PrivateImage';
import { useLocalPhotos } from '../lib/localPhoto';
import { momentIdentity } from '../lib/resourceIdentity';

interface EventCardProps {
  onToggleReaction: ReactionControlProps['onToggleReaction'];
  currentUsername?: string;
  event: TimelineEvent;
  track?: EventTrack;
  onSelectTrack?: (track: EventTrack) => void;
  isAlternate?: boolean;
  onViewDetails: (event: TimelineEvent) => void;
  onEdit: (event: TimelineEvent) => void;
  onDelete: (event: TimelineEvent) => Promise<void>;
  onTagClick: (tag: string) => void;
  onOpenImageLightbox: (images: string[], index: number) => void;
}

export const EventCard: React.FC<EventCardProps> = ({
  event,
  track,
  onSelectTrack,
  onToggleReaction,
  currentUsername,
  onViewDetails,
  onEdit,
  onDelete,
  onTagClick,
  onOpenImageLightbox,
}) => {
  // A photo the owner just attached can still be local-only while the upload runs.
  const pendingPhotos = useLocalPhotos(event.id, event.resourceOwnerId);
  const photoCount = event.images.length + pendingPhotos.length;
  const emotionMeta = getEmotionMeta(event.emotion);
  const relativeTime = getRelativeTime(event.date);
  const TrackIcon = track ? getEventIconComponent(track.icon) : null;

  const locationLabel = event.location
    ? [event.location.name, event.location.city].filter(Boolean).join(', ')
    : null;

  return (
    <article
      id={`event-card-${momentIdentity(event)}`}
      data-memory-date={event.date ?? ''}
      data-milestone={event.isMilestone || undefined}
      className="archival-card"
      tabIndex={-1}
      onClick={() => onViewDetails(event)}
    >
      {photoCount > 0 && <div className="archival-card-media" data-multiple={photoCount > 1 || undefined}>
        {event.images.slice(0, 3).map((src, index) => <div key={`${src}:${index}`} className="archival-photo-frame">
          <PrivateImage src={src} variant={photoCount === 1 ? 'display' : 'thumb'} loading="lazy" alt={event.title} className="archival-card-photo" />
          <button type="button" className="archival-photo-opener" aria-label={photoCount === 1 ? 'Open photo preview' : `Open photo ${index + 1} of ${event.images.length}`} onClick={click => { click.stopPropagation(); onOpenImageLightbox(event.images, index); }} />
          {index === 2 && event.images.length > 3 && <span className="archival-photo-badge">+{event.images.length - 3} more</span>}
        </div>)}
        {pendingPhotos.slice(0, Math.max(0, 3 - event.images.length)).map(photo => <div key={photo.uploadId} className="archival-photo-frame">
          <img src={photo.url} alt={event.title} className="archival-card-photo object-cover" />
          <span className="archival-photo-badge archival-photo-status" role="status">{photo.status}</span>
        </div>)}
      </div>}
      <div className="archival-card-body">
        <div className="archival-card-meta">
          {event.date ? <time dateTime={event.date} title={relativeTime || undefined}>{formatDateDisplay(event.date, event.time)}</time> : <span>Undated</span>}
          {track && TrackIcon && <button type="button" className="archival-inline-track" onClick={click => { click.stopPropagation(); onSelectTrack?.(track); }} title={`View ${track.title} timeline`}><TrackIcon size={13} /><span>{track.title}</span></button>}
          {(locationLabel || event.location?.country) && <span><MapPin size={13} />{[locationLabel, event.location?.country].filter(Boolean).join(' · ')}</span>}
          {event.isMilestone && <span className="archival-wax"><Star size={13} fill="currentColor" />Milestone</span>}
          {emotionMeta && <span className="archival-mood"><span>{emotionMeta.emoji}</span>{emotionMeta.label}{event.emotionIntensity ? <small aria-label={`Intensity ${event.emotionIntensity} of 5`}>{[1, 2, 3, 4, 5].map(level => <i key={level} data-filled={level <= event.emotionIntensity!} />)}</small> : null}</span>}
        </div>
        <h3><button type="button" className="archival-card-title" onClick={click => { click.stopPropagation(); onViewDetails(event); }}>{event.title}</button></h3>
        {event.description && <p className="archival-card-excerpt line-clamp-4">{event.description}</p>}
        {event.idea && <div className="archival-card-idea"><Lightbulb size={15} /><div><span>Idea / Takeaway</span><p className="line-clamp-2">{event.idea}</p></div></div>}
        <div className="archival-card-footer">
          <div className="archival-card-tags">
            {event.tags?.map(tag => <button key={tag} type="button" onClick={click => { click.stopPropagation(); onTagClick(tag); }}>#{tag}</button>)}
          </div>
          <div className="archival-card-actions" onClick={click => click.stopPropagation()}>
            {(track?.accessRole === 'owner' || track?.accessRole === 'editor') && <>
              <button type="button" className="archival-icon-button" title="Edit event" aria-label="Edit event" onClick={() => onEdit(event)}><Edit2 size={14} /></button>
              <button type="button" className="archival-icon-button" title="Delete event" aria-label="Delete event" onClick={() => { if (window.confirm('Delete this event?')) void onDelete(event); }}><Trash2 size={14} /></button>
            </>}
            <button type="button" className="archival-open-card" onClick={() => onViewDetails(event)}>Open</button>
          </div>
        </div>
        <ReactionControls event={event} onToggleReaction={onToggleReaction} currentUsername={currentUsername} className="reaction-feed-rail" />
      </div>
    </article>
  );
};
