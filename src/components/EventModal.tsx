import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Calendar,
  Clock,
  MapPin,
  Lightbulb,
  Sparkles,
  Tag,
  Image as ImageIcon,
  Plus,
  Trash2,
  Navigation,
  Star,
  UploadCloud,
  Check,
} from 'lucide-react';
import { TimelineEvent, EmotionKey, LocationMetadata, EventTrack } from '../types';
import { EMOTIONS, DEFAULT_TAGS } from '../data/emotions';
import { getEventTheme, getEventIconComponent } from '../data/eventThemes';
import { compressImage } from '../lib/images';

interface EventModalProps {
  isOpen: boolean;
  eventToEdit?: TimelineEvent | null;
  tracks: EventTrack[];
  defaultTrackId?: string;
  existingTags: string[];
  onClose: () => void;
  onSave: (eventData: Omit<TimelineEvent, 'id' | 'createdAt' | 'updatedAt'>, editId?: string, imageFiles?: File[]) => Promise<void>;
  onAddCustomTag?: (newTag: string) => Promise<void>;
  onCreateNewTrack?: () => void;
}

export const EventModal: React.FC<EventModalProps> = ({
  isOpen,
  eventToEdit,
  tracks,
  defaultTrackId,
  existingTags,
  onClose,
  onSave,
  onAddCustomTag,
  onCreateNewTrack,
}) => {
  const todayStr = new Date().toISOString().split('T')[0];
  const currentTimeStr = new Date().toTimeString().slice(0, 5);

  const [eventId, setEventId] = useState<string>(() => {
    if (defaultTrackId && defaultTrackId !== 'all') return defaultTrackId;
    return tracks[0]?.id || '';
  });
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayStr);
  const [time, setTime] = useState(currentTimeStr);
  const [description, setDescription] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState('');
  const [showNewTagInput, setShowNewTagInput] = useState(false);

  // Metadata
  const [selectedEmotion, setSelectedEmotion] = useState<EmotionKey | undefined>(undefined);
  const [emotionIntensity, setEmotionIntensity] = useState<number>(4);
  const [idea, setIdea] = useState('');
  const [locationName, setLocationName] = useState('');
  const [locationCity, setLocationCity] = useState('');
  const [locationCountry, setLocationCountry] = useState('');
  const [isLocating, setIsLocating] = useState(false);
  const [isMilestone, setIsMilestone] = useState(false);

  // Images: existing server URLs and new local files are tracked separately.
  const [images, setImages] = useState<string[]>([]);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [isAddingUrl, setIsAddingUrl] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Prefill on edit or reset on create
  useEffect(() => {
    if (!isOpen) return;
    setSaveError('');
    if (eventToEdit) {
      setEventId(eventToEdit.eventId || tracks[0]?.id || '');
      setTitle(eventToEdit.title);
      setDate(eventToEdit.date);
      setTime(eventToEdit.time || '');
      setDescription(eventToEdit.description);
      setSelectedTags(eventToEdit.tags || []);
      setSelectedEmotion(eventToEdit.emotion);
      setEmotionIntensity(eventToEdit.emotionIntensity || 4);
      setIdea(eventToEdit.idea || '');
      setLocationName(eventToEdit.location?.name || '');
      setLocationCity(eventToEdit.location?.city || '');
      setLocationCountry(eventToEdit.location?.country || '');
      setIsMilestone(!!eventToEdit.isMilestone);
      setImages(eventToEdit.images || []);
      setImageFiles([]);
    } else {
      const fallbackTrackId =
        defaultTrackId && defaultTrackId !== 'all' ? defaultTrackId : tracks[0]?.id || '';
      setEventId(fallbackTrackId);
      setTitle('');
      setDate(todayStr);
      setTime(currentTimeStr);
      setDescription('');
      setSelectedTags(['Milestone']);
      setSelectedEmotion('joyful');
      setEmotionIntensity(4);
      setIdea('');
      setLocationName('');
      setLocationCity('');
      setLocationCountry('');
      setIsMilestone(false);
      setImages([]);
      setImageFiles([]);
    }
  }, [eventToEdit, isOpen, defaultTrackId, tracks]);

  // Handle Tag toggle
  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter((t) => t !== tag));
    } else {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  const handleAddNewTag = async () => {
    const trimmed = newTagInput.trim();
    if (!trimmed) return;
    try {
      if (onAddCustomTag) await onAddCustomTag(trimmed);
      if (!selectedTags.includes(trimmed)) setSelectedTags((prev) => [...prev, trimmed]);
      setNewTagInput('');
      setShowNewTagInput(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save this tag. Please retry.');
    }
  };

  // Keep local files for the authenticated upload endpoint and use object URLs only for previews.
  // Photos are downscaled before upload so phone pictures stop hitting the server size limit.
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = (Array.from(e.target.files || []) as File[]).filter((file) => file.type.startsWith('image/'));
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!picked.length) return;
    setSaveError('');
    setIsCompressing(true);
    (async () => {
      const ready: File[] = [];
      for (const file of picked) {
        try {
          ready.push(await compressImage(file));
        } catch (error) {
          setSaveError(error instanceof Error ? error.message : `Could not prepare "${file.name}".`);
        }
      }
      if (ready.length) {
        setImageFiles((prev) => [...prev, ...ready]);
        setImages((prev) => [...prev, ...ready.map((file) => URL.createObjectURL(file))]);
      }
    })().finally(() => setIsCompressing(false));
  };

  const handleAddImageUrl = () => {
    if (imageUrlInput.trim()) {
      setImages((prev) => [...prev, imageUrlInput.trim()]);
      setImageUrlInput('');
      setIsAddingUrl(false);
    }
  };

  const removeImage = (index: number) => {
    const localIndex = images.slice(0, index + 1).filter((image) => image.startsWith('blob:')).length - 1;
    if (images[index]?.startsWith('blob:') && localIndex >= 0 && localIndex < imageFiles.length) {
      URL.revokeObjectURL(images[index]);
      setImageFiles((prev) => prev.filter((_, i) => i !== localIndex));
    }
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  // Geolocation detector
  const handleDetectLocation = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          // Attempt reverse geocode using public nominatim
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`
          );
          if (res.ok) {
            const data = await res.json();
            const address = data.address || {};
            const city = address.city || address.town || address.village || address.county || '';
            const country = address.country || '';
            const venue = data.name || address.suburb || 'Current Location';

            setLocationName(venue);
            setLocationCity(city);
            setLocationCountry(country);
          } else {
            setLocationName(`Lat: ${latitude.toFixed(3)}, Lng: ${longitude.toFixed(3)}`);
          }
        } catch {
          setLocationName(`Lat: ${latitude.toFixed(3)}, Lng: ${longitude.toFixed(3)}`);
        } finally {
          setIsLocating(false);
        }
      },
      (err) => {
        console.warn('Geolocation failed:', err.message);
        setIsLocating(false);
        alert('Could not retrieve coordinates. Please enter location manually.');
      },
      { timeout: 8000 }
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !date) return;

    let locationMeta: LocationMetadata | undefined = undefined;
    if (locationName.trim() || locationCity.trim() || locationCountry.trim()) {
      locationMeta = {
        name: locationName.trim() || locationCity.trim() || 'Specified Location',
        city: locationCity.trim() || undefined,
        country: locationCountry.trim() || undefined,
      };
    }

    const payload: Omit<TimelineEvent, 'id' | 'createdAt' | 'updatedAt'> = {
      eventId: eventId || tracks[0]?.id || 'evt-ai-era',
      title: title.trim(),
      date,
      time: time.trim() || undefined,
      description: description.trim(),
      tags: selectedTags.length > 0 ? selectedTags : ['General'],
      images: images.filter((image) => !image.startsWith('blob:')),
      emotion: selectedEmotion,
      emotionIntensity: selectedEmotion ? emotionIntensity : undefined,
      idea: idea.trim() || undefined,
      location: locationMeta,
      isMilestone,
    };

    setSaveError('');
    setIsSaving(true);
    onSave(payload, eventToEdit?.id, imageFiles).then(() => {
      images.filter((image) => image.startsWith('blob:')).forEach((image) => URL.revokeObjectURL(image));
      onClose();
    }).catch((error: unknown) => {
      setSaveError(error instanceof Error ? error.message : 'Could not save this moment. Your edits are still here; retry when ready.');
    }).finally(() => setIsSaving(false));
  };

  // Combine default tags with existing tags
  const allTagOptions = Array.from(new Set([...DEFAULT_TAGS, ...existingTags]));

  if (!isOpen) return null;

  return (
    <div
      id="event-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 backdrop-blur-sm p-3 sm:p-5 overflow-y-auto"
      onClick={onClose}
    >
      <div
        id="event-modal-card"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl bg-white dark:bg-stone-900 rounded-2xl shadow-2xl border border-stone-200 dark:border-stone-800 overflow-hidden my-6 flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-100 dark:border-stone-800 flex items-center justify-between bg-stone-50/50 dark:bg-stone-900/50">
          <div>
            <h2 className="text-xl font-bold font-display text-stone-900 dark:text-stone-100">
              {eventToEdit ? 'Edit Timeline Event' : 'Log New Timeline Event'}
            </h2>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
              Record life moments with deep contextual metadata, emotion, and insights.
            </p>
          </div>
          <button
            id="close-event-modal"
            onClick={onClose}
            className="p-2 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6 overflow-y-auto flex-1 text-sm">
          {/* Parent Event Track Selector */}
          <div className="bg-stone-50/70 dark:bg-stone-800/50 p-3.5 rounded-xl border border-stone-200/80 dark:border-stone-800">
            <div className="flex items-center justify-between mb-2">
              <label className="font-semibold text-stone-800 dark:text-stone-200 flex items-center gap-1.5">
                <span>Belongs to Event Track</span>
                <span className="text-rose-500">*</span>
              </label>
              {onCreateNewTrack && (
                <button
                  type="button"
                  onClick={onCreateNewTrack}
                  className="text-xs text-amber-700 dark:text-amber-400 font-semibold hover:underline flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> New Event Track
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {tracks.map((t) => {
                const isSelected = eventId === t.id;
                const theme = getEventTheme(t.color);
                const IconComp = getEventIconComponent(t.icon);

                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setEventId(t.id)}
                    className={`p-2.5 rounded-xl border text-left transition flex items-center gap-2.5 ${
                      isSelected
                        ? `${theme.bgLight} ${theme.bgDark} ${theme.borderLight} ${theme.borderDark} ring-2 ring-amber-500/20 shadow-xs font-semibold`
                        : 'bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-700 hover:border-stone-300 text-stone-700 dark:text-stone-300'
                    }`}
                  >
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center text-white shrink-0 ${theme.accentBg}`}
                    >
                      <IconComp className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold truncate">{t.title}</div>
                      <div className="text-[10px] text-stone-400 truncate">{t.description || 'Event timeline'}</div>
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Title & Milestone Flag */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="font-semibold text-stone-800 dark:text-stone-200 flex items-center gap-1.5">
                Event Title <span className="text-rose-500">*</span>
              </label>
              <button
                type="button"
                id="toggle-milestone-button"
                onClick={() => setIsMilestone(!isMilestone)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition ${
                  isMilestone
                    ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                    : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400 hover:bg-stone-200'
                }`}
              >
                <Star
                  className={`w-3.5 h-3.5 ${
                    isMilestone ? 'fill-amber-500 text-amber-500' : 'text-stone-400'
                  }`}
                />
                {isMilestone ? 'Key Milestone' : 'Mark as Milestone'}
              </button>
            </div>
            <input
              type="text"
              required
              id="event-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Summit of Mount Rainier, Released Project Aurora..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition text-base"
              autoFocus
            />
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="font-semibold text-stone-800 dark:text-stone-200 mb-1.5 flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-stone-500" />
                Date <span className="text-rose-500">*</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="date"
                  required
                  id="event-date-input"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition"
                />
                <button
                  type="button"
                  id="set-today-button"
                  onClick={() => setDate(todayStr)}
                  className="px-2.5 py-1 text-xs font-medium rounded-lg bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 shrink-0"
                >
                  Today
                </button>
              </div>
            </div>

            <div>
              <label className="font-semibold text-stone-800 dark:text-stone-200 mb-1.5 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-stone-500" />
                Time (Optional)
              </label>
              <input
                type="time"
                id="event-time-input"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition"
              />
            </div>
          </div>

          {/* Categorize by Tags */}
          <div className="bg-stone-50/70 dark:bg-stone-800/40 p-3.5 rounded-xl border border-stone-200/70 dark:border-stone-800">
            <div className="flex items-center justify-between mb-2">
              <label className="font-semibold text-stone-800 dark:text-stone-200 flex items-center gap-1.5">
                <Tag className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                Categorize by Tags
              </label>
              <span className="text-xs text-stone-500">
                {selectedTags.length} selected
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5 mb-2.5 max-h-28 overflow-y-auto pr-1">
              {allTagOptions.map((tag) => {
                const isSelected = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition flex items-center gap-1 ${
                      isSelected
                        ? 'bg-amber-600 text-white shadow-xs'
                        : 'bg-white dark:bg-stone-800 text-stone-700 dark:text-stone-300 border border-stone-200 dark:border-stone-700 hover:border-stone-400'
                    }`}
                  >
                    {isSelected && <Check className="w-3 h-3" />}
                    {tag}
                  </button>
                );
              })}
            </div>

            {/* Add Custom Tag */}
            {showNewTagInput ? (
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="text"
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddNewTag())}
                  placeholder="New tag name..."
                  className="px-3 py-1.5 text-xs rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-500"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleAddNewTag}
                  className="px-3 py-1.5 text-xs rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 font-medium"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewTagInput(false)}
                  className="p-1.5 text-stone-400 hover:text-stone-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                id="create-custom-tag-button"
                onClick={() => setShowNewTagInput(true)}
                className="text-xs text-amber-700 dark:text-amber-400 font-medium hover:underline flex items-center gap-1 mt-1"
              >
                <Plus className="w-3 h-3" /> Create new custom tag
              </button>
            )}
          </div>

          {/* Emotion Metadata */}
          <div className="bg-stone-50/70 dark:bg-stone-800/40 p-3.5 rounded-xl border border-stone-200/70 dark:border-stone-800">
            <div className="flex items-center justify-between mb-2">
              <label className="font-semibold text-stone-800 dark:text-stone-200 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-violet-500" />
                Emotion & Mood
              </label>
              {selectedEmotion && (
                <button
                  type="button"
                  onClick={() => setSelectedEmotion(undefined)}
                  className="text-xs text-stone-400 hover:text-stone-600"
                >
                  Clear emotion
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
              {EMOTIONS.map((emo) => {
                const isSelected = selectedEmotion === emo.key;
                return (
                  <button
                    key={emo.key}
                    type="button"
                    onClick={() => setSelectedEmotion(emo.key)}
                    className={`p-2 rounded-xl text-left border transition flex items-center gap-2 ${
                      isSelected
                        ? `${emo.badgeBg} ${emo.borderColor} ring-2 ring-amber-500/20 shadow-xs font-semibold`
                        : 'bg-white dark:bg-stone-800 border-stone-200 dark:border-stone-700 hover:border-stone-300 text-stone-700 dark:text-stone-300'
                    }`}
                  >
                    <span className="text-lg">{emo.emoji}</span>
                    <span className="text-xs truncate">{emo.label}</span>
                  </button>
                );
              })}
            </div>

            {selectedEmotion && (
              <div className="flex items-center gap-3 pt-2 border-t border-stone-200/60 dark:border-stone-700/60">
                <span className="text-xs text-stone-500 font-medium">Intensity:</span>
                <div className="flex items-center gap-1.5">
                  {[1, 2, 3, 4, 5].map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setEmotionIntensity(level)}
                      className={`w-7 h-7 rounded-full text-xs font-semibold flex items-center justify-center transition ${
                        emotionIntensity >= level
                          ? 'bg-amber-600 text-white'
                          : 'bg-stone-200 dark:bg-stone-700 text-stone-500 hover:bg-stone-300'
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-stone-400 ml-auto">
                  {emotionIntensity === 5 ? 'Profound' : emotionIntensity >= 3 ? 'Strong' : 'Subtle'}
                </span>
              </div>
            )}
          </div>

          {/* Idea & Insight Metadata */}
          <div className="bg-amber-50/50 dark:bg-amber-950/20 p-3.5 rounded-xl border border-amber-200/60 dark:border-amber-900/40">
            <label className="font-semibold text-stone-800 dark:text-stone-200 mb-1 flex items-center gap-1.5">
              <Lightbulb className="w-4 h-4 text-amber-500 fill-amber-500" />
              Idea, Key Insight, or Reflection
            </label>
            <p className="text-xs text-stone-500 dark:text-stone-400 mb-2">
              Capture a realization, philosophy, creative idea, or takeaway from this moment.
            </p>
            <textarea
              id="event-idea-input"
              rows={2}
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="e.g. In quiet moments between meetings, the most creative architectural breakthroughs occur..."
              className="w-full px-3 py-2 text-xs sm:text-sm rounded-lg border border-amber-200 dark:border-amber-800/80 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
            />
          </div>

          {/* Location Metadata */}
          <div className="bg-stone-50/70 dark:bg-stone-800/40 p-3.5 rounded-xl border border-stone-200/70 dark:border-stone-800">
            <div className="flex items-center justify-between mb-2">
              <label className="font-semibold text-stone-800 dark:text-stone-200 flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-rose-500" />
                Location Context
              </label>
              <button
                type="button"
                id="detect-location-button"
                onClick={handleDetectLocation}
                disabled={isLocating}
                className="text-xs text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white flex items-center gap-1 px-2.5 py-1 rounded-md bg-stone-200/70 dark:bg-stone-700 hover:bg-stone-300 transition"
              >
                <Navigation className={`w-3 h-3 ${isLocating ? 'animate-spin' : ''}`} />
                {isLocating ? 'Detecting...' : 'Use current location'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <input
                  type="text"
                  id="event-location-name"
                  value={locationName}
                  onChange={(e) => setLocationName(e.target.value)}
                  placeholder="Venue or landmark (e.g. Louvre Museum)"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <input
                  type="text"
                  id="event-location-city"
                  value={locationCity}
                  onChange={(e) => setLocationCity(e.target.value)}
                  placeholder="City (e.g. Paris)"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <input
                  type="text"
                  id="event-location-country"
                  value={locationCountry}
                  onChange={(e) => setLocationCountry(e.target.value)}
                  placeholder="Country (e.g. France)"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
          </div>

          {/* Images Attachment */}
          <div className="bg-stone-50/70 dark:bg-stone-800/40 p-3.5 rounded-xl border border-stone-200/70 dark:border-stone-800">
            <div className="flex items-center justify-between mb-2">
              <label className="font-semibold text-stone-800 dark:text-stone-200 flex items-center gap-1.5">
                <ImageIcon className="w-4 h-4 text-sky-500" />
                Attach Images
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  id="add-image-url-toggle"
                  onClick={() => setIsAddingUrl(!isAddingUrl)}
                  className="text-xs text-amber-700 dark:text-amber-400 hover:underline"
                >
                  {isAddingUrl ? 'Cancel URL' : '+ Image Link'}
                </button>
                <button
                  type="button"
                  id="upload-image-button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs px-2.5 py-1 rounded-md bg-stone-200 dark:bg-stone-700 hover:bg-stone-300 dark:hover:bg-stone-600 text-stone-800 dark:text-stone-200 flex items-center gap-1"
                >
                  <UploadCloud className="w-3.5 h-3.5" /> Upload File
                </button>
              </div>
            </div>

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept="image/*"
              multiple
              className="hidden"
            />

            {isAddingUrl && (
              <div className="flex gap-2 mb-3">
                <input
                  type="url"
                  value={imageUrlInput}
                  onChange={(e) => setImageUrlInput(e.target.value)}
                  placeholder="Paste web image URL (https://...)"
                  className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100"
                />
                <button
                  type="button"
                  onClick={handleAddImageUrl}
                  className="px-3 py-1.5 text-xs rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 font-medium"
                >
                  Attach
                </button>
              </div>
            )}

            {/* Thumbnail previews */}
            {images.length > 0 ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {images.map((img, idx) => (
                  <div
                    key={idx}
                    className="relative group w-20 h-20 rounded-lg overflow-hidden border border-stone-200 dark:border-stone-700 bg-stone-100"
                  >
                    <img
                      src={img}
                      alt="Attachment"
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(idx)}
                      className="absolute inset-0 bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label="Remove image"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-stone-400 italic">
                No images attached yet. Upload photos from your camera or paste a web URL.
              </p>
            )}
          </div>

          {/* Description & Narrative */}
          <div>
            <label className="font-semibold text-stone-800 dark:text-stone-200 mb-1.5 block">
              Event Story / Journal Notes
            </label>
            <textarea
              id="event-description-input"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What happened? Who was there? Tell the story of this event..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition"
            />
          </div>

          {saveError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">{saveError} Your changes are preserved; please retry.</p>}

          {/* Footer Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-stone-200 dark:border-stone-800">
            <button
              type="button"
              id="cancel-event-button"
              onClick={onClose}
              disabled={isSaving || isCompressing}
              className="px-5 py-2.5 text-xs font-semibold rounded-xl text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              id="save-event-button"
              disabled={isSaving || isCompressing}
              className="px-6 py-2.5 text-xs font-semibold rounded-xl bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition disabled:opacity-60"
            >
              {isSaving ? 'Saving…' : isCompressing ? 'Preparing photos…' : eventToEdit ? 'Save Changes' : 'Add to Timeline'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
