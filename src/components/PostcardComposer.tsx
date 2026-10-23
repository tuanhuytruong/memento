import { motion } from 'motion/react';
import { useOverlayMotion } from './ModalTransition';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EventTrack, PostcardRequest, PostcardSelection, PostcardTemplateKey, TimelineEvent } from '../types';
import { momentIdentity, trackIdentity } from '../lib/resourceIdentity';
import { requestPostcardPage } from '../lib/discoveryApi';
import { PrivateImage } from './PrivateImage';
import { useModalLifecycle } from '../lib/useModalLifecycle';
import { POSTCARD_LIMITS, POSTCARD_TEMPLATES, downloadPostcard, imageIdOf, renderPostcard, templateOf, validatePostcard } from '../lib/postcard';
import { formatDateDisplay } from '../lib/storage';
import { Download, Image as ImageIcon, Loader2, Sparkles, X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  /** Only the signed-in user's own tracks may be exported as a postcard. */
  tracks: EventTrack[];
  events?: TimelineEvent[];
  currentUserId: string;
  onClose: () => void;
}

type Step = 'select' | 'customize' | 'preview';
type PreviewState = { blob: Blob; url: string } | null;

const STEP_LABELS: { key: Step; label: string }[] = [
  { key: 'select', label: 'Select' },
  { key: 'customize', label: 'Customize' },
  { key: 'preview', label: 'Preview' },
];

/** Visible on narrow layouts only; desktop shows every step side by side. */
function isCompact() {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
}

