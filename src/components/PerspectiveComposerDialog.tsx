import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useModalLifecycle } from '../lib/useModalLifecycle';

interface Props { open: boolean; title: string; kind: 'perspective' | 'reflection'; editing: boolean; draft: string; busy: boolean; error: string; conflict: { version: number; latestText: string } | null; onDraft: (value: string) => void; onCancel: () => void; onSave: () => void; onUseLatest: () => void; onReplaceLatest: () => void; }
export function PerspectiveComposerDialog(props: Props) {
  const { open, title, kind, editing, draft, busy, error, conflict, onDraft, onCancel, onSave, onUseLatest, onReplaceLatest } = props;
  const panel = useModalLifecycle(open, onCancel);
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (open) requestAnimationFrame(() => textarea.current?.focus({ preventScroll: true })); }, [open]);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(<div style={{ zIndex: 70 }} className="fixed inset-0 z-[70] flex items-center justify-center bg-stone-950/60 p-3 sm:p-6" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onCancel(); }} onClick={event => event.stopPropagation()} onKeyDownCapture={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); } }}>
    <section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="perspective-dialog-title" onClick={event => event.stopPropagation()} className="relative z-[71] flex max-h-[min(88dvh,48rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl dark:border-stone-700 dark:bg-stone-900">
      <header className="flex shrink-0 items-center justify-between border-b border-stone-200 px-4 py-3 dark:border-stone-700"><div><h2 id="perspective-dialog-title" className="text-lg font-semibold text-stone-900 dark:text-stone-100">{title}</h2><p className="text-xs text-stone-500">{editing ? 'Edit your saved words' : kind === 'reflection' ? 'A separate reflection; the original story stays unchanged.' : 'Add a separate perspective alongside the story.'}</p></div><button type="button" aria-label="Close perspective editor" disabled={busy} onClick={onCancel} className="min-h-11 min-w-11 rounded-lg p-2 hover:bg-stone-100 disabled:opacity-50 dark:hover:bg-stone-800"><X className="mx-auto h-5 w-5" /></button></header>
      <div className="min-h-0 space-y-3 overflow-y-auto p-4">
        {conflict && <div role="alert" className="space-y-2 rounded-lg border border-amber-300 p-3 text-sm dark:border-amber-800"><p>This story changed while you were editing. Compare the latest saved words before choosing.</p><p className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words rounded bg-stone-100 p-2 dark:bg-stone-950">{conflict.latestText}</p><div className="flex flex-wrap gap-2"><button type="button" className="min-h-11 underline" onClick={onUseLatest}>Use latest and discard my draft</button><button type="button" className="min-h-11 underline" onClick={onReplaceLatest}>Replace latest with my draft</button></div></div>}
        {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{error}</p>}
        <label className="block text-sm font-medium text-stone-700 dark:text-stone-200">{editing ? 'Your words' : kind === 'reflection' ? 'Looking back · written today' : 'What do you remember?'}<textarea ref={textarea} value={draft} maxLength={2000} rows={7} disabled={busy} onChange={event => onDraft(event.target.value)} className="mt-2 w-full resize-y rounded-xl border border-stone-300 bg-white p-3 text-sm leading-relaxed dark:border-stone-700 dark:bg-stone-950" placeholder="Write your own memory; the original story stays unchanged." /></label>
        <p className="text-right text-xs text-stone-500">{draft.length}/2,000</p>
      </div>
      <footer className="flex shrink-0 justify-end gap-2 border-t border-stone-200 p-3 dark:border-stone-700"><button type="button" disabled={busy} onClick={onCancel} className="min-h-11 rounded-lg px-4 text-sm underline disabled:opacity-50">Cancel</button><button type="button" disabled={busy || !draft.trim()} onClick={onSave} className="min-h-11 rounded-lg bg-amber-700 px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : editing ? 'Save changes' : 'Save'}</button></footer>
    </section>
  </div>, document.body);
}
