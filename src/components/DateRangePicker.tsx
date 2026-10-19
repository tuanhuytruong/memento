import { useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import { validateDateRange } from '../lib/momentFilters';
import { useModalLifecycle } from '../lib/useModalLifecycle';

type Props = { dateFrom: string; dateTo: string; onChange: (range: { dateFrom: string; dateTo: string }) => void };
const button = 'min-h-11 rounded-xl px-3 text-sm hover:bg-stone-100 dark:hover:bg-stone-800';
export function DateRangePicker(props: Props) {
  const [open, setOpen] = useState(false);
  return <><button type="button" id="date-range-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} className={`${button} flex items-center gap-2 border border-stone-200 dark:border-stone-700`}><CalendarRange size={16} />{props.dateFrom || props.dateTo ? `Date range: ${props.dateFrom || 'Any time'} → ${props.dateTo || 'Any time'}` : 'Date range'}</button>{open && createPortal(<DateRangeEditor {...props} onClose={() => setOpen(false)} />, document.body)}</>;
}
function DateRangeEditor({ dateFrom, dateTo, onChange, onClose }: Props & { onClose: () => void }) {
  const [from, setFrom] = useState(dateFrom);
  const [to, setTo] = useState(dateTo);
  const [bound, setBound] = useState<'from' | 'to'>('from');
  const today = new Date();
  const seed = /^\d{4}-\d{2}-\d{2}$/.test(dateFrom) ? dateFrom : `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-01`;
  const [year, setYear] = useState(Number(seed.slice(0,4)));
  const [month, setMonth] = useState(Number(seed.slice(5,7))-1);
  const modal = useModalLifecycle(true, onClose);
  const error = validateDateRange(from, to);
  const days = new Date(year, month+1, 0).getDate();
  const offset = new Date(year, month, 1).getDay();
  const literal = (day: number) => `${String(year).padStart(4,'0')}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const move = (delta: number) => { const next = new Date(year, month+delta, 1); if (next.getFullYear() < 100 || next.getFullYear() > 9999) return; setYear(next.getFullYear()); setMonth(next.getMonth()); };
  const choose = (day: number) => { if (bound === 'from') { setFrom(literal(day)); setBound('to'); } else setTo(literal(day)); };
  return <div ref={modal} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Date range editor" onMouseDown={onClose} className="fixed inset-0 z-[70] bg-stone-950/50 flex items-end sm:items-center justify-center p-2 sm:p-4">
    <section onMouseDown={e => e.stopPropagation()} className="w-full max-w-sm max-h-[95dvh] overflow-y-auto rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-100 p-4 shadow-xl">
      <h2 id="date-range-title" className="font-semibold text-lg">Date range</h2>
      <div className="grid grid-cols-2 gap-2 my-3">{(['from','to'] as const).map(key => <label key={key} className="text-xs font-semibold min-w-0">{key === 'from' ? 'From' : 'To'}<input id={`filter-date-${key}`} type="text" inputMode="numeric" placeholder="YYYY-MM-DD" aria-describedby={error ? 'date-draft-error' : undefined} value={key === 'from' ? from : to} onFocus={() => setBound(key)} onChange={e => key === 'from' ? setFrom(e.target.value) : setTo(e.target.value)} className={`mt-1 w-full min-w-0 rounded-xl border bg-stone-50 dark:bg-stone-800 p-2 min-h-11 ${bound === key ? 'border-amber-600' : 'border-stone-300 dark:border-stone-600'}`} /></label>)}</div>
      <div className="flex gap-2 mb-2">{(['from','to'] as const).map(key => <button key={key} type="button" aria-pressed={bound===key} onClick={() => setBound(key)} className={`${button} ${bound===key ? 'bg-amber-100 dark:bg-amber-950' : ''}`}>Choose {key==='from' ? 'From' : 'To'}</button>)}</div>
      <div className="flex items-center gap-1 justify-between mb-2">
        <button type="button" className={button} aria-label="Previous month" onClick={() => move(-1)}><ChevronLeft size={16} /></button>
        <select aria-label="Calendar month" value={month} onChange={e => setMonth(Number(e.target.value))} className="min-h-11 bg-stone-100 dark:bg-stone-800 rounded-lg text-sm min-w-0">{Array.from({ length:12 }, (_,m) => <option key={m} value={m}>{new Date(2024,m,1).toLocaleString('en',{month:'short'})}</option>)}</select>
        <input aria-label="Calendar year" type="number" min={100} max={9999} value={year} onChange={e => { const value=Number(e.target.value); if(value>=100 && value<=9999) setYear(value); }} className="w-20 min-h-11 bg-stone-100 dark:bg-stone-800 rounded-lg px-2 text-sm" />
        <button type="button" className={button} aria-label="Next month" onClick={() => move(1)}><ChevronRight size={16} /></button>
      </div>
      <div className="grid grid-cols-7 text-center text-xs" aria-label="Calendar days">
        {['Su','Mo','Tu','We','Th','Fr','Sa'].map(day => <span key={day} className="py-2 text-stone-500">{day}</span>)}
        {Array.from({length:offset},(_,i) => <span key={`empty-${i}`} />)}
        {Array.from({length:days},(_,i) => { const day=i+1, date=literal(day), selected=date===from || date===to; return <button key={day} type="button" aria-label={date} aria-pressed={selected} onClick={() => choose(day)} onKeyDown={e => { const delta = ({ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7} as Record<string,number>)[e.key]; if(delta){e.preventDefault(); const target=day+delta; if(target>=1 && target<=days) (e.currentTarget.parentElement?.querySelector(`button[aria-label="${literal(target)}"]`) as HTMLButtonElement)?.focus();} }} className={`min-h-11 rounded-lg ${selected ? 'bg-amber-600 text-white' : from && to && date>from && date<to ? 'bg-amber-100 dark:bg-amber-950' : 'hover:bg-stone-100 dark:hover:bg-stone-800'}`}>{day}</button>; })}
      </div>
      {error && <p role="alert" id="date-draft-error" className="text-xs text-rose-700 dark:text-rose-300 my-2">{error}</p>}
      <div className="flex flex-wrap gap-1 mt-3 border-t border-stone-200 dark:border-stone-700 pt-2">
        <button type="button" className={`${button} mr-auto`} onClick={() => { if(dateFrom || dateTo) onChange({dateFrom:'',dateTo:''}); onClose(); }}>Clear date filter</button>
        <button type="button" className={button} onClick={onClose}>Cancel</button>
        <button type="button" disabled={!!error} className={`${button} bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50`} onClick={() => { if(from!==dateFrom || to!==dateTo) onChange({dateFrom:from,dateTo:to}); onClose(); }}>Apply</button>
      </div>
    </section>
  </div>;
}
