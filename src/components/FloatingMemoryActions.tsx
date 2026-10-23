import { AnimatePresence, motion } from 'motion/react';
import { PopupPanel, useOverlayMotion } from './ModalTransition';
import { useEffect, useRef, useState } from 'react';
import { Plus, Dices } from 'lucide-react';

const ACTION_SIZE = 48;
const EDGE = 16;
const MENU_GAP = 8;

type Props = { hidden: boolean; canCreate: boolean; onCreate: () => void; onDiscover: () => void };
export function FloatingMemoryActions({ hidden, canCreate, onCreate, onDiscover }: Props) {
  const overlayMotion = useOverlayMotion();
  const [open, setOpen] = useState(false);
  const [lift, setLift] = useState(0);
  useEffect(() => {
    const position = () => {
      const toolbar = document.getElementById('filter-toolbar')?.firstElementChild?.getBoundingClientRect();
      const bottom = window.innerHeight - EDGE;
      // Keep a right-edge action without covering the filter toolbar on short screens.
      setLift(toolbar && toolbar.top < bottom && toolbar.bottom > bottom - ACTION_SIZE ? Math.min(window.innerHeight - ACTION_SIZE - EDGE * 2, Math.max(0, window.innerHeight - toolbar.top + 12 - EDGE)) : 0);
    };
    position(); window.addEventListener('scroll', position, { passive: true }); window.addEventListener('resize', position);
    return () => { window.removeEventListener('scroll', position); window.removeEventListener('resize', position); };
  }, []);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (hidden) setOpen(false); }, [hidden]);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('#memory-actions button')?.focus({ preventScroll: true });
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) { setOpen(false); trigger.current?.focus({ preventScroll: true }); } };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus({ preventScroll: true }); } };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key); };
  }, [open]);
  return <div ref={root} hidden={hidden} style={lift ? { bottom: EDGE + lift } : undefined} className="fixed z-40 right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] sm:right-6" data-floating-actions>
    <AnimatePresence>{open && <PopupPanel {...overlayMotion.panel} id="memory-actions" style={{ position: 'fixed', right: EDGE, bottom: Math.min(EDGE + ACTION_SIZE + MENU_GAP + lift, window.innerHeight - (canCreate ? 116 : 72) - 8) }} className="absolute bottom-16 right-0 w-48 rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-2 shadow-xl flex flex-col gap-1" aria-label="Memory actions">
      {canCreate && <button type="button" className="min-h-11 px-3 flex items-center gap-2 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 text-sm" onClick={() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); onCreate(); }}><Plus size={18} />New entry</button>}
      <button type="button" aria-label="Open a random memory" className="min-h-11 px-3 flex items-center gap-2 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 text-sm" onClick={() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); onDiscover(); }}><Dices size={18} />Open a memory</button>
    </PopupPanel>}</AnimatePresence>
    <button ref={trigger} id="floating-memory-actions" type="button" aria-label="Memory actions" aria-expanded={open} aria-controls="memory-actions" onClick={() => setOpen(v => !v)} className="h-12 w-12 rounded-full bg-amber-600 hover:bg-amber-700 text-white shadow-lg flex items-center justify-center focus-visible:ring-4 focus-visible:ring-amber-300"><Plus size={20} className={open ? 'rotate-45' : ''} /></button>
  </div>;
}
