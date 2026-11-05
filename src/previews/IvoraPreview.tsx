import {useRef, useState, useEffect} from 'react';
import './ivora-preview.css';

const memories = [
  {id: 'coast', track: 'Wander', date: 'June 14, 2026', title: 'The long way home', caption: 'We missed the turn. Found the sea. Stayed until the light turned everything to honey.', note: 'No itinerary, no hurry. Just a winding path through the dunes and the kind of quiet you wish you could bring home in a jar.', place: 'Somewhere by the coast', art: true},
  {id: 'sunday', track: 'Little joys', date: 'June 08, 2026', title: 'A very ordinary Sunday', caption: 'Coffee cooling on the table. A book left open. Nothing special — which was the special part.', note: 'The rain kept us inside all afternoon. We made a second pot and let the day unfold slowly.', place: 'At home', art: false},
  {id: 'garden', track: 'Together', date: 'May 25, 2026', title: 'Room for one more', caption: 'A small table, too many strawberries, and all our favourite people.', note: 'Someone brought flowers from the garden. Someone forgot the spoons. Nobody minded.', place: 'The garden table', art: false},
];
type Memory = typeof memories[number];
export default function IvoraPreview() {
  const [track, setTrack] = useState('All memories');
  const [query, setQuery] = useState('');
  const [dark, setDark] = useState(false);
  const [likes, setLikes] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Memory | null>(null);
  const [closing, setClosing] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  function open(memory: Memory, source: HTMLElement) {
    opener.current = source; setSelected(memory); setClosing(false);
    dialog.current?.showModal();
  }
  function close() {
    if (closing) return;
    setClosing(true);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    timer.current = setTimeout(() => {
      dialog.current?.close(); setClosing(false);
      opener.current?.focus({preventScroll: true});
    }, reduced ? 0 : 180);
  }
  function reaction(id: string) { setLikes(previous => ({...previous, [id]: !previous[id]})); }
  const visible = memories.filter(m => (track === 'All memories' || m.track === track) && `${m.title} ${m.caption} ${m.track}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="ivora" data-theme={dark ? 'dark' : 'light'}>
    <div className="ivora-notice"><span>DESIGN PREVIEW · Fictional memories, local interactions only</span><a href="/">Return to Memento ↗</a></div>
    <div className="ivora-shell">
      <header className="ivora-header"><a className="ivora-brand" href="?uiPreview=ivora" aria-label="Memento preview home"><span className="ivora-mark">m.</span> memento<span className="ivora-brand-dot">✳</span></a><div className="ivora-header-actions"><span className="ivora-private">A little space for what matters</span><button aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setDark(!dark)}>{dark ? '☀ Light' : '☾ Dark'}</button></div></header>
      <main>
        <section className="ivora-intro"><div><p className="ivora-eyebrow">YOUR LIFE, IN LITTLE CHAPTERS</p><h1>Some days deserve<br/>a little <em>longer.</em></h1><p className="ivora-lede">Not the whole story. Just the moments<br className="ivora-desktop-break"/> you never want to lose.</p></div><aside className="ivora-note"><span aria-hidden="true">✳</span><p>The big things.<br/>The little things.<br/><em>All the in-between.</em></p><small>A collection of made-up moments</small></aside></section>
        <section className="ivora-collection" aria-label="Memory collection">
          <div className="ivora-collection-heading"><h2>A few things to keep <span>03</span></h2><p>Collected slowly. Kept close.</p></div>
          <div className="ivora-toolbar"><div className="ivora-filters" aria-label="Filter by track">{['All memories', 'Wander', 'Little joys', 'Together'].map(t => <button key={t} aria-pressed={track === t} onClick={() => setTrack(t)}>{t}</button>)}</div><label className="ivora-search"><span aria-hidden="true">⌕</span><input aria-label="Search fictional memories" placeholder="Find a little moment…" value={query} onChange={e => setQuery(e.target.value)}/></label></div>
          <p className="ivora-sr" role="status">{visible.length} memories shown</p>
          <div className="ivora-grid">{visible.map((m, i) => <article className={`ivora-card ${m.art ? 'ivora-feature' : ''}`} key={m.id}>
            <button className={`ivora-art ivora-art-${m.id}`} aria-label={`Open ${m.title}`} onClick={e => open(m, e.currentTarget)}>{m.art ? <img src="/previews/memento-ivora.svg" alt="Original illustration of a sunlit coastal path and sea"/> : <div className="ivora-paper-art" aria-hidden="true">{m.id === 'sunday' ? <><span className="ivora-cup">☕</span><span className="ivora-art-script">a slow kind<br/>of Sunday.</span></> : <><span className="ivora-flower">✳</span><span className="ivora-art-script">better<br/>together.</span></>}</div>}<span className="ivora-photo-label">{m.art ? 'Original illustration' : 'Fictional story'}</span><span className="ivora-open" aria-hidden="true">↗</span></button>
            <div className="ivora-card-body"><div className="ivora-meta"><span className={`ivora-tag ivora-tag-${i}`}>{m.track}</span><time>{m.date}</time></div><h3><button onClick={e => open(m, e.currentTarget)}>{m.title}</button></h3><p>{m.caption}</p><div className="ivora-card-footer"><span>{m.place}</span><button className="ivora-reaction" aria-label={`Love ${m.title}`} aria-pressed={!!likes[m.id]} onClick={() => reaction(m.id)}>{likes[m.id] ? '♥' : '♡'} <span>{likes[m.id] ? 1 : 0}</span></button></div></div>
          </article>)}</div>
          {visible.length === 0 && <div className="ivora-empty"><h3>No moments found, yet.</h3><p>Try another word, or start fresh.</p><button onClick={() => {setQuery(''); setTrack('All memories');}}>Clear filters</button></div>}
        </section>
        <footer className="ivora-footer"><span>Made of moments, not milestones.</span><span>✳ &nbsp; A fictional Memento design study</span></footer>
      </main>
    </div>
    <dialog ref={dialog} onKeyDown={e => {
      if (e.key !== 'Tab') return;
      const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (e.shiftKey && document.activeElement === first) {e.preventDefault(); last?.focus();}
      else if (!e.shiftKey && document.activeElement === last) {e.preventDefault(); first?.focus();}
    }} className="ivora-dialog" data-closing={closing} aria-labelledby="ivora-detail-title" onCancel={e => {e.preventDefault(); close();}} onClick={e => {if (e.target === e.currentTarget) {const r=e.currentTarget.getBoundingClientRect(); if(e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();}}}>
      {selected && <div className="ivora-detail"><div className="ivora-detail-top"><span>FICTIONAL MEMORY · {selected.track}</span><button autoFocus aria-label="Close memory" onClick={close}>×</button></div>{selected.art && <img className="ivora-detail-image" src="/previews/memento-ivora.svg" alt="Original coastal landscape illustration"/>}<div className="ivora-detail-copy"><p className="ivora-eyebrow">{selected.date} · {selected.place}</p><h2 id="ivora-detail-title">{selected.title}</h2><p>{selected.caption}</p><p>{selected.note}</p><button className="ivora-reaction" aria-label={`Love ${selected.title}`} aria-pressed={!!likes[selected.id]} onClick={() => reaction(selected.id)}>{likes[selected.id] ? '♥' : '♡'} {likes[selected.id] ? 1 : 0} · Keep a little love</button><p className="ivora-demo-caption">Demo only. Nothing here is saved.</p></div></div>}
    </dialog>
  </div>;
}
