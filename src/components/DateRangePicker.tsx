import { motion } from 'motion/react';
import { ModalTransition, useOverlayMotion } from './ModalTransition';
import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import { validateDateRange } from '../lib/momentFilters';
import { useModalLifecycle } from '../lib/useModalLifecycle';

type Props = { dateFrom: string; dateTo: string; onChange: (range: { dateFrom: string; dateTo: string }) => void };
const button = 'min-h-11 rounded-xl px-3 text-sm hover:bg-stone-100 dark:hover:bg-stone-800';
export function DateRangePicker(props: Props) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <><button type="button" ref={trigger} id="date-range-trigger" aria-haspopup="dialog" aria-expanded={open} aria-pressed={Boolean(open || props.dateFrom || props.dateTo)} onClick={() => setOpen(true)} className={`px-3 py-1 min-h-11 rounded-full text-xs font-medium transition flex items-center gap-1 shrink-0 ${open || props.dateFrom || props.dateTo ? 'bg-amber-500 text-white shadow-xs' : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200'}`}><CalendarRange size={12} />{props.dateFrom || props.dateTo ? `Date range: ${props.dateFrom || 'Any time'} → ${props.dateTo || 'Any time'}` : 'Date range'}</button>{createPortal(<ModalTransition>{open && <DateRangeEditor {...props} anchor={trigger} onClose={() => setOpen(false)} />}</ModalTransition>, document.body)}</>;
}
function DateRangeEditor({ dateFrom, dateTo, onChange, onClose, anchor }: Props & { onClose: () => void; anchor: RefObject<HTMLButtonElement | null> }) {
  const overlayMotion = useOverlayMotion();
  const [from, setFrom] = useState(dateFrom);
  const [to, setTo] = useState(dateTo);
  const [bound, setBound] = useState<'from' | 'to'>('from');
  const today = new Date();
  const seed = /^\d{4}-\d{2}-\d{2}$/.test(dateFrom) ? dateFrom : `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-01`;
  const [year, setYear] = useState(Number(seed.slice(0,4)));
  const [month, setMonth] = useState(Number(seed.slice(5,7))-1);
  const modal = useModalLifecycle(true, onClose);
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number; desktop: boolean } | null>(null);
  useLayoutEffect(() => {
    const panel = modal.current;
    const trigger = anchor.current;
    if (!panel || !trigger) return;
    let frame = 0;
    const place = () => {
      const desktop = window.matchMedia('(min-width: 640px)').matches;
      const viewport = window.visualViewport;
      const leftEdge = (viewport?.offsetLeft || 0) + 8;
      const topEdge = (viewport?.offsetTop || 0) + 8;
      const width = Math.min(384, (viewport?.width || innerWidth) - 16);
      const bottomEdge = topEdge + (viewport?.height || innerHeight) - 16;
      const rect = trigger.getBoundingClientRect();
      // Measure unconstrained content, not the current scroll box (which may
      // retain a landscape max-height while resizing back to portrait).
      const naturalHeight = (panel.firstElementChild as HTMLElement).offsetHeight + 18;
      const below = Math.max(0, bottomEdge - rect.bottom - 8);
      const above = Math.max(0, rect.top - 8 - topEdge);
      const flip = desktop && below < naturalHeight && above > below;
      // Prefer a fitting anchored side; if neither fits, clamp the whole panel
      // into the viewport instead of clipping weeks to the smaller side.
      const maxHeight = bottomEdge - topEdge;
      const height = Math.min(naturalHeight, maxHeight);
      const next = {
        desktop, width, maxHeight,
        left: desktop ? Math.max(leftEdge, Math.min(rect.left, leftEdge + (viewport?.width || innerWidth) - 16 - width)) : leftEdge + ((viewport?.width || innerWidth) - 16 - width) / 2,
        top: desktop ? Math.max(topEdge, Math.min(flip ? rect.top - 8 - height : rect.bottom + 8, bottomEdge - height)) : bottomEdge - height,
      };
      setPosition(old => old && Object.keys(next).every(key => old[key as keyof typeof old] === next[key as keyof typeof next]) ? old : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
    place();
    const observer = new ResizeObserver(schedule);
    observer.observe(panel); observer.observe(trigger);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [anchor, modal]);
  useLayoutEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !modal.current?.contains(event.target) && !anchor.current?.contains(event.target)) {
        event.preventDefault(); // Keep pointer default focus from overriding lifecycle restoration.
        onClose();
      }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [anchor, modal, onClose]);
  const error = validateDateRange(from, to);
  const days = new Date(year, month+1, 0).getDate();
  const offset = new Date(year, month, 1).getDay();
  const literal = (day: number) => `${String(year).padStart(4,'0')}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const move = (delta: number) => { const next = new Date(year, month+delta, 1); if (next.getFullYear() < 100 || next.getFullYear() > 9999) return; setYear(next.getFullYear()); setMonth(next.getMonth()); };
  const choose = (day: number) => { if (bound === 'from') { setFrom(literal(day)); setBound('to'); } else setTo(literal(day)); };
  return <>
    <motion.div {...overlayMotion.backdrop} aria-hidden="true" className="fixed inset-0 z-[69] bg-stone-950/50 sm:hidden" />
    <motion.div {...overlayMotion.panel} ref={modal} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Date range editor" data-date-presentation={position?.desktop ? 'popover' : 'sheet'}
      style={position ? { left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight } : { visibility: 'hidden' }}
      className="fixed z-[70] overflow-y-auto rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-100 p-2 shadow-xl">
      <div data-date-content>
      <div className="flex items-center gap-0 justify-between">
        <h2 id="date-range-title" className="font-semibold text-sm whitespace-nowrap mr-auto">Date range</h2>
        <button type="button" className="min-h-11 w-9 shrink-0 flex items-center justify-center rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800" aria-label="Previous month" onClick={() => move(-1)}><ChevronLeft size={16} /></button>
        <select aria-label="Calendar month" value={month} onChange={e => setMonth(Number(e.target.value))} className="min-h-11 bg-stone-100 dark:bg-stone-800 rounded-lg text-sm min-w-0">{Array.from({ length:12 }, (_,m) => <option key={m} value={m}>{new Date(2024,m,1).toLocaleString('en',{month:'short'})}</option>)}</select>
        <input aria-label="Calendar year" type="number" min={100} max={9999} value={year} onChange={e => { const value=Number(e.target.value); if(value>=100 && value<=9999) setYear(value); }} className="w-[4.5rem] min-h-11 bg-stone-100 dark:bg-stone-800 rounded-lg px-2 text-sm" />
        <button type="button" className="min-h-11 w-9 shrink-0 flex items-center justify-center rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800" aria-label="Next month" onClick={() => move(1)}><ChevronRight size={16} /></button>
      </div>
      <div className="grid grid-cols-2 gap-2 my-1">{(['from','to'] as const).map(key => <label key={key} className="text-xs font-semibold min-w-0">{key === 'from' ? 'From' : 'To'}<input id={`filter-date-${key}`} type="text" inputMode="numeric" placeholder="YYYY-MM-DD" aria-describedby={error ? 'date-draft-error' : undefined} value={key === 'from' ? from : to} onFocus={() => setBound(key)} onClick={() => setBound(key)} onChange={e => key === 'from' ? setFrom(e.target.value) : setTo(e.target.value)} className={`mt-1 w-full min-w-0 rounded-xl border bg-stone-50 dark:bg-stone-800 px-2 py-1 min-h-10 ${bound === key ? 'border-amber-600 ring-1 ring-amber-600' : 'border-stone-300 dark:border-stone-600'}`} /></label>)}</div>
      <div className="grid grid-cols-7 text-center text-xs" style={{ gridTemplateRows: '24px repeat(6, 44px)' }} aria-label="Calendar days">
        {['Su','Mo','Tu','We','Th','Fr','Sa'].map(day => <span key={day} className="py-1 text-stone-500">{day}</span>)}
        {Array.from({length:offset},(_,i) => <span key={`empty-${i}`} />)}
        {Array.from({length:days},(_,i) => { const day=i+1, date=literal(day), selected=date===from || date===to; return <button key={day} type="button" aria-label={date} aria-pressed={selected} onClick={() => choose(day)} onKeyDown={e => { const delta = ({ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7} as Record<string,number>)[e.key]; if(delta){e.preventDefault(); const target=day+delta; if(target>=1 && target<=days) (e.currentTarget.parentElement?.querySelector(`button[aria-label="${literal(target)}"]`) as HTMLButtonElement)?.focus();} }} className={`min-h-11 rounded-lg ${selected ? 'bg-amber-600 text-white' : from && to && date>from && date<to ? 'bg-amber-100 dark:bg-amber-950' : 'hover:bg-stone-100 dark:hover:bg-stone-800'}`}>{day}</button>; })}
        {Array.from({length:42-offset-days},(_,i) => <span key={`trailing-${i}`} />)}
      </div>
      {error && <p role="alert" id="date-draft-error" className="text-xs text-rose-700 dark:text-rose-300 my-2">{error}</p>}
      <div className="flex flex-wrap gap-1 mt-1 border-t border-stone-200 dark:border-stone-700 pt-1">
        <button type="button" aria-label="Clear date filter" className={`${button} mr-auto`} onClick={() => { if(dateFrom || dateTo) onChange({dateFrom:'',dateTo:''}); onClose(); }}>Clear</button>
        <button type="button" className={button} onClick={onClose}>Cancel</button>
        <button type="button" disabled={!!error} className={`${button} bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50`} onClick={() => { if(from!==dateFrom || to!==dateTo) onChange({dateFrom:from,dateTo:to}); onClose(); }}>Apply</button>
      </div>
      </div>
    </motion.div>
  </>;
}
