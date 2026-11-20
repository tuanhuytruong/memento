import { useCallback } from 'react';
import type { FutureLetter } from '../types';
import { PrivateImage } from './PrivateImage';
import { libraryCard } from './ArchivalLibraryFrame';

export function FutureLetterReader({ letter }: { letter: FutureLetter }) {
  const focus = useCallback((node: HTMLHeadingElement | null) => node?.focus({ preventScroll: true }), []);
  const date = (value: string) => new Date(value).toLocaleString(undefined, { timeZone: letter.timezone || undefined });
  return <article className={`${libraryCard} mx-auto max-w-[760px] space-y-8 break-words p-6 sm:p-12`}>
    <header className="space-y-3 border-b border-hairline pb-6 dark:border-stone-700">
      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-ink-muted dark:text-stone-400">
        {letter.state === 'draft' && <span>Draft preview</span>}
        {letter.sealedAt && <span>Sealed {date(letter.sealedAt)}</span>}
        {letter.releaseAt && <span>Opening time {date(letter.releaseAt)}{letter.timezone && ` · ${letter.timezone}`}</span>}
        {letter.openedAt && <span>First opened {date(letter.openedAt)}</span>}
      </div>
      <h2 ref={focus} tabIndex={-1} className="font-display text-3xl font-medium leading-tight sm:text-4xl">{letter.title}</h2>
    </header>
    <p className="whitespace-pre-wrap font-display text-lg leading-loose">{letter.body}</p>
    {!!letter.photos?.length && <section aria-label="Enclosed photographs" className="space-y-3 border-t border-hairline pt-6 dark:border-stone-700">
      <h3 className="text-sm font-medium text-ink-muted dark:text-stone-400">Enclosed photographs</h3>
      <div className="grid gap-4 sm:grid-cols-2">{letter.photos.map((photo, index) => <figure key={photo.imageId} className="min-w-0">
        {photo.available && photo.image ? <PrivateImage src={photo.image} variant="display" fit="contain" loading="lazy" alt={`Letter photo ${index + 1}`} className="aspect-[4/3] max-h-[65dvh] w-full overflow-hidden rounded-xl bg-linen dark:bg-stone-800" /> : <figcaption className="rounded-xl bg-linen p-4 dark:bg-stone-800">Photo no longer available</figcaption>}
      </figure>)}</div>
    </section>}
  </article>;
}
