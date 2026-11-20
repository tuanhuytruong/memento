import type { ReactNode } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { useModalLifecycle } from '../lib/useModalLifecycle';

export const libraryButton = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-hairline bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-linen disabled:opacity-40 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800';
export const libraryPrimary = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-prussian px-4 py-2 text-sm font-semibold text-white hover:bg-prussian-hover disabled:opacity-40';
export const libraryCard = 'min-w-0 rounded-2xl border border-hairline bg-surface dark:border-stone-700 dark:bg-stone-900';
export const libraryField = 'mt-1 min-h-11 w-full min-w-0 rounded-xl border border-input-border bg-paper p-3 text-ink dark:border-stone-600 dark:bg-stone-950 dark:text-stone-100';

export function ArchivalLibraryFrame({ workspace, composing, reading, busy, name, headingId, title, eyebrow, description, actions, onClose, onBack, children }: {
  workspace: boolean; composing: boolean; reading: boolean; busy: boolean;
  name: string; headingId: string; title: string; eyebrow: string; description: string;
  actions?: ReactNode; onClose: () => void; onBack: () => void; children: ReactNode;
}) {
  // Standalone destinations stay in document flow; their draft editor remains
  // modal so the shell cannot navigate away while a save or discard is pending.
  const modal = !workspace || composing;
  const panel = useModalLifecycle(modal, onClose);
  return <div ref={panel} data-future-letter-library={name === 'letters' ? '' : undefined} role={modal ? 'dialog' : 'region'} aria-modal={modal || undefined} aria-labelledby={headingId} tabIndex={modal ? -1 : undefined}
    className={modal ? 'fixed inset-0 z-40 flex items-center justify-center bg-stone-950/50 sm:p-5' : `mx-auto min-w-0 ${reading ? 'max-w-[820px]' : 'max-w-[1160px]'} px-4 pt-6 pb-24 sm:px-8 sm:pt-8 lg:pb-16`}
    onMouseDown={modal ? e => { if (e.target === e.currentTarget) { e.preventDefault(); onClose(); } } : undefined}>
    <section className={modal ? 'flex h-[100dvh] w-full max-w-[960px] flex-col overflow-hidden bg-paper text-ink shadow-xl sm:max-h-[92dvh] sm:rounded-3xl dark:bg-stone-950 dark:text-stone-100' : 'text-ink dark:text-stone-100'}>
      <header className={modal ? 'flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-3 dark:border-stone-800' : 'flex flex-col gap-4 border-b border-hairline pb-6 sm:flex-row sm:items-end sm:justify-between dark:border-stone-800'}>
        <div className="min-w-0 space-y-1.5">
          {!composing && !reading && <p className="text-xs font-medium text-ink-muted dark:text-stone-400">{eyebrow}</p>}
          <h1 id={headingId} className={`font-display font-medium tracking-tight ${modal || reading ? 'text-xl' : 'text-3xl leading-tight sm:text-[40px]'}`}>{title}</h1>
          {!composing && !reading && <p className="max-w-2xl text-[15px] leading-relaxed text-ink-soft dark:text-stone-300">{description}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {(reading || composing) && <button type="button" disabled={busy} className={libraryButton} onClick={onBack}><ArrowLeft aria-hidden="true" size={16} />Back to {name}</button>}
          {actions}
          {modal && <button type="button" aria-label={`Close ${name}`} disabled={busy} className={libraryButton} onClick={onClose}><X aria-hidden="true" size={16} /></button>}
        </div>
      </header>
      <div className={modal ? `min-h-0 flex-1 ${composing ? 'overflow-hidden' : 'overflow-y-auto overscroll-contain p-4 sm:p-7'}` : 'min-w-0 pt-6'}>{children}</div>
    </section>
  </div>;
}