export const PostcardComposer: React.FC<Props> = ({ isOpen, tracks, currentUserId, onClose }) => {
  const overlayMotion = useOverlayMotion();
  const panelRef = useModalLifecycle(isOpen, onClose);
  const [step, setStep] = useState<Step>('select');
  const [template, setTemplate] = useState<PostcardTemplateKey>('journey');
  const [trackKey, setTrackKey] = useState<string>('');
  const [selection, setSelection] = useState<PostcardSelection[]>([]);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [showDate, setShowDate] = useState(true);
  const [preview, setPreview] = useState<PreviewState>(null);
  const [previewInvalidated, setPreviewInvalidated] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [guidance, setGuidance] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const ownedTracks = useMemo(
    () => tracks.filter(track => track.accessRole === 'owner' && track.resourceOwnerId === currentUserId),
    [tracks, currentUserId],
  );
  const bounds = templateOf(template);
  const [trackMoments, setTrackMoments] = useState<TimelineEvent[]>([]);
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pagePending, setPagePending] = useState(false);
  const [pageError, setPageError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setTrackMoments([]); setNextCursor(null); setPageError('');
    if (!isOpen || !trackKey) return;
    const controller = new AbortController(); setPagePending(true);
    requestPostcardPage(trackKey, search, cursor, controller.signal).then(page => {
      if (controller.signal.aborted) return;
      setTrackMoments(page.moments); setNextCursor(page.nextCursor);
    }).catch(failure => { if (!controller.signal.aborted) setPageError(failure instanceof Error ? failure.message : 'Could not load memories.'); })
      .finally(() => { if (!controller.signal.aborted) setPagePending(false); });
    return () => controller.abort();
  }, [isOpen, trackKey, search, cursor, currentUserId, retry]);

  const releasePreview = useCallback(() => {
    if (previewUrlRef.current) { URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = null; }
    setPreview(null);
  }, []);

  // Any change invalidates the server-rendered preview until it is regenerated.
  const invalidate = useCallback(() => { releasePreview(); setPreviewInvalidated(true); }, [releasePreview]);

  useEffect(() => {
    if (!isOpen) {
      abortRef.current?.abort();
      abortRef.current = null;
      releasePreview();
      setStep('select'); setTemplate('journey'); setTrackKey(''); setSelection([]);
      setTitle(''); setNote(''); setShowDate(true); setPending(false);
      setError(''); setGuidance(''); setPreviewInvalidated(false);
    }
  }, [isOpen, releasePreview]);

  // Clear bytes on logout/identity change as well as on close.
  useEffect(() => {
    abortRef.current?.abort(); setSelection([]); setTrackKey(''); setSearch(''); setCursor(null); setTrackMoments([]); setPending(false); releasePreview();
  }, [currentUserId, releasePreview]);

  const buildSpec = useCallback((): PostcardRequest => ({
    template,
    moments: selection.map(item => ({ ownerId: item.event.resourceOwnerId!, id: item.event.id })),
    images: selection.map(item => item.imageId),
    captions: selection.map(item => item.caption),
    title: title.trim(),
    note: note.trim(),
    showDate,
  }), [template, selection, title, note, showDate]);

  // Each step validates only what that step owns, so the composer never blocks
  // progress on a field the user has not reached yet.
  const stepGuidance = (): string | null => {
    const spec = buildSpec();
    if (step === 'select') {
      if (spec.moments.length < bounds.min) return `A ${bounds.label} postcard needs at least ${bounds.min} moment.`;
      if (spec.moments.length > bounds.max) return `A ${bounds.label} postcard accepts at most ${bounds.max} moments.`;
      const keys = new Set(spec.moments.map(moment => `${moment.ownerId}:${moment.id}`));
      if (keys.size !== spec.moments.length) return 'The same moment was selected twice. Choose each moment once.';
      if (spec.images.length !== spec.moments.length) return 'Choose at most one photo per selected moment.';
      return null;
    }
    // Customize: wording and caption bounds, checked before any render starts.
    if (!spec.title) return 'Add a short title for the postcard.';
    if (spec.title.length > POSTCARD_LIMITS.title) return `Keep the title to ${POSTCARD_LIMITS.title} characters or fewer.`;
    if (spec.note.length > POSTCARD_LIMITS.note) return `Keep the personal note to ${POSTCARD_LIMITS.note} characters or fewer.`;
    for (const caption of spec.captions) if (caption.length > POSTCARD_LIMITS.caption) return `Keep each caption to ${POSTCARD_LIMITS.caption} characters or fewer.`;
    const seen = new Set<string>();
    for (const imageId of spec.images) {
      if (!imageId) continue;
      if (seen.has(imageId)) return 'The same photo was selected twice. Choose each photo once.';
      seen.add(imageId);
    }
    return null;
  };

  const proceed = () => {
    const problem = stepGuidance();
    if (problem) { setGuidance(problem); return; }
    setGuidance('');
    setStep(step === 'select' ? 'customize' : 'preview');
  };

  const generate = async () => {
    const problem = validatePostcard(buildSpec());
    if (problem) { setGuidance(problem); return; }
    setGuidance('');
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPending(true); setError('');
    try {
      const blob = await renderPostcard(buildSpec(), controller.signal);
      if (controller.signal.aborted) return;
      releasePreview();
      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      setPreview({ blob, url });
      setPreviewInvalidated(false);
    } catch (failure) {
      if (controller.signal.aborted) return;
      setError(failure instanceof Error && failure.message ? failure.message : 'The postcard could not be created. Please try again.');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  };

  const toggleMoment = (event: TimelineEvent) => {
    const key = momentIdentity(event);
    setSelection(previous => {
      const exists = previous.find(item => momentIdentity(item.event) === key);
      if (exists) return previous.filter(item => momentIdentity(item.event) !== key);
      if (previous.length >= bounds.max) return previous;
      return [...previous, { event, imageId: event.images[0] ? imageIdOf(event.images[0]) : null, caption: '' }];
    });
    invalidate();
  };

  const setPhoto = (key: string, imageSrc: string | null) => {
    setSelection(previous => previous.map(item => momentIdentity(item.event) === key ? { ...item, imageId: imageSrc ? imageIdOf(imageSrc) : null } : item));
    invalidate();
  };

  const setCaption = (key: string, value: string) => {
    setSelection(previous => previous.map(item => momentIdentity(item.event) === key ? { ...item, caption: value.slice(0, POSTCARD_LIMITS.caption) } : item));
    invalidate();
  };

  const move = (index: number, delta: number) => {
    setSelection(previous => {
      const next = [...previous];
      const target = index + delta;
      if (target < 0 || target >= next.length) return previous;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    invalidate();
  };

  const [compact, setCompact] = useState(isCompact);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setCompact(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const showStep = (target: Step) => !compact || step === target;

  if (!isOpen) return null;
  return (
    <motion.div {...overlayMotion.backdrop}
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="postcard-composer-title"
      tabIndex={-1}
      id="postcard-composer"
      className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:p-6"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <motion.div {...overlayMotion.panel} className="my-auto flex w-full max-w-5xl flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-4 shadow-xl dark:border-stone-700 dark:bg-stone-900 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="postcard-composer-title" className="text-base font-semibold text-stone-900 dark:text-stone-50">Create postcard</h2>
            <p className="text-xs text-stone-500">A private keepsake from your own memories.</p>
          </div>
          <button type="button" title="Close postcard composer" aria-label="Close postcard composer" onClick={onClose} className="min-h-11 min-w-11 rounded-xl border border-stone-200 text-stone-500 hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800">
            <X className="mx-auto h-4 w-4" />
          </button>
        </div>

        {compact && (
          <ol className="flex gap-2" aria-label="Postcard steps">
            {STEP_LABELS.map(item => (
              <li key={item.key} className="flex-1">
                <button
                  type="button"
                  onClick={() => setStep(item.key)}
                  aria-current={step === item.key ? 'step' : undefined}
                  className={`min-h-11 w-full rounded-lg border px-2 text-xs font-semibold ${step === item.key ? 'border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' : 'border-stone-200 text-stone-500 dark:border-stone-700'}`}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ol>
        )}

        {ownedTracks.length === 0 ? (
          <p className="rounded-xl border border-dashed border-stone-300 p-4 text-sm text-stone-600 dark:border-stone-700 dark:text-stone-300">
            Postcards are made from your own tracks. Create a track of your own first — memories shared with you stay private to their owner.
          </p>
        ) : (
          <div className={`gap-5 ${compact ? 'flex flex-col' : 'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'}`}>
            <div className={`flex min-w-0 flex-col gap-4 ${showStep('select') ? '' : 'hidden'}`}>
              <section aria-labelledby="postcard-template-heading" className="min-w-0">
                <h3 id="postcard-template-heading" className="mb-2 text-sm font-semibold text-stone-800 dark:text-stone-100">Template</h3>
                <div className="flex flex-wrap gap-2">
                  {POSTCARD_TEMPLATES.map(item => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => { setTemplate(item.key); setSelection(previous => previous.slice(0, item.max)); invalidate(); }}
                      aria-pressed={template === item.key}
                      className={`min-h-11 rounded-xl border px-3 text-xs font-semibold ${template === item.key ? 'border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' : 'border-stone-200 text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300'}`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-stone-500">{bounds.hint}</p>
              </section>

              <section aria-labelledby="postcard-track-heading" className="min-w-0">
                <h3 id="postcard-track-heading" className="mb-2 text-sm font-semibold text-stone-800 dark:text-stone-100">Your track</h3>
                <select
                  value={trackKey}
                  onChange={event => { setTrackKey(event.target.value); setCursor(null); setSelection([]); invalidate(); }}
                  className="min-h-11 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-900"
                >
                  <option value="">Choose one of your tracks…</option>
                  {ownedTracks.map(track => (
                    <option key={trackIdentity(track)} value={trackIdentity(track)}>{track.title}</option>
                  ))}
                </select>
              </section>

              <section aria-labelledby="postcard-moments-heading" className="min-w-0">
                <h3 id="postcard-moments-heading" className="mb-2 text-sm font-semibold text-stone-800 dark:text-stone-100">
                  Moments <span className="font-normal text-stone-500">({selection.length}/{bounds.max})</span>
                </h3>
                {trackKey && <label className="block text-sm">Search your memories<input value={search} maxLength={120} onChange={event => { setSearch(event.target.value); setCursor(null); }} className="my-2 min-h-11 w-full rounded-xl border px-3 dark:bg-stone-950 dark:border-stone-700" /></label>}
                {pagePending && <p role="status">Loading memories…</p>}
                {pageError && <div role="alert">{pageError}<button type="button" onClick={() => setRetry(value => value + 1)} className="min-h-11 px-3 underline">Retry</button></div>}
                {!trackKey && <p className="text-sm text-stone-500">Choose a track to see its moments.</p>}
                {trackKey && !pagePending && !pageError && trackMoments.length === 0 && (
                  <p className="rounded-xl border border-dashed border-stone-300 p-3 text-sm text-stone-600 dark:border-stone-700 dark:text-stone-300">
                    No memories found. Try another search or track.
                  </p>
                )}
                {trackKey && trackMoments.length > 0 && (
                  <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
                    {trackMoments.map(event => {
                      const key = momentIdentity(event);
                      const chosen = selection.some(item => momentIdentity(item.event) === key);
                      const full = selection.length >= bounds.max && !chosen;
                      return (
                        <li key={key}>
                          <label className={`flex min-h-11 items-center gap-3 rounded-xl border p-2 ${chosen ? 'border-amber-400 bg-amber-50/60 dark:bg-amber-950/30' : 'border-stone-200 dark:border-stone-700'} ${full ? 'opacity-50' : ''}`}>
                            <input type="checkbox" checked={chosen} disabled={full} onChange={() => toggleMoment(event)} className="h-5 w-5" />
                            {event.images[0] && <img src={`${event.images[0]}?variant=thumb`} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-lg object-cover" />}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-stone-800 dark:text-stone-100">{event.title}</span>
                              <span className="block truncate text-xs text-stone-500">{formatDateDisplay(event.date)}</span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="mt-2 flex flex-wrap gap-2">{cursor && <button type="button" disabled={pagePending} onClick={() => setCursor(null)} className="min-h-11 rounded-xl border px-3 text-sm">First page</button>}{nextCursor && <button type="button" disabled={pagePending} onClick={() => setCursor(nextCursor)} className="min-h-11 rounded-xl border px-3 text-sm">Next page</button>}</div>
                <p className="mt-2 text-xs text-stone-500">Your selected memories stay selected across pages and search.</p>
              </section>
            </div>
            <div className={`min-w-0 flex-col gap-4 ${compact ? 'flex' : 'flex'} ${showStep('customize') ? '' : 'hidden'}`}>
              <section aria-labelledby="postcard-text-heading" className="min-w-0">
                <h3 id="postcard-text-heading" className="mb-2 text-sm font-semibold text-stone-800 dark:text-stone-100">Wording</h3>
                <label className="block text-xs font-semibold text-stone-600 dark:text-stone-300">
                  Title
                  <input
                    value={title}
                    maxLength={POSTCARD_LIMITS.title}
                    onChange={event => { setTitle(event.target.value); invalidate(); }}
                    placeholder="Nhật ký mùa hè"
                    className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-stone-200 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-950"
                  />
                </label>
                <p className="mt-1 text-right text-xs text-stone-400">{title.length}/{POSTCARD_LIMITS.title}</p>
                <label className="mt-2 block text-xs font-semibold text-stone-600 dark:text-stone-300">
                  Personal note <span className="font-normal text-stone-400">(optional)</span>
                  <textarea
                    value={note}
                    maxLength={POSTCARD_LIMITS.note}
                    rows={3}
                    onChange={event => { setNote(event.target.value); invalidate(); }}
                    placeholder="Một dòng nhớ về ngày ấy…"
                    className="mt-1 w-full min-w-0 resize-y rounded-xl border border-stone-200 bg-white p-3 text-sm dark:border-stone-700 dark:bg-stone-950"
                  />
                </label>
                <p className="mt-1 text-right text-xs text-stone-400">{note.length}/{POSTCARD_LIMITS.note}</p>
                <label className="mt-2 flex min-h-11 items-center gap-2 text-sm text-stone-700 dark:text-stone-200">
                  <input type="checkbox" checked={showDate} onChange={event => { setShowDate(event.target.checked); invalidate(); }} className="h-5 w-5" />
                  Show the date on the postcard
                </label>
              </section>

              <section aria-labelledby="postcard-photos-heading" className="min-w-0">
                <h3 id="postcard-photos-heading" className="mb-2 text-sm font-semibold text-stone-800 dark:text-stone-100">Photos and captions</h3>
                {selection.length === 0 && <p className="text-sm text-stone-500">Pick at least one moment first.</p>}
                <ul className="flex flex-col gap-3">
                  {selection.map((item, index) => {
                    const key = momentIdentity(item.event);
                    const available = item.event.images;
                    return (
                      <li key={key} className="rounded-xl border border-stone-200 p-3 dark:border-stone-700">
                        <div className="flex items-center justify-between gap-2">
                          <p className="min-w-0 truncate text-sm font-medium text-stone-800 dark:text-stone-100">{index + 1}. {item.event.title}</p>
                          <div className="flex shrink-0 gap-1">
                            <button type="button" title="Move earlier" aria-label={`Move ${item.event.title} earlier`} disabled={index === 0} onClick={() => move(index, -1)} className="min-h-11 min-w-11 rounded-lg border border-stone-200 text-xs disabled:opacity-40 dark:border-stone-700">↑</button>
                            <button type="button" title="Move later" aria-label={`Move ${item.event.title} later`} disabled={index === selection.length - 1} onClick={() => move(index, 1)} className="min-h-11 min-w-11 rounded-lg border border-stone-200 text-xs disabled:opacity-40 dark:border-stone-700">↓</button>
                          </div>
                        </div>
                        {available.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => setPhoto(key, null)}
                              aria-pressed={item.imageId === null}
                              className={`min-h-11 rounded-lg border px-2 text-xs ${item.imageId === null ? 'border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/40' : 'border-stone-200 text-stone-500 dark:border-stone-700'}`}
                            >
                              <ImageIcon className="mx-auto h-4 w-4" />
                              Text only
                            </button>
                            {available.map(src => {
                              const id = imageIdOf(src);
                              return (
                                <button key={src} type="button" title={`Use photo for ${item.event.title}`} aria-label={`Use photo for ${item.event.title}`} onClick={() => setPhoto(key, src)} aria-pressed={item.imageId === id} className={`min-h-11 rounded-lg border p-1 ${item.imageId === id ? 'border-amber-400' : 'border-stone-200 dark:border-stone-700'}`}>
                                  <PrivateImage src={src} variant="thumb" alt="" loading="lazy" className="h-12 w-12 overflow-hidden rounded-md" />
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="mt-2 text-xs text-stone-500">This moment has no photo — it will be a text cell.</p>
                        )}
                        <label className="mt-2 block text-xs font-semibold text-stone-600 dark:text-stone-300">
                          Caption <span className="font-normal text-stone-400">(optional)</span>
                          <input
                            value={item.caption}
                            maxLength={POSTCARD_LIMITS.caption}
                            onChange={event => setCaption(key, event.target.value)}
                            placeholder="Ngày đầu tiên"
                            className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-stone-200 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-950"
                          />
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>
          </div>
        )}

        {showStep('preview') && (
          <section aria-labelledby="postcard-preview-heading" className="min-w-0">
            <h3 id="postcard-preview-heading" className="mb-2 flex items-center gap-2 text-sm font-semibold text-stone-800 dark:text-stone-100">
              <Sparkles className="h-4 w-4 text-amber-500" /> Preview
            </h3>
            {preview && !previewInvalidated ? (
              <img src={preview.url} alt="Postcard preview" className="mx-auto max-h-[60vh] w-auto rounded-xl border border-stone-200 dark:border-stone-700" data-testid="postcard-preview" />
            ) : (
              <p className="rounded-xl border border-dashed border-stone-300 p-4 text-sm text-stone-600 dark:border-stone-700 dark:text-stone-300">
                {previewInvalidated ? 'Your changes need a new preview. Generate it again to see and download the updated postcard.' : 'Generate a preview to see exactly what will be downloaded.'}
              </p>
            )}
          </section>
        )}

        {(guidance || error) && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            <p>{guidance || error}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-3 dark:border-stone-800">
          <p className="min-w-0 text-xs text-stone-500">
            Downloaded files leave Memento's access controls and cannot be recalled remotely.
          </p>
          <div className="flex flex-wrap gap-2">
            {!compact && step !== 'select' && (
              <button type="button" onClick={() => setStep(step === 'preview' ? 'customize' : 'select')} className="min-h-11 rounded-xl border border-stone-200 px-4 text-sm font-semibold text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300">
                Back
              </button>
            )}
            <button
              type="button"
              onClick={() => (step === 'preview' ? void generate() : proceed())}
              disabled={ownedTracks.length === 0 || pending || (step === 'select' && selection.length === 0)}
              className="min-h-11 rounded-xl bg-amber-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              {pending ? <Loader2 className="inline h-4 w-4 animate-spin" /> : step === 'preview' ? (preview && !previewInvalidated ? 'Preview ready' : 'Generate preview') : 'Continue'}
            </button>
            {preview && !previewInvalidated && (
              <button
                type="button"
                onClick={() => downloadPostcard(preview.blob)}
                title="Download the rendered postcard"
                className="min-h-11 rounded-xl border border-amber-300 px-4 text-sm font-semibold text-amber-800 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300"
              >
                <Download className="mr-1 inline h-4 w-4" />
                Download PNG
              </button>
            )}
          </div>
        </div>

      </motion.div>
    </motion.div>
  );
};

export default PostcardComposer;
