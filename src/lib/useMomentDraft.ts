// In-memory, session-scoped moment drafts (Phase 1 Task 1.3).
//
// A draft survives closing the composer so an accidental Cancel, backdrop
// click or "New track" detour does not lose typed text. It never survives a
// reload, a tab close, a logout or an account switch: there is deliberately no
// localStorage/IndexedDB persistence and nothing is ever sent anywhere.
//
// Blob preview URLs are owned by the draft while it is stored, and are revoked
// only on discard, on a successful save, or when the whole store is cleared at
// session end — never when the same draft is reopened.
import { useMemo, useState } from 'react';
import type { EmotionKey } from '../types';

export interface MomentDraftFields {
  trackKey: string;
  title: string;
  date: string;
  time: string;
  description: string;
  tags: string[];
  emotion?: EmotionKey;
  emotionIntensity: number;
  idea: string;
  locationName: string;
  locationCity: string;
  locationCountry: string;
  isMilestone: boolean;
  /** Server image URLs plus `blob:` previews, in display order. */
  images: string[];
  /** Pending local uploads aligned with the `blob:` entries above. */
  imageFiles: File[];
}

export interface DraftScope {
  authGeneration: number;
  mode: 'create' | 'edit';
  momentId?: string;
  ownerId?: string;
  expectedVersion?: number;
}

interface StoredDraft {
  fields: MomentDraftFields;
  blobUrls: string[];
}

/**
 * Drafts are fenced by the auth generation, the create/edit identity and the
 * expected version, so a snapshot taken for one account or one stale edit can
 * never resurface into another session or a different version's form.
 */
export function draftScopeKey(scope: DraftScope): string {
  return [scope.authGeneration, scope.mode, scope.ownerId ?? '', scope.momentId ?? '', scope.expectedVersion ?? ''].join('|');
}

const drafts = new Map<string, StoredDraft>();

export function saveMomentDraft(key: string, draft: StoredDraft): void {
  drafts.set(key, { fields: draft.fields, blobUrls: [...draft.blobUrls] });
}

export function readMomentDraft(key: string): StoredDraft | null {
  return drafts.get(key) ?? null;
}

/** Removes one draft and returns the blob URLs that are now safe to revoke. */
export function clearMomentDraft(key: string): string[] {
  const stored = drafts.get(key);
  drafts.delete(key);
  return stored?.blobUrls ?? [];
}

/**
 * Session end: clears every draft and returns all blob URLs to revoke. Called
 * on logout and account switch so no private draft crosses a session boundary.
 */
export function releaseAllMomentDrafts(): string[] {
  const urls = [...drafts.values()].flatMap(draft => draft.blobUrls);
  drafts.clear();
  return urls;
}

export function momentDraftCount(): number {
  return drafts.size;
}

/**
 * Normalized projection used only for dirty comparison. Trims whitespace,
 * orders tags, drops volatile blob previews (their presence is represented by
 * the pending-file count) and folds an emotion's intensity away when no
 * emotion is chosen, so cosmetic differences never count as edits.
 */
export function normalizeDraftFields(fields: MomentDraftFields) {
  return {
    trackKey: fields.trackKey.trim(),
    title: fields.title.trim(),
    date: fields.date,
    time: fields.time.trim(),
    description: fields.description.trim(),
    tags: [...fields.tags].sort(),
    emotion: fields.emotion ?? null,
    emotionIntensity: fields.emotion ? fields.emotionIntensity : null,
    idea: fields.idea.trim(),
    locationName: fields.locationName.trim(),
    locationCity: fields.locationCity.trim(),
    locationCountry: fields.locationCountry.trim(),
    isMilestone: Boolean(fields.isMilestone),
    serverImages: fields.images.filter(image => !image.startsWith('blob:')),
    pendingFileCount: fields.imageFiles.length,
  };
}

export function isDraftDirty(baseline: MomentDraftFields, current: MomentDraftFields): boolean {
  return JSON.stringify(normalizeDraftFields(baseline)) !== JSON.stringify(normalizeDraftFields(current));
}

export type DismissDecision = 'close' | 'prompt';

/**
 * One decision boundary for every dismissal path (backdrop, Escape, header X,
 * Cancel, New track). An unchanged form closes directly; a busy form (save or
 * photo compression in flight) refuses to dismiss at all; a dirty form asks.
 */
export function useDraftDismissal({ dirty, busy, onClose }: {
  dirty: boolean;
  busy: boolean;
  onClose: () => void;
}) {
  const [asking, setAsking] = useState(false);

  const requestDismiss = (): DismissDecision => {
    if (busy) return 'close'; // caller must not even try: control is disabled
    if (!dirty) { onClose(); return 'close'; }
    setAsking(true);
    return 'prompt';
  };

  const continueEditing = () => setAsking(false);

  const keepDraft = (key: string, fields: MomentDraftFields, blobUrls: string[]) => {
    saveMomentDraft(key, { fields, blobUrls });
    setAsking(false);
    onClose();
  };

  const discard = () => { setAsking(false); onClose(); };

  return { asking, requestDismiss, continueEditing, keepDraft, discard };
}

/** Convenience for callers that hold a stable baseline object. */
export function useDraftDirty(baseline: MomentDraftFields | null, current: MomentDraftFields): boolean {
  return useMemo(() => (baseline ? isDraftDirty(baseline, current) : false), [baseline, current]);
}
