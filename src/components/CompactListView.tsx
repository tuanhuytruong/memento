import React from 'react';
import { TimelineEvent, EventTrack } from '../types';
import { getEmotionMeta } from '../data/emotions';
import { formatDateDisplay } from '../lib/storage';
import { getEventTheme, getEventIconComponent } from '../data/eventThemes';
import {
  Calendar,
  MapPin,
  Lightbulb,
  Star,
  Image as ImageIcon,
  Edit2,
  Trash2,
} from 'lucide-react';

interface CompactListViewProps {
  events: TimelineEvent[];
  tracks: EventTrack[];
  onSelectTrack?: (trackId: string) => void;
  onViewDetails: (event: TimelineEvent) => void;
  onEdit: (event: TimelineEvent) => void;
  onDelete: (id: string) => Promise<void>;
  onTagClick: (tag: string) => void;
}

export const CompactListView: React.FC<CompactListViewProps> = ({
  events,
  tracks,
  onSelectTrack,
  onViewDetails,
  onEdit,
  onDelete,
  onTagClick,
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
      id="compact-list-table-wrap"
      className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 shadow-xs overflow-hidden"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs sm:text-sm border-collapse">
          <thead>
            <tr className="border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/60 text-stone-500 dark:text-stone-400 font-semibold">
              <th className="py-3 px-4">Event Track</th>
              <th className="py-3 px-4">Date</th>
              <th className="py-3 px-4">Title & Context</th>
              <th className="py-3 px-4">Tags</th>
              <th className="py-3 px-4">Emotion</th>
              <th className="py-3 px-4">Location</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-stone-800/80">
            {events.map((evt) => {
              const emotionMeta = getEmotionMeta(evt.emotion);
              const track = evt.eventId ? trackMap.get(evt.eventId) : undefined;
              const theme = track ? getEventTheme(track.color) : null;
              const TrackIcon = track ? getEventIconComponent(track.icon) : null;

              return (
                <tr
                  key={evt.id}
                  onClick={() => onViewDetails(evt)}
                  className="hover:bg-amber-50/40 dark:hover:bg-amber-950/20 cursor-pointer transition-colors"
                >
                  {/* Event Track */}
                  <td className="py-3 px-4 whitespace-nowrap align-top">
                    {track && theme && TrackIcon ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onSelectTrack) onSelectTrack(track.id);
                        }}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition ${theme.badgeClass} hover:opacity-80`}
                        title={`Filter to ${track.title} timeline`}
                      >
                        <TrackIcon className="w-3 h-3" />
                        <span>{track.title}</span>
                      </button>
                    ) : (
                      <span className="text-stone-400 text-xs">General</span>
                    )}
                  </td>

                  {/* Date */}
                  <td className="py-3 px-4 whitespace-nowrap align-top">
                    <div className="font-medium text-stone-900 dark:text-stone-100">
                      {formatDateDisplay(evt.date)}
                    </div>
                    {evt.time && (
                      <div className="text-[11px] text-stone-400">{evt.time}</div>
                    )}
                    {evt.isMilestone && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400 mt-1">
                        <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                        Milestone
                      </span>
                    )}
                  </td>

                  {/* Title, Idea, and Images flag */}
                  <td className="py-3 px-4 align-top max-w-xs sm:max-w-md">
                    <div className="font-bold text-stone-900 dark:text-stone-100 hover:text-amber-700">
                      {evt.title}
                    </div>
                    {evt.idea && (
                      <div className="text-xs text-amber-800 dark:text-amber-300 italic flex items-center gap-1 mt-0.5 line-clamp-1">
                        <Lightbulb className="w-3 h-3 text-amber-500 fill-amber-500 shrink-0" />
                        "{evt.idea}"
                      </div>
                    )}
                    {evt.images && evt.images.length > 0 && (
                      <div className="flex items-center gap-1 text-[11px] text-sky-600 dark:text-sky-400 mt-1">
                        <ImageIcon className="w-3 h-3" />
                        <span>{evt.images.length} {evt.images.length === 1 ? 'photo' : 'photos'}</span>
                      </div>
                    )}
                  </td>

                  {/* Tags */}
                  <td className="py-3 px-4 align-top">
                    <div className="flex flex-wrap gap-1">
                      {evt.tags.map((tag) => (
                        <button
                          key={tag}
                          onClick={(e) => {
                            e.stopPropagation();
                            onTagClick(tag);
                          }}
                          className="px-2 py-0.5 rounded text-[11px] font-medium bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-amber-100 dark:hover:bg-amber-900 transition"
                        >
                          #{tag}
                        </button>
                      ))}
                    </div>
                  </td>

                  {/* Emotion */}
                  <td className="py-3 px-4 whitespace-nowrap align-top">
                    {emotionMeta ? (
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${emotionMeta.badgeBg} ${emotionMeta.badgeText} ${emotionMeta.borderColor}`}
                      >
                        <span>{emotionMeta.emoji}</span>
                        <span>{emotionMeta.label}</span>
                      </span>
                    ) : (
                      <span className="text-stone-300 dark:text-stone-600">—</span>
                    )}
                  </td>

                  {/* Location */}
                  <td className="py-3 px-4 align-top text-xs text-stone-600 dark:text-stone-400 max-w-xs truncate">
                    {evt.location ? (
                      <div className="flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                        <span className="truncate">
                          {[evt.location.name, evt.location.city].filter(Boolean).join(', ')}
                        </span>
                      </div>
                    ) : (
                      <span className="text-stone-300 dark:text-stone-600">—</span>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="py-3 px-4 text-right align-top whitespace-nowrap">
                    <div
                      className="inline-flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => onEdit(evt)}
                        className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition"
                        title="Edit event"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm('Delete this event?')) {
                            onDelete(evt.id);
                          }
                        }}
                        className="p-1.5 rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
                        title="Delete event"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
