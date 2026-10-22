import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError, dataApi } from '../lib/api';
import type { MomentPerspective, TimelineEvent } from '../types';
import { PerspectiveComposerDialog } from './PerspectiveComposerDialog';

interface Props {
  event: TimelineEvent;
  currentUserId: string;
  initialKind?: 'perspective' | 'reflection';
  onCreate: (kind: 'perspective' | 'reflection', body: string, requestId: string) => Promise<void>;
  onUpdate: (id: string, body: string, expectedVersion: number) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onDraftStateChange?: (dirty: boolean, pending: boolean) => void;
  /** Server-authoritative create capability, reported up so entry points fail closed. */
  onWriteCapabilityChange?: (canWrite: boolean) => void;
  /** Incremented by the detail modal's "Bây giờ nghĩ lại…" entry; opens kind=reflection. */
  reflectionSignal?: number;
}

function localDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function MomentPerspectives({ event, currentUserId, initialKind = 'perspective', onCreate, onUpdate, onDelete, onDraftStateChange, onWriteCapabilityChange, reflectionSignal = 0 }: Props) {
  const ownerId = event.resourceOwnerId;
  const identity = ownerId ? `${ownerId}:${event.id}` : '';
  const [items, setItems] = useState<MomentPerspective[]>([]);
  const [canModerate, setCanModerate] = useState(false);
  const [canWrite, setCanWrite] = useState(false);
  const [canRead, setCanRead] = useState(false);
  const [conflictVersion, setConflictVersion] = useState<number | null>(null);
  const [conflictLatestText, setConflictLatestText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [composerOpen, setComposerOpen] = useState(initialKind === 'reflection');
  const [kind, setKind] = useState<'perspective' | 'reflection'>(initialKind);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const generation = useRef(0);
  const handledReflection = useRef(0);
  const identityEpoch = useRef(0);
  const alive = useRef(true);
  const requestPending = useRef(false);
  const requestId = useRef<{ body: string; id: string } | null>(null);
  const initialDraft = useRef('');

  const reportedIdentity = useRef(identity);
  useLayoutEffect(() => {
    if (reportedIdentity.current !== identity) {
      reportedIdentity.current = identity;
      onDraftStateChange?.(false, false);
      return;
    }
    const dirty = editingId ? draft.trim() !== initialDraft.current : draft.trim().length > 0;
    onDraftStateChange?.(dirty, busy);
  }, [draft, editingId, identity, busy, onDraftStateChange]);

  useEffect(() => () => { onDraftStateChange?.(false, false); }, [onDraftStateChange]);

  const load = useCallback(async (cursor?: string, append = false) => {
    if (!ownerId) { setError('The owner of this memory could not be verified. Refresh to try again.'); return; }
    const current = ++generation.current;
    setLoading(true); setError('');
    try {
      const page = await dataApi.perspectives(event.id, ownerId, cursor);
      if (current !== generation.current) return;
      setItems(previous => append ? [...previous, ...page.perspectives] : page.perspectives);
      setNextCursor(page.nextCursor);
      setCanWrite(page.capabilities.canCreate);
      setCanRead(page.capabilities.canRead);
      setCanModerate(page.capabilities.canModerate);
    } catch (failure) {
      if (current !== generation.current) return;
      setError(failure instanceof Error ? failure.message : 'Could not load stories.');
      if (failure instanceof ApiError && [401, 403, 404].includes(failure.status)) {
        setItems([]); setDraft(''); setComposerOpen(false); setEditingId(null); setCanWrite(false); setCanRead(false); setCanModerate(false); requestId.current = null;
      }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [event.id, ownerId]);

  useLayoutEffect(() => {
    onDraftStateChange?.(false, false);
    initialDraft.current = '';
    setItems([]); setNextCursor(null); setDraft(''); setEditingId(null); setError(''); setCanRead(false); setConflictVersion(null); setConflictLatestText('');
    setComposerOpen(initialKind === 'reflection'); setKind(initialKind);
    return () => {
      onDraftStateChange?.(false, false);
      identityEpoch.current += 1; generation.current += 1; requestPending.current = false;
    };
  }, [identity, initialKind, onDraftStateChange]);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => { alive.current = false; generation.current += 1; requestPending.current = false; };
  }, [identity, initialKind, load]);

  useEffect(() => { onWriteCapabilityChange?.(canWrite); }, [canWrite, onWriteCapabilityChange]);

  // "Bây giờ nghĩ lại…" opens the shared composer as a dated reflection; capability gates it.
  useEffect(() => {
    if (!reflectionSignal || reflectionSignal === handledReflection.current) return;
    handledReflection.current = reflectionSignal;
    if (!canWrite || busy) return;
    const dirty = editingId ? draft.trim() !== initialDraft.current : draft.trim().length > 0;
    if (dirty && !window.confirm('Discard your unsaved perspective?')) return;
    initialDraft.current = ''; setDraft(''); setEditingId(null);
    setConflictVersion(null); setConflictLatestText(''); requestId.current = null;
    setKind('reflection'); setComposerOpen(true);
  }, [reflectionSignal, canWrite, busy, editingId, draft]);

  const closeComposer = () => {
    if (busy) return;
    const dirty = editingId ? draft.trim() !== initialDraft.current : draft.trim().length > 0;
    if (dirty && !window.confirm('Discard your unsaved perspective?')) return;
    initialDraft.current = ''; setComposerOpen(false); setDraft(''); setEditingId(null); setConflictVersion(null); setConflictLatestText(''); requestId.current = null;
  };

  const save = async () => {
    if (requestPending.current || busy) return;
    if (editingId && conflictVersion !== null) { setError('Resolve the version conflict before saving.'); return; }
    const body = draft.trim();
    if (!body || body.length > 2000) { setError('Write between 1 and 2,000 characters.'); return; }
    const activeIdentity = identityEpoch.current;
    requestPending.current = true; setBusy(true); setError('');
    try {
      if (editingId) {
        const original = items.find(item => item.id === editingId);
        if (!original) throw new Error('This story is no longer available. Refresh the section.');
        await onUpdate(editingId, body, original.version);
      } else {
        if (!requestId.current || requestId.current.body !== body) requestId.current = { body, id: crypto.randomUUID() };
        await onCreate(kind, body, requestId.current.id);
      }
      if (!alive.current || activeIdentity !== identityEpoch.current) return;
      requestId.current = null; initialDraft.current = ''; setDraft(''); setEditingId(null); setComposerOpen(false);
      await load();
    } catch (failure) {
      if (!alive.current || activeIdentity !== identityEpoch.current) return;
      setError(failure instanceof Error ? failure.message : 'Could not save. Your draft is still here.');
      if (failure instanceof ApiError && failure.status === 409 && editingId) {
        try {
          const page = await dataApi.perspectives(event.id, ownerId || '');
          const latest = page.perspectives.find(item => item.id === editingId);
          if (latest) { setItems(page.perspectives); setConflictVersion(latest.version); setConflictLatestText(latest.body); }
          else setError('This story was removed. Your draft is still here; copy it before closing.');
        } catch { setError('This story changed, but the latest version could not be loaded. Your draft is still here.'); }
      }
      if (failure instanceof ApiError && [401, 403, 404].includes(failure.status)) { initialDraft.current = ''; setItems([]); setDraft(''); setEditingId(null); setCanRead(false); setCanWrite(false); setCanModerate(false); setComposerOpen(false); setConflictVersion(null); setConflictLatestText(''); requestId.current = null; }
    } finally { if (alive.current && activeIdentity === identityEpoch.current) { requestPending.current = false; setBusy(false); } }
  };

  const remove = async (item: MomentPerspective) => {
    if (requestPending.current || !window.confirm('Remove this separate memory?')) return;
    const activeIdentity = identityEpoch.current;
    requestPending.current = true; setBusy(true); setError('');
    try { await onDelete(item.id); if (!alive.current || activeIdentity !== identityEpoch.current) return; setItems(previous => previous.filter(value => value.id !== item.id)); }
    catch (failure) { if (!alive.current || activeIdentity !== identityEpoch.current) return; setError(failure instanceof Error ? failure.message : 'Could not remove this memory.'); if (failure instanceof ApiError && [401, 403, 404].includes(failure.status)) { setItems([]); setCanWrite(false); setCanModerate(false); } }
    finally { if (alive.current && activeIdentity === identityEpoch.current) { requestPending.current = false; setBusy(false); } }
  };

  return <section aria-labelledby="moment-perspectives-title" className="space-y-3 border-t border-stone-100 pt-4 dark:border-stone-800">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 id="moment-perspectives-title" className="text-sm font-semibold text-stone-800 dark:text-stone-100">Our perspectives</h3><p className="text-xs text-stone-500">Separate memories alongside the original story.</p></div>
      {canWrite && <button type="button" className="min-h-11 rounded-lg border border-stone-300 px-3 text-sm hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800" onClick={() => { if (busy) return; const dirty = editingId ? draft.trim() !== initialDraft.current : draft.trim().length > 0; if (dirty && composerOpen && !window.confirm('Discard your unsaved perspective?')) return; initialDraft.current = ''; setKind('perspective'); setEditingId(null); setDraft(''); setConflictVersion(null); setConflictLatestText(''); requestId.current = null; setComposerOpen(value => !value); }}>Add your perspective</button>}
    </div>
    {loading && !items.length && <p role="status" className="text-sm text-stone-500">Loading memories…</p>}
    {error && <div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200"><p>{error}</p><button type="button" className="mt-1 min-h-11 underline" onClick={() => void load()}>Retry</button></div>}
    {!loading && !items.length && !error && <p className="text-sm text-stone-500">No extra perspectives yet.</p>}
    <ol className="space-y-3">
      {items.map(item => <li key={item.id} className="min-w-0 rounded-xl border border-stone-200 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-950/40">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><p className="min-w-0 break-words text-xs font-semibold text-stone-800 dark:text-stone-200">{item.username}<span className="ml-2 font-normal text-stone-500">{item.kind === 'reflection' ? 'Looking back' : 'Perspective'} · {localDateTime(item.createdAt)}{item.version > 1 ? ' · Edited' : ''}</span></p>
          {((item.authorId === currentUserId && canWrite) || canModerate) && <div className="flex shrink-0 gap-2"><button type="button" disabled={busy || item.authorId !== currentUserId || !canWrite} className="min-h-11 px-2 text-xs underline disabled:opacity-50" onClick={() => { if (busy) return; const dirty = editingId ? draft.trim() !== initialDraft.current : draft.trim().length > 0; if (dirty && !window.confirm('Discard your unsaved perspective?')) return; initialDraft.current = item.body; setKind(item.kind); setEditingId(item.id); setDraft(item.body); setConflictVersion(null); setConflictLatestText(''); requestId.current = null; setComposerOpen(true); }}>Edit</button><button type="button" disabled={busy} className="min-h-11 px-2 text-xs text-rose-700 underline disabled:opacity-50" onClick={() => void remove(item)}>Remove</button></div>}
        </div>
        {editingId === item.id ? null : <p className="mt-2 min-w-0 break-words whitespace-pre-wrap text-sm leading-relaxed text-stone-700 dark:text-stone-300">{item.body}</p>}
      </li>)}
    </ol>
    {canRead && !canWrite && <p className="text-xs text-stone-500">Editor access is needed to add a perspective.</p>}
    {nextCursor && <button type="button" disabled={loading} className="min-h-11 rounded-lg px-3 text-sm underline disabled:opacity-50" onClick={() => void load(nextCursor, true)}>{loading ? 'Loading…' : 'Load more'}</button>}
    <PerspectiveComposerDialog
      open={composerOpen && canWrite}
      title={editingId ? 'Edit perspective' : kind === 'reflection' ? 'Bây giờ nghĩ lại…' : 'Add your perspective'}
      kind={kind} editing={!!editingId} draft={draft} busy={busy} error={error}
      conflict={conflictVersion === null ? null : { version: conflictVersion, latestText: conflictLatestText }}
      onDraft={setDraft} onCancel={closeComposer} onSave={() => void save()}
      onUseLatest={() => { initialDraft.current = ''; setDraft(conflictLatestText); setConflictVersion(null); setConflictLatestText(''); setEditingId(null); setComposerOpen(false); }}
      onReplaceLatest={() => { if (window.confirm('Replace the latest saved words with your draft?')) setConflictVersion(null); }}
    />
  </section>;
}
