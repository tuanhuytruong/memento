import React, { useRef } from 'react';
import {
  Calendar,
  Plus,
  Download,
  Upload,
  RefreshCw,
  Star,
  MapPin,
  Image as ImageIcon,
  Sparkles,
} from 'lucide-react';
import { TimelineEvent } from '../types';

interface TimelineHeaderProps {
  events: TimelineEvent[];
  trackCount: number;
  onAddNewEvent: () => void;
  onAddNewTrack?: () => void;
  onExportJson: () => void;
  onImportJson: (file: File) => void;
  onResetToDemo: () => void;
}

export const TimelineHeader: React.FC<TimelineHeaderProps> = ({
  events,
  trackCount,
  onAddNewEvent,
  onAddNewTrack,
  onExportJson,
  onImportJson,
  onResetToDemo,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Derive metrics
  const totalEvents = events.length;
  const milestonesCount = events.filter((e) => e.isMilestone).length;
  const totalPhotos = events.reduce((acc, e) => acc + (e.images?.length || 0), 0);
  const uniquePlaces = new Set(
    events.map((e) => e.location?.city || e.location?.name).filter(Boolean)
  ).size;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImportJson(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <header className="mb-6 sm:mb-8">
      {/* Top Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-stone-200 dark:border-stone-800">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 mb-1.5">
            <div className="w-8 h-8 rounded-xl bg-amber-600 text-white flex items-center justify-center shadow-xs shrink-0">
              <Calendar className="w-4 h-4" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold font-display text-stone-900 dark:text-stone-100 tracking-tight">
              Timeline Event Tracker
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 max-w-xl">
            Chronicle life milestones with tag organization, attached imagery, emotion levels,
            philosophical ideas, and location context.
          </p>
        </div>

        {/* Action Controls - cleanly organized */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {/* Secondary Utilities: Export / Import / Reset segmented group */}
          <div className="inline-flex items-center rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 p-1 shadow-xs">
            <button
              id="export-timeline-json"
              onClick={onExportJson}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700 transition flex items-center gap-1.5 whitespace-nowrap"
              title="Export timeline data as JSON backup"
            >
              <Download className="w-3.5 h-3.5 text-stone-500" />
              <span className="hidden sm:inline">Export</span>
            </button>

            <div className="h-4 w-px bg-stone-200 dark:bg-stone-700 mx-0.5" />

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".json"
              className="hidden"
            />
            <button
              id="import-timeline-json"
              onClick={() => fileInputRef.current?.click()}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700 transition flex items-center gap-1.5 whitespace-nowrap"
              title="Import timeline data from JSON backup"
            >
              <Upload className="w-3.5 h-3.5 text-stone-500" />
              <span className="hidden sm:inline">Import</span>
            </button>

            <div className="h-4 w-px bg-stone-200 dark:bg-stone-700 mx-0.5" />

            <button
              id="reset-demo-timeline"
              onClick={onResetToDemo}
              className="p-1.5 rounded-lg text-xs font-medium text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-700 transition"
              title="Reset to demo entries"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Primary Action Buttons */}
          <div className="flex items-center gap-2">
            {onAddNewTrack && (
              <button
                id="open-create-track-modal-header"
                onClick={onAddNewTrack}
                className="px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-800 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-750 transition flex items-center gap-1.5 shadow-xs whitespace-nowrap active:scale-98"
                title="Create a new event track timeline"
              >
                <Plus className="w-3.5 h-3.5 text-amber-600 dark:text-amber-500" />
                <span>New Track</span>
              </button>
            )}

            <button
              id="open-create-event-modal"
              onClick={onAddNewEvent}
              className="px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-amber-600 hover:bg-amber-700 text-white shadow-xs transition flex items-center gap-2 active:scale-98 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Add Event</span>
            </button>
          </div>
        </div>
      </div>

      {/* Metrics ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 pt-5">
        <div className="px-3.5 py-2.5 rounded-xl bg-white dark:bg-stone-900 border border-stone-200/80 dark:border-stone-800 shadow-xs flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="text-base sm:text-lg font-bold text-stone-900 dark:text-stone-100 leading-none">
              {trackCount}
            </div>
            <div className="text-[11px] text-stone-400 font-medium mt-0.5">
              Event Timelines
            </div>
          </div>
        </div>

        <div className="px-3.5 py-2.5 rounded-xl bg-white dark:bg-stone-900 border border-stone-200/80 dark:border-stone-800 shadow-xs flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 flex items-center justify-center shrink-0">
            <Calendar className="w-4 h-4" />
          </div>
          <div>
            <div className="text-base sm:text-lg font-bold text-stone-900 dark:text-stone-100 leading-none">
              {totalEvents}
            </div>
            <div className="text-[11px] text-stone-400 font-medium mt-0.5">
              Total Logged
            </div>
          </div>
        </div>

        <div className="px-3.5 py-2.5 rounded-xl bg-white dark:bg-stone-900 border border-stone-200/80 dark:border-stone-800 shadow-xs flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
            <Star className="w-4 h-4 fill-current" />
          </div>
          <div>
            <div className="text-base sm:text-lg font-bold text-stone-900 dark:text-stone-100 leading-none">
              {milestonesCount}
            </div>
            <div className="text-[11px] text-stone-400 font-medium mt-0.5">
              Milestones
            </div>
          </div>
        </div>

        <div className="px-3.5 py-2.5 rounded-xl bg-white dark:bg-stone-900 border border-stone-200/80 dark:border-stone-800 shadow-xs flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300 flex items-center justify-center shrink-0">
            <ImageIcon className="w-4 h-4" />
          </div>
          <div>
            <div className="text-base sm:text-lg font-bold text-stone-900 dark:text-stone-100 leading-none">
              {totalPhotos}
            </div>
            <div className="text-[11px] text-stone-400 font-medium mt-0.5">
              Attached Photos
            </div>
          </div>
        </div>

        <div className="px-3.5 py-2.5 rounded-xl bg-white dark:bg-stone-900 border border-stone-200/80 dark:border-stone-800 shadow-xs flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 flex items-center justify-center shrink-0">
            <MapPin className="w-4 h-4" />
          </div>
          <div>
            <div className="text-base sm:text-lg font-bold text-stone-900 dark:text-stone-100 leading-none">
              {uniquePlaces}
            </div>
            <div className="text-[11px] text-stone-400 font-medium mt-0.5">
              Unique Places
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
