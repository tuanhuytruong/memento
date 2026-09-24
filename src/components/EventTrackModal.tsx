import React, { useState, useEffect } from 'react';
import { X, Check, Trash2, Plus } from 'lucide-react';
import { EventTrack } from '../types';
import {
  EVENT_COLORS,
  AVAILABLE_ICONS,
  getEventIconComponent,
} from '../data/eventThemes';

interface EventTrackModalProps {
  isOpen: boolean;
  trackToEdit?: EventTrack | null;
  onClose: () => void;
  onSave: (trackData: Omit<EventTrack, 'id' | 'createdAt' | 'updatedAt'>, editId?: string) => void;
  onDelete?: (id: string) => void;
}

export const EventTrackModal: React.FC<EventTrackModalProps> = ({
  isOpen,
  trackToEdit,
  onClose,
  onSave,
  onDelete,
}) => {
  if (!isOpen) return null;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('indigo');
  const [icon, setIcon] = useState('Cpu');
  const [status, setStatus] = useState<'active' | 'completed' | 'archived'>('active');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    if (trackToEdit) {
      setTitle(trackToEdit.title);
      setDescription(trackToEdit.description || '');
      setColor(trackToEdit.color || 'indigo');
      setIcon(trackToEdit.icon || 'Cpu');
      setStatus(trackToEdit.status || 'active');
      setTags(trackToEdit.tags || []);
    } else {
      setTitle('');
      setDescription('');
      setColor('indigo');
      setIcon('Rocket');
      setStatus('active');
      setTags(['Initiative']);
    }
  }, [trackToEdit, isOpen]);

  const handleAddTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    onSave(
      {
        title: title.trim(),
        description: description.trim(),
        color,
        icon,
        status,
        tags,
      },
      trackToEdit?.id
    );
    onClose();
  };

  const SelectedIconComponent = getEventIconComponent(icon);

  return (
    <div
      id="event-track-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 backdrop-blur-sm p-3 sm:p-5 overflow-y-auto"
      onClick={onClose}
    >
      <div
        id="event-track-modal-card"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg bg-white dark:bg-stone-900 rounded-2xl shadow-2xl border border-stone-200 dark:border-stone-800 overflow-hidden my-6 flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-100 dark:border-stone-800 flex items-center justify-between bg-stone-50/50 dark:bg-stone-900/50">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center text-white ${
                EVENT_COLORS[color]?.accentBg || 'bg-indigo-600'
              }`}
            >
              <SelectedIconComponent className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold font-display text-stone-900 dark:text-stone-100">
                {trackToEdit ? 'Edit Event Track' : 'Create New Event Track'}
              </h2>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                A high-level project, chapter, or theme with its own dedicated timeline.
              </p>
            </div>
          </div>
          <button
            id="close-track-modal"
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1 text-sm">
          {/* Title */}
          <div>
            <label className="block font-semibold text-stone-800 dark:text-stone-200 mb-1.5">
              Event Title <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              id="track-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. AI Era, New Company, World Tour, Home Build..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition text-base"
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="block font-semibold text-stone-800 dark:text-stone-200 mb-1.5">
              Description & Scope
            </label>
            <textarea
              id="track-description-input"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this event or chapter encompass?"
              className="w-full px-3.5 py-2 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition text-xs sm:text-sm"
            />
          </div>

          {/* Color Palette Choice */}
          <div>
            <label className="block font-semibold text-stone-800 dark:text-stone-200 mb-2">
              Timeline Accent Color
            </label>
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
              {Object.entries(EVENT_COLORS).map(([colorKey, cfg]) => {
                const isSelected = color === colorKey;
                return (
                  <button
                    key={colorKey}
                    type="button"
                    onClick={() => setColor(colorKey)}
                    className={`h-9 rounded-xl flex items-center justify-center transition-all ${
                      cfg.accentBg
                    } text-white shadow-xs ${
                      isSelected
                        ? 'ring-4 ring-amber-400/50 scale-105'
                        : 'opacity-80 hover:opacity-100'
                    }`}
                    title={cfg.label}
                  >
                    {isSelected && <Check className="w-4 h-4" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Icon Selector */}
          <div>
            <label className="block font-semibold text-stone-800 dark:text-stone-200 mb-2">
              Event Icon
            </label>
            <div className="grid grid-cols-5 gap-2 max-h-36 overflow-y-auto pr-1">
              {AVAILABLE_ICONS.map((item) => {
                const IconComp = item.icon;
                const isSelected = icon === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setIcon(item.key)}
                    className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 transition ${
                      isSelected
                        ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border-amber-400 dark:border-amber-700 font-bold ring-2 ring-amber-500/20'
                        : 'bg-white dark:bg-stone-800 border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:border-stone-400'
                    }`}
                  >
                    <IconComp className="w-4 h-4" />
                    <span className="text-[10px] truncate max-w-full">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Status & Tags */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-stone-800 dark:text-stone-200 mb-1.5">
                Status
              </label>
              <select
                id="track-status-select"
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 text-xs sm:text-sm"
              >
                <option value="active">Active Track</option>
                <option value="completed">Completed / Concluded</option>
                <option value="archived">Archived</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-stone-800 dark:text-stone-200 mb-1.5">
                Tags / Categories
              </label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                  placeholder="e.g. AI, Startup..."
                  className="flex-1 px-3 py-2 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 text-xs"
                />
                <button
                  type="button"
                  onClick={handleAddTag}
                  className="px-3 py-2 rounded-xl bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-xs font-semibold"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 text-xs"
                >
                  #{tag}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    className="text-stone-400 hover:text-stone-600"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Footer actions */}
          <div className="flex items-center justify-between pt-4 border-t border-stone-200 dark:border-stone-800">
            {trackToEdit && onDelete ? (
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete event "${trackToEdit.title}"? Any associated moments will remain in the merged timeline.`
                    )
                  ) {
                    onDelete(trackToEdit.id);
                    onClose();
                  }
                }}
                className="px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-xl transition flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete Event
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold rounded-xl text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                id="save-track-button"
                className="px-5 py-2 text-xs font-semibold rounded-xl bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition"
              >
                {trackToEdit ? 'Save Changes' : 'Create Event Track'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
