import React from 'react';
import { TimelineEvent, EventTrack } from '../types';
import { getEmotionMeta } from '../data/emotions';
import { formatDateDisplay } from '../lib/storage';
import { getEventTheme, getEventIconComponent } from '../data/eventThemes';
import { Calendar, MapPin, Lightbulb, Star, ImageIcon } from 'lucide-react';

interface GalleryViewProps {
  events: TimelineEvent[];
  tracks: EventTrack[];
  onSelectTrack?: (trackId: string) => void;
  onViewDetails: (event: TimelineEvent) => void;
  onTagClick: (tag: string) => void;
  onOpenImageLightbox: (images: string[], index: number) => void;
}

export const GalleryView: React.FC<GalleryViewProps> = ({
  events,
  tracks,
  onSelectTrack,
  onViewDetails,
  onTagClick,
  onOpenImageLightbox,
}) => {
  if (events.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-stone-500">
        No events match current filters.
      </div>
    );
  }

  const trackMap = new Map<string, EventTrack>();
  tracks.forEach((t) => trackMap.set(t.id, t));

  return (
    <div
      id="gallery-view-grid"
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
    >
      {events.map((evt) => {
        const emotionMeta = getEmotionMeta(evt.emotion);
        const hasImages = evt.images && evt.images.length > 0;
        const track = evt.eventId ? trackMap.get(evt.eventId) : undefined;
        const theme = track ? getEventTheme(track.color) : null;
        const TrackIcon = track ? getEventIconComponent(track.icon) : null;

        return (
          <div
            key={evt.id}
            onClick={() => onViewDetails(evt)}
            className="group rounded-2xl overflow-hidden bg-white dark:bg-stone-900 border border-stone-200/80 dark:border-stone-800 shadow-xs hover:shadow-lg transition-all duration-300 flex flex-col cursor-pointer"
          >
            {/* Top image or visual header */}
            {hasImages ? (
              <div
                className="relative h-48 sm:h-52 w-full overflow-hidden bg-stone-100 dark:bg-stone-800"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenImageLightbox(evt.images, 0);
                }}
              >
                <img
                  src={evt.images[0]}
                  alt={evt.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                {evt.images.length > 1 && (
                  <span className="absolute bottom-2.5 right-2.5 px-2 py-1 rounded-md bg-black/60 backdrop-blur-xs text-white text-[11px] font-medium flex items-center gap-1">
                    <ImageIcon className="w-3 h-3" />
                    +{evt.images.length - 1}
                  </span>
                )}
                {evt.isMilestone && (
                  <span className="absolute top-2.5 left-2.5 px-2.5 py-0.5 rounded-full bg-amber-500 text-white text-[11px] font-bold flex items-center gap-1 shadow-xs">
                    <Star className="w-3 h-3 fill-white" /> Milestone
                  </span>
                )}
                {track && theme && TrackIcon && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onSelectTrack) onSelectTrack(track.id);
                    }}
                    className={`absolute top-2.5 right-2.5 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border backdrop-blur-md shadow-xs transition ${theme.badgeClass}`}
                  >
                    <TrackIcon className="w-3 h-3" />
                    <span>{track.title}</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="h-16 bg-gradient-to-r from-stone-100 to-amber-50/50 dark:from-stone-800 dark:to-stone-850 p-3 flex items-center justify-between border-b border-stone-100 dark:border-stone-800">
                <span className="text-xs font-semibold text-stone-500 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  {formatDateDisplay(evt.date)}
                </span>
                <div className="flex items-center gap-1.5">
                  {track && theme && TrackIcon && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onSelectTrack) onSelectTrack(track.id);
                      }}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border transition ${theme.badgeClass}`}
                    >
                      <TrackIcon className="w-3 h-3" />
                      <span>{track.title}</span>
                    </button>
                  )}
                  {evt.isMilestone && (
                    <span className="text-[11px] font-bold text-amber-600 flex items-center gap-1">
                      <Star className="w-3 h-3 fill-amber-500" />
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Card Content */}
            <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between space-y-3">
              <div>
                {/* Date & Emotion */}
                <div className="flex items-center justify-between text-xs text-stone-500 mb-1.5">
                  <span>{formatDateDisplay(evt.date)}</span>
                  {emotionMeta && (
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${emotionMeta.badgeBg} ${emotionMeta.badgeText} ${emotionMeta.borderColor}`}
                    >
                      <span>{emotionMeta.emoji}</span>
                      <span>{emotionMeta.label}</span>
                    </span>
                  )}
                </div>

                {/* Title */}
                <h3 className="font-display font-bold text-base sm:text-lg text-stone-900 dark:text-stone-100 group-hover:text-amber-700 dark:group-hover:text-amber-400 transition-colors mb-1.5">
                  {evt.title}
                </h3>

                {/* Location */}
                {evt.location && (
                  <div className="flex items-center gap-1 text-xs text-stone-500 dark:text-stone-400 mb-2">
                    <MapPin className="w-3 h-3 text-rose-500 shrink-0" />
                    <span className="truncate">
                      {[evt.location.name, evt.location.city].filter(Boolean).join(', ')}
                    </span>
                  </div>
                )}

                {/* Idea snippet */}
                {evt.idea && (
                  <div className="p-2.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 text-xs text-stone-700 dark:text-stone-300 italic mb-2 line-clamp-2">
                    <span className="font-semibold text-amber-800 dark:text-amber-400 not-italic mr-1">
                      💡 Idea:
                    </span>
                    "{evt.idea}"
                  </div>
                )}

                {/* Description snippet */}
                {evt.description && (
                  <p className="text-xs text-stone-600 dark:text-stone-400 line-clamp-2 leading-relaxed">
                    {evt.description}
                  </p>
                )}
              </div>

              {/* Tags */}
              <div className="flex flex-wrap gap-1 pt-2 border-t border-stone-100 dark:border-stone-800">
                {evt.tags.map((tag) => (
                  <button
                    key={tag}
                    onClick={(e) => {
                      e.stopPropagation();
                      onTagClick(tag);
                    }}
                    className="px-2 py-0.5 rounded text-[11px] font-medium bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-amber-100 transition"
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
