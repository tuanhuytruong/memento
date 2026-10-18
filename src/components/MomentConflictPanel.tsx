import React from 'react';
import { AlertTriangle, ArrowRight, Copy, RefreshCw } from 'lucide-react';
import type { TimelineEvent } from '../types';

/**
 * Version-conflict comparison shown inside the composer after a 409.
 *
 * Contract (Phase 1 Task 1.4):
 * - The user's draft is never touched by this panel; it is displayed as plain
 *   escaped text next to the current server state fetched through the exact
 *   `(ownerId, id)` read.
 * - Nothing is re-submitted automatically. "Use latest saved values" replaces
 *   the form's contents and version; "Keep my edits" requires an explicit
 *   confirmation and then re-saves against the freshly fetched version, so a
 *   further conflict simply returns here.
 * - A deleted or revoked resource is reported as an access change; the user's
 *   typed text stays on screen so it can be copied, and no denied server
 *   content is shown.
 */

export interface ConflictDraftSummary {
  title: string;
  date: string;
  time?: string;
  description: string;
  tags: string[];
  idea?: string;
  isMilestone: boolean;
}

export type ConflictState =
  | { kind: 'comparison'; latest: TimelineEvent; draft: ConflictDraftSummary }
  | { kind: 'lost'; message: string; draft: ConflictDraftSummary };

const Line: React.FC<{ label: string; value?: string }> = ({ label, value }) => (
  <div className="flex gap-2 py-1 border-b border-stone-200/70 dark:border-stone-800 last:border-b-0">
    <span className="w-24 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400 pt-0.5">{label}</span>
    <span className="text-sm text-stone-800 dark:text-stone-200 whitespace-pre-wrap break-words min-w-0 flex-1">
      {value ? value : <span className="text-stone-400 dark:text-stone-500 italic">empty</span>}
    </span>
  </div>
);

const DraftBlock: React.FC<{ title: string; draft: ConflictDraftSummary }> = ({ title, draft }) => (
  <section aria-label={title} className="rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-800/40 p-3">
    <h4 className="text-xs font-bold text-stone-800 dark:text-stone-200 mb-1.5">{title}</h4>
    <Line label="Title" value={draft.title} />
    <Line label="Date" value={draft.time ? `${draft.date} ${draft.time}` : draft.date} />
    <Line label="Story" value={draft.description} />
    <Line label="Tags" value={draft.tags.join(', ')} />
    <Line label="Insight" value={draft.idea} />
    <Line label="Milestone" value={draft.isMilestone ? 'Yes' : 'No'} />
  </section>
);

export const MomentConflictPanel: React.FC<{
  state: ConflictState;
  busy?: boolean;
  onUseLatest: () => void;
  onKeepMine: () => void;
  onDismiss: () => void;
}> = ({ state, busy = false, onUseLatest, onKeepMine, onDismiss }) => {
  const lost = state.kind === 'lost';
  return (
    <div
      id="moment-conflict-panel"
      role="alert"
      aria-live="polite"
      className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 p-3.5 space-y-3"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200">
            {lost ? 'This memory is no longer available' : 'This memory changed while you were editing'}
          </h3>
          <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">
            {lost
              ? state.message
              : 'Nothing was overwritten. Compare the two versions below, then decide which one to keep.'}
          </p>
        </div>
      </div>

      {/* The access change must not swallow what the user typed: their own
          text stays on screen, unmodified and copyable. */}
      {state.kind === 'lost' && <DraftBlock title="Your unsaved text" draft={state.draft} />}

      {state.kind === 'comparison' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <section aria-label="Your edits" className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-3">
              <h4 className="text-xs font-bold text-stone-800 dark:text-stone-200 mb-1.5 flex items-center gap-1.5">
                <Copy className="w-3.5 h-3.5" /> Your edits
              </h4>
              <Line label="Title" value={state.draft.title} />
              <Line label="Date" value={state.draft.time ? `${state.draft.date} ${state.draft.time}` : state.draft.date} />
              <Line label="Story" value={state.draft.description} />
              <Line label="Tags" value={state.draft.tags.join(', ')} />
              <Line label="Insight" value={state.draft.idea} />
              <Line label="Milestone" value={state.draft.isMilestone ? 'Yes' : 'No'} />
            </section>
            <section aria-label="Latest saved" className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-3">
              <h4 className="text-xs font-bold text-stone-800 dark:text-stone-200 mb-1.5 flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> Latest saved
              </h4>
              <Line label="Title" value={state.latest.title} />
              <Line label="Date" value={state.latest.time ? `${state.latest.date} ${state.latest.time}` : state.latest.date} />
              <Line label="Story" value={state.latest.description} />
              <Line label="Tags" value={(state.latest.tags || []).join(', ')} />
              <Line label="Insight" value={state.latest.idea} />
              <Line label="Milestone" value={state.latest.isMilestone ? 'Yes' : 'No'} />
              <Line label="Version" value={String(state.latest.version ?? '—')} />
            </section>
          </div>
          <p className="text-[11px] text-stone-600 dark:text-stone-400">
            Photos are managed by the server: only attachments that are still on the latest saved version are kept when you continue.
          </p>
        </>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {state.kind === 'comparison' && (
          <>
            <button
              type="button"
              id="conflict-keep-mine"
              disabled={busy}
              onClick={onKeepMine}
              className="inline-flex min-h-11 items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition disabled:opacity-60"
            >
              Keep my edits <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              id="conflict-use-latest"
              disabled={busy}
              onClick={onUseLatest}
              className="px-3.5 py-2 min-h-11 text-xs font-semibold rounded-xl border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300 transition disabled:opacity-60"
            >
              Use latest saved values
            </button>
          </>
        )}
        <button
          type="button"
          id="conflict-dismiss"
          disabled={busy}
          onClick={onDismiss}
          className="px-3.5 py-2 min-h-11 text-xs font-semibold rounded-xl text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition disabled:opacity-60"
        >
          {lost ? 'Close' : 'Keep comparing'}
        </button>
      </div>
    </div>
  );
};
