import React from 'react';
import { ChevronDown } from 'lucide-react';
import { AccountOverview, EventTrack } from '../types';
import { trackIdentity } from '../lib/resourceIdentity';

interface EventTrackNavProps {
  tracks: EventTrack[];
  /**
   * Full-scope per-track counts from the server. Not the loaded list: with a
   * paginated feed the nav badge must not report only the page on screen.
   * Null while the first summary is still in flight.
   */
  overview: AccountOverview | null;
  selectedTrackKey: string; // 'all' or composite owner+track identity
  onSelectTrack: (track: EventTrack | null) => void;
  onAddNewTrack: () => void;
  onEditTrack: (track: EventTrack) => void;
  onAddNewMoment: () => void;
  onShareTrack: (track: EventTrack) => void;
  canEditSelectedTrack: boolean;
}

export const EventTrackNav: React.FC<EventTrackNavProps> = ({tracks, overview, selectedTrackKey, onSelectTrack, onAddNewTrack, onEditTrack, onShareTrack}) => {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const active = tracks.find(t => trackIdentity(t) === selectedTrackKey);
  const stats = overview?.tracks.find(r => `${r.trackOwnerId}:${r.trackId}` === selectedTrackKey);
  const root = React.useRef<HTMLDivElement>(null);
  const trigger = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (!open) return;
    root.current?.querySelector('input')?.focus();
    const close = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if(e.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown',close); document.addEventListener('keydown',key);
    return () => { document.removeEventListener('pointerdown',close); document.removeEventListener('keydown',key); };
  },[open]);
  const groups = [ ['Own', tracks.filter(t => t.accessRole === 'owner' && !t.sharedByYou)], ['Shared by you', tracks.filter(t => t.accessRole === 'owner' && t.sharedByYou)], ['Shared with you', tracks.filter(t => t.accessRole !== 'owner')] ] as const;
  const select = (t: EventTrack | null) => { onSelectTrack(t); setOpen(false); trigger.current?.focus(); };
  return <div ref={root} className="journal-track-nav">
    <button ref={trigger} id="track-picker-trigger" className="journal-control" aria-expanded={open} aria-controls="track-picker" onClick={() => setOpen(v => !v)}><span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{active?.title || 'All tracks'}</span><ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0" /></button>
    {open && <section id="track-picker" aria-label="Choose track" className="journal-track-picker">
      <label htmlFor="track-nav-search">Find a track</label>
      <input id="track-nav-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search tracks…" />
      <button id="tab-all-events-merged" aria-pressed={!active} onClick={() => select(null)}>All memories <span>{overview?.total ?? '—'}</span></button>
      {groups.map(([label,items]) => <section key={label}><h3>{label} · {items.length}</h3>{items.filter(t => t.title.toLowerCase().includes(query.toLowerCase())).map(t => <button key={trackIdentity(t)} aria-pressed={trackIdentity(t) === selectedTrackKey} onClick={() => select(t)}><span title={t.title}>{t.title}</span><span>{overview?.tracks.find(r => `${r.trackOwnerId}:${r.trackId}` === trackIdentity(t))?.count ?? (overview ? 0 : '—')}</span></button>)}</section>)}
      <button id="btn-add-event-track" onClick={() => { setOpen(false); onAddNewTrack(); }}>+ New track</button>
    </section>}
    {active && <div className="journal-track-context"><span>{active.accessRole === 'owner' ? active.sharedByYou ? 'Shared by you' : 'Only you' : `Shared with you · ${active.accessRole}`}</span>{active.description && <p>{active.description}</p>}<details><summary>Track info</summary><p>{active.description || 'No description'}</p><p>Status: {active.status || 'active'}</p>{!overview ? <p role="status">Loading track information…</p> : <><p>{stats?.count ?? 0} memories · {stats?.photos ?? 0} photos · {stats?.milestones ?? 0} milestones</p><p>{stats?.minDate || stats?.maxDate ? `${stats.minDate || 'Undated'} — ${stats.maxDate || 'Undated'}` : 'No dated memories yet'}</p></>}</details>{active.accessRole === 'owner' && <><button className="journal-control" onClick={() => onEditTrack(active)}>Edit track</button><button className="journal-control" onClick={() => onShareTrack(active)}>Share</button></>}</div>}
  </div>;
};
