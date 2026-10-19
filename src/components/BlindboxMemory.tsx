import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Dices, ExternalLink, Sparkles, X } from 'lucide-react';
import { getEmotionMeta } from '../data/emotions';
import { type EventTrack, type TimelineEvent } from '../types';
import { type BlindboxIntent, type BlindboxResult, reflectionPrompt } from '../lib/blindboxMemory';
import { requestBlindbox } from '../lib/discoveryApi';
import { PrivateImage } from './PrivateImage';
import { useModalLifecycle } from '../lib/useModalLifecycle';

type Props = { open: boolean; currentUserId?: string; events?: TimelineEvent[]; tracks: EventTrack[]; onClose: () => void; onOpen: (event: TimelineEvent) => void };
type Reveal = BlindboxResult | null;
const intents: { key: BlindboxIntent; label: string }[] = [{ key: 'surprise', label: 'Surprise me' }, { key: 'comfort', label: 'Comfort' }, { key: 'courage', label: 'Courage' }, { key: 'spark', label: 'Spark' }, { key: 'reflection', label: 'Reflection' }, { key: 'celebration', label: 'Celebrate' }];

export function BlindboxMemory(props: Props) { return props.open ? <BlindboxBody {...props} /> : null; }
function BlindboxBody({ open, currentUserId, tracks, onClose, onOpen }: Props) {
  const reducedMotion = useReducedMotion();
  const [intent, setIntent] = useState<BlindboxIntent>('surprise');
  const [query, setQuery] = useState('');
  const [snapshot, setResult] = useState<Reveal>(null);
  const result = snapshot;
  const controller = useRef<AbortController | null>(null);
  const [error, setError] = useState('');
  const modal = useModalLifecycle(open, onClose);
  const [isRevealing, setIsRevealing] = useState(true);
  const [revealKey, setRevealKey] = useState(0);
  const [customizing, setCustomizing] = useState(false);
  const applied = useRef<{intent: BlindboxIntent; query: string}>({intent:'surprise', query:''});
  const busy = useRef(false);
  const reveal = async (options = applied.current) => {
    if (busy.current) return;
    busy.current = true;
    const request = new AbortController(); controller.current = request;
    setIsRevealing(true); setError('');
    try {
      const selected = await requestBlindbox(options.intent, options.query, request.signal);
      if (request.signal.aborted || controller.current !== request) return;
      if (selected) { setResult(selected); applied.current = options; setCustomizing(false); setRevealKey(key => key + 1); }
      else setError('No accessible memories to reveal yet.');
    } catch (failure) { if (!request.signal.aborted && controller.current === request) setError(failure instanceof Error ? failure.message : 'Could not reveal a memory. Please retry.'); }
    finally { if (!request.signal.aborted && controller.current === request) { busy.current = false; setIsRevealing(false); } }
  };
  useEffect(() => {
    void reveal({intent:'surprise', query:''});
    return () => { controller.current?.abort(); busy.current = false; };
  }, []);

  const track = result && tracks.find((item) => item.id === result.event.eventId && item.resourceOwnerId === result.event.resourceOwnerId);
  const emotion = result && getEmotionMeta(result.event.emotion);
  const panelInitial = reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 14 };
  const panelAnimate = reducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 };

  return <AnimatePresence>{open && <motion.div ref={modal} tabIndex={-1} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0.12 : 0.18 }} className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-950/55 p-4" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="Blindbox memory">
    <motion.section initial={panelInitial} animate={panelAnimate} exit={panelInitial} transition={{ type: reducedMotion ? 'tween' : 'spring', stiffness: 360, damping: 28, duration: 0.2 }} className="w-full max-w-lg max-h-[90vh] break-words [overflow-wrap:anywhere] overflow-y-auto rounded-2xl border border-stone-200 bg-white p-5 shadow-2xl dark:border-stone-800 dark:bg-stone-900" onMouseDown={(event) => event.stopPropagation()}>
      <header className="flex items-center justify-between"><h2 className="flex gap-2 items-center text-lg font-bold font-display"><Dices className="w-5 h-5 text-amber-600" />Open a memory</h2><button onClick={onClose} className="rounded-lg p-2 text-stone-500 transition hover:bg-stone-100 dark:hover:bg-stone-800" aria-label="Close"><X className="w-5 h-5" /></button></header>
      {customizing && !isRevealing && <motion.div initial={{ opacity: 0, y: reducedMotion ? 0 : 5 }} animate={{ opacity: 1, y: 0 }} className="mt-5 space-y-4"><p className="text-sm text-stone-500">Chosen only from memories you can already access.</p><div className="flex flex-wrap gap-2">{intents.map((item) => <motion.button whileHover={reducedMotion ? undefined : { y: -1 }} whileTap={reducedMotion ? undefined : { scale: 0.97 }} key={item.key} onClick={() => setIntent(item.key)} className={`rounded-full min-h-11 px-3 py-1.5 text-xs font-semibold transition-colors ${intent === item.key ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900' : 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200'}`}>{item.label}</motion.button>)}</div><label className="block text-sm font-semibold">What are you looking for?<input value={query} maxLength={120} onChange={(event) => setQuery(event.target.value)} placeholder="Optional — a feeling, place, or idea" className="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-950" /></label><motion.button whileTap={reducedMotion ? undefined : { scale: 0.98 }} onClick={() => void reveal({intent,query})} disabled={isRevealing} className="w-full rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-700 disabled:opacity-50">Reveal a memory</motion.button><button type="button" className="min-h-11 px-3 text-sm" onClick={() => { setCustomizing(false); setError(''); }}>Cancel customization</button></motion.div>}
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      {!result && !isRevealing && !customizing && <button type="button" onClick={() => void reveal()} className="min-h-11 mt-3 rounded-xl bg-amber-600 text-white px-4">Retry</button>}
      {isRevealing && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex min-h-64 flex-col items-center justify-center text-center"><motion.div animate={reducedMotion ? undefined : { rotate: [0, -10, 10, 0], scale: [1, 1.08, 1] }} transition={{ duration: 0.7, repeat: Infinity }} className="rounded-2xl bg-amber-100 p-5 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"><Sparkles className="h-8 w-8" /></motion.div><p className="mt-4 font-semibold">Looking through your memories…</p><p className="mt-1 text-sm text-stone-500">A small moment is finding its way back.</p></motion.div>}
      <AnimatePresence mode="wait">{result && !customizing && !isRevealing && <motion.div key={revealKey} initial={{ opacity: 0, y: reducedMotion ? 0 : 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0.12 : 0.24 }} className="mt-5 space-y-4"><div className="rounded-2xl bg-amber-50 p-4 dark:bg-amber-950/25">{track && <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">{track.title}</p>}<h3 className="mt-1 text-xl font-bold font-display">{result.event.title || 'Untitled memory'}</h3><p className="mt-1 text-sm text-stone-500">{result.event.date.slice(0, 10)}</p>{emotion && <p className="mt-3 text-sm">{emotion.emoji} {emotion.label}</p>}</div>{result.event.images?.[0] && <PrivateImage src={result.event.images[0]} variant="display" fit="contain" alt={result.event.title} className="h-56 w-full rounded-xl" />}<div><p className="text-xs uppercase tracking-wide text-stone-500">A thought to return to</p><p className="mt-1 text-sm leading-relaxed">{reflectionPrompt(result.event)}</p></div>{result.fallback && <p className="text-xs text-stone-500">No exact match, so this one arrived as a surprise.</p>}<div className="flex flex-wrap gap-2"><button type="button" className="min-h-11 rounded-xl border border-stone-300 dark:border-stone-700 px-3 text-sm" onClick={() => { setIntent(applied.current.intent); setQuery(applied.current.query); setCustomizing(true); setError(''); }}>Customize</button><motion.button whileTap={reducedMotion ? undefined : { scale: 0.98 }} onClick={() => void reveal()} className="min-h-11 rounded-xl border border-stone-300 px-3 py-2 text-sm font-semibold transition hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800">Another memory</motion.button><motion.button whileTap={reducedMotion ? undefined : { scale: 0.98 }} onClick={() => onOpen(result.event)} className="min-h-11 inline-flex items-center gap-1 rounded-xl bg-stone-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900">Open in track <ExternalLink className="w-4 h-4" /></motion.button></div></motion.div>}</AnimatePresence>
    </motion.section>
  </motion.div>}</AnimatePresence>;
}
