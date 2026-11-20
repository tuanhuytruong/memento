import { ReactionControls, type ReactionControlProps } from './ReactionControls';
import React from 'react';
import {
  Bookmark,
  MessageSquare,
  Star,
  Edit2,
  Trash2,
} from 'lucide-react';
import { TimelineEvent, EventTrack } from '../types';
import { getEmotionMeta } from '../data/emotions';
import { formatDateDisplay, getRelativeTime } from '../lib/storage';
import { PrivateImage } from './PrivateImage';
import { useLocalPhotos } from '../lib/localPhoto';
import { momentIdentity } from '../lib/resourceIdentity';

interface EventCardProps {
  onToggleReaction: ReactionControlProps['onToggleReaction'];
  currentUsername?: string;
  event: TimelineEvent;
  density?: number;
  saved?: boolean;
  showTrack?: boolean;
  onToggleSave?: (event: TimelineEvent) => Promise<void>;
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
  event, density = 3, saved, showTrack = true, onToggleSave,
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

  const locationLabel = event.location
    ? [event.location.name, event.location.city].filter(Boolean).join(', ')
    : null;

  return (
    <article
      id={`event-card-${momentIdentity(event)}`}
      data-memory-date={event.date ?? ''}
      style={(() => { const days = (Date.now() - new Date(event.date).valueOf()) / 86400000; const threshold = [7,30,90,180][density - 1]; return days > threshold ? { opacity: Math.max(.82, 1 - (days - threshold) / 3000) } : undefined; })()}
      data-milestone={event.isMilestone || undefined}
      className="archival-card"
      tabIndex={-1}
      onClick={() => onViewDetails(event)}
    >
      {photoCount > 0 && <div className="archival-card-media">
        {event.images.slice(0, 1).map((src, index) => <div key={`${src}:${index}`} className="archival-photo-frame">
          <PrivateImage src={src} variant={density >= 3 ? 'display' : 'thumb'} loading="lazy" alt={event.title} className="archival-card-photo" />
          <button type="button" className="archival-photo-opener" aria-label={'Open photo preview'} onClick={click => { click.stopPropagation(); onOpenImageLightbox(event.images, index); }} />
          {event.images.length > 1 && <span className="archival-photo-badge">+{event.images.length - 1} more</span>}
        </div>)}
        {pendingPhotos.slice(0, Math.max(0, 1 - event.images.length)).map(photo => <div key={photo.uploadId} className="archival-photo-frame">
          <img src={photo.url} alt={event.title} className="archival-card-photo object-cover" />
          <span className="archival-photo-badge archival-photo-status" role="status">{photo.status}</span>
        </div>)}
      </div>}
      <div className="archival-card-body">
        <div className="archival-card-meta">
          {event.date ? <time dateTime={event.date} title={relativeTime || undefined}>{formatDateDisplay(event.date, event.time)}</time> : <span>Undated</span>}
          {track && showTrack && <button type="button" className="archival-inline-track" onClick={click => { click.stopPropagation(); onSelectTrack?.(track); }} title={`View ${track.title} timeline`}><span>{track.title}</span></button>}
          {(locationLabel || event.location?.country) && <span>{[locationLabel, event.location?.country].filter(Boolean).join(' · ')}</span>}
          {event.isMilestone && <span className="archival-wax"><Star size={13} fill="currentColor" />Milestone</span>}
          {emotionMeta && <span className="archival-mood"><span>{emotionMeta.emoji}</span>{emotionMeta.label}{event.emotionIntensity ? <small aria-label={`Intensity ${event.emotionIntensity} of 5`}>{[1, 2, 3, 4, 5].map(level => <i key={level} data-filled={level <= event.emotionIntensity!} />)}</small> : null}</span>}
        </div>
        <h3><button type="button" className="archival-card-title" onClick={click => { click.stopPropagation(); onViewDetails(event); }}>{event.title}</button></h3>
        {event.description && <p className="archival-card-excerpt line-clamp-4">{event.description}</p>}
        {event.idea && <div className="archival-card-idea"><p className="line-clamp-2 italic">“{event.idea}”</p></div>}
        <div className="archival-card-footer" onClick={click => click.stopPropagation()}>
          <ReactionControls event={event} onToggleReaction={onToggleReaction} currentUsername={currentUsername} className="reaction-feed-rail" />
          <button className="archival-open-card inline-flex items-center gap-1.5" onClick={() => onViewDetails(event)}><MessageSquare size={14} />Perspectives</button>
          <div className="archival-card-tags">
            {event.tags?.map(tag => <button key={tag} type="button" onClick={click => { click.stopPropagation(); onTagClick(tag); }}>#{tag}</button>)}
          </div>
          <div className="archival-card-actions" onClick={click => click.stopPropagation()}>
            {(track?.accessRole === 'owner' || track?.accessRole === 'editor') && <>
              <button type="button" className="archival-icon-button" title="Edit event" aria-label="Edit event" onClick={() => onEdit(event)}><Edit2 size={14} /></button>
              <button type="button" className="archival-icon-button" title="Delete event" aria-label="Delete event" onClick={() => { if (window.confirm('Delete this event?')) void onDelete(event); }}><Trash2 size={14} /></button>
            </>}
            {onToggleSave && <button type="button" className="archival-open-card inline-flex items-center gap-1.5" aria-label={saved ? 'Remove from saved' : 'Save memory'} aria-pressed={!!saved} onClick={() => void onToggleSave(event)}><Bookmark size={14} fill={saved ? 'currentColor' : 'none'} />{saved ? 'Saved' : 'Save'}</button>}
            <button type="button" className="archival-open-card" onClick={() => onViewDetails(event)}>Open</button>
          </div>
        </div>
      </div>
    </article>
  );
};
