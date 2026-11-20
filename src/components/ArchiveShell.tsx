import { useState, type ReactNode } from 'react';
import { Bell, BookOpen, Clock, Compass, Dices, Download, FolderKanban, Image, Layers, LogOut, Mail, PanelLeftClose, PanelLeftOpen, Plus, Search, Share2, SlidersHorizontal, Sparkles, Users, X } from 'lucide-react';
import { getEventIconComponent } from '../data/eventThemes';
import { trackIdentity } from '../lib/resourceIdentity';
import { useModalLifecycle } from '../lib/useModalLifecycle';
import type { AccountOverview, EventTrack, ViewMode } from '../types';
import '../archival-shell.css';

export type WorkspaceSection = 'archive' | 'atlas' | 'stories' | 'letters' | 'postcards';
export function ArchiveViews({mode, onChange, mobile = false}: {mode: ViewMode; onChange: (mode: ViewMode) => void; mobile?: boolean}) {
  return <div className={`archival-view-tabs ${mobile ? 'archival-views-mobile' : ''}`} role="group" aria-label="Archive view mode">
    {([['timeline','Timeline'],['gallery','Gallery'],['compact','List']] as const).map(([id,label]) => <button key={id} type="button" aria-pressed={mode === id} onClick={() => onChange(id)}>{label}</button>)}
  </div>;
}
interface ArchiveShellProps {
  section: WorkspaceSection;
  onSection: (section: WorkspaceSection) => boolean;
  viewMode: ViewMode;
  onViewMode: (view: ViewMode) => void;
  onBrowse?: () => void;
  discovery: ReactNode;
  onNewTrack: () => void;
  onEditTrack: (track: EventTrack) => void;
  onShareTrack: (track: EventTrack) => void;
  children: ReactNode;
  tracks: EventTrack[];
  overview: AccountOverview | null;
  activeTrack: EventTrack | null;
  username: string;
  readyLetterCount: number;
  onSelectTrack: (track: EventTrack | null) => boolean;
  onCreateMemory?: () => void;
  onOpenBlindbox: () => void;
  onExportBackup: () => Promise<void>;
  onLogout: () => void;
}

export function ArchiveShell({ children, tracks, overview, activeTrack, username, readyLetterCount,
  onSelectTrack, onCreateMemory, onOpenBlindbox, onExportBackup, onLogout, section, onSection, viewMode, onViewMode, onBrowse, discovery, onNewTrack, onEditTrack, onShareTrack }: ArchiveShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [scope, setScope] = useState('All');
  const [query, setQuery] = useState('');
  const [panel, setPanel] = useState<'tracks' | 'desk' | 'discovery' | null>(null);
  const close = () => setPanel(null);
  const panelRef = useModalLifecycle(panel !== null, close);
  const select = (track: EventTrack | null) => { if (onSelectTrack(track)) close(); };
  const go = (id: WorkspaceSection) => { if (onSection(id)) close(); };
  const destinations = [
    { label: 'Archive', Icon: Clock, action: () => go('archive'), active: section === 'archive', meta: overview?.total },
    { label: 'Atlas', Icon: Compass, action: () => go('atlas'), active: section === 'atlas', meta: 'Mood · Place' },
    { label: 'Stories', Icon: BookOpen, action: () => go('stories'), active: section === 'stories', id: 'open-stories' },
    { label: 'Future Letters', Icon: Mail, action: () => go('letters'), active: section === 'letters', id: 'open-future-letters', count: readyLetterCount, meta: readyLetterCount ? `${readyLetterCount} ready` : undefined },
    { label: 'Postcards', Icon: Image, action: () => go('postcards'), active: section === 'postcards', id: 'create-postcard' },
  ];
  const dock = [destinations[0], { label: 'Tracks', count: 0, Icon: Layers, action: () => setPanel('tracks'), active: panel === 'tracks' }, destinations[2], {...destinations[3], label: 'Letters'}, {label:'Desk', count: 0, Icon: Sparkles, action: () => setPanel('desk'), active: panel === 'desk' || section === 'atlas' || section === 'postcards'}];
  const title = section === 'postcards' ? 'Postcard Press' : destinations.find(item => item.active)?.label;
  const visibleTracks = tracks.filter(track => {
    const personal = track.accessRole === 'owner' && !track.sharedByYou;
    return (scope === 'All' || personal === (scope === 'Personal')) && `${track.title} ${track.description}`.toLowerCase().includes(query.trim().toLowerCase());
  });
  const counts = new Map(overview?.tracks.map(row => [`${row.trackOwnerId}:${row.trackId}`, row.count]));

  const directory = (expanded: boolean) => (
        <nav className="archival-directory" aria-label="Track shortcuts">
          {expanded && <><div className="archival-directory-title"><span>Tracks</span><button type="button" onClick={() => { close(); onNewTrack(); }}><Plus size={14} />New track</button></div>
          <div className="archival-scope" role="group" aria-label="Track scope">{['All','Personal','Shared'].map(label => <button key={label} type="button" aria-pressed={scope === label} onClick={() => setScope(label)}>{label}</button>)}</div>
          {tracks.length > 4 && <label className="archival-track-search"><Search size={14} /><input aria-label="Search tracks" placeholder="Find a track…" value={query} onChange={e => setQuery(e.target.value)} /></label>}</>}
          <button type="button" className="archival-rail-item" aria-label="All memories" title="All memories" aria-pressed={section === 'archive' && !activeTrack} onClick={() => select(null)}><Layers />{expanded && <><span>All memories</span>{overview && <small>{overview.total}</small>}</>}</button>
          {(expanded ? visibleTracks : tracks).map(track => {
            const key = trackIdentity(track);
            const Icon = getEventIconComponent(track.icon);
            return <div key={key} className="archival-track-row"><button type="button" className="archival-rail-item" title={track.title} aria-pressed={section === 'archive' && !!activeTrack && trackIdentity(activeTrack) === key} onClick={() => select(track)}><Icon />{expanded && <><span title={track.title}>{track.title}</span>{(track.sharedByYou || track.accessRole !== 'owner') && <Users className="archival-track-shared" aria-label="Shared track" />}{overview && <small>{counts.get(key) ?? 0}</small>}</>}</button>{expanded && track.accessRole === 'owner' && <div className="archival-track-actions"><button aria-label={`Share ${track.title}`} onClick={() => { close(); onShareTrack(track); }}><Share2 size={14} /></button><button aria-label={`Edit ${track.title}`} onClick={() => { close(); onEditTrack(track); }}><SlidersHorizontal size={14} /></button></div>}</div>;
          })}
          {expanded && !visibleTracks.length && <p className="px-2.5 py-4 text-xs">No tracks match your filter.</p>}
          {collapsed && <button className="archival-rail-item" title="Create new track" aria-label="Create new track" onClick={() => { close(); onNewTrack(); }}><Plus /></button>}
        </nav>
  );

  return (
    <div className="archival-shell">
      <aside className="archival-rail" data-collapsed={collapsed} aria-label="Archive sidebar">
        <div className="archival-brand-row">
          {!collapsed && <button type="button" className="archival-brand" onClick={() => select(null)}>Memento</button>}
          <button type="button" className="archival-icon-button" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} aria-controls="archival-track-directory" onClick={() => setCollapsed(value => !value)}>
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
        </div>
        <nav className="archival-primary" aria-label="Workspace navigation">
          {destinations.map(({ label, Icon, action, active, id, count, meta }) => (
            <button key={label} id={id} type="button" className="archival-rail-item" aria-label={count ? `${label}, ${count} ready` : label} aria-current={active ? 'page' : undefined} title={collapsed ? label : undefined} onClick={action}>
              <Icon />{!collapsed && <><span>{label}</span>{meta !== undefined && <small className={count ? "archival-wax" : undefined}>{meta}</small>}</>}
            </button>
          ))}
          <button type="button" className="archival-rail-item" aria-label="Blindbox" title={collapsed ? 'Blindbox' : undefined} onClick={onOpenBlindbox}><Dices className="archival-wax" />{!collapsed && <><span>Blindbox</span><small>Surprise</small></>}</button>
        </nav>
        {directory(!collapsed)}
        <footer className="archival-rail-footer">
          {!collapsed && overview && <div className="archival-rail-metrics"><span>{overview.milestones} milestones</span> · <span>{overview.places} places</span> · <span>{overview.photos} photos</span></div>}
          <button className="archival-rail-item" aria-label="Export backup (JSON)" title="Export backup" onClick={() => void onExportBackup()}><Download />{!collapsed && <span>Export archive backup</span>}</button>
          <div data-account-menu><button className="archival-rail-item" aria-label={`Account: ${username}`} aria-haspopup="dialog" title={username} onClick={() => setPanel('desk')}><Users />{!collapsed && <span>{username}</span>}</button></div>
        </footer>
      </aside>
      <div className="archival-body">
        <header className="archival-topbar">
          <button type="button" className="archival-mobile-tracks archival-icon-button" aria-label="Open tracks drawer" onClick={() => setPanel('tracks')}><FolderKanban /></button>
          <div className="archival-breadcrumb"><button type="button" onClick={() => select(null)}>{title}</button>{section === 'archive' && activeTrack && <><span aria-hidden="true">/</span><strong title={activeTrack.title}>{activeTrack.title}</strong></>}</div>
          <span className="archival-mobile-title" title={title}>{section === 'archive' ? activeTrack?.title ?? 'Memento' : section === 'postcards' ? 'Postcards' : title}</span>
          <div className="archival-top-center">
            {section === 'archive' && <ArchiveViews mode={viewMode} onChange={onViewMode} />}
            <button className="archival-control" onClick={() => setPanel('discovery')}><Bell size={14} />On this day</button>
            {onBrowse && <button className="archival-control" onClick={onBrowse}><Search size={14} />Quick jump</button>}
          </div>
          <div className="archival-top-actions">
            <button className="archival-mobile-discovery archival-icon-button" aria-label="On this day" onClick={() => setPanel('discovery')}><Bell /></button>
            {onCreateMemory && <button id="open-create-event-modal" type="button" className="archival-primary-button archival-new-memory" onClick={onCreateMemory} aria-label="New memory"><Plus size={16} /><span>New memory</span></button>}
          </div>
        </header>
        {children}
      </div>
      <nav className="archival-mobile-nav" aria-label="Mobile navigation">
        <div>
          {dock.map(({ label, Icon, action, active, count }) => (
            <button key={label} type="button" aria-label={count ? `${label}, ${count} ready` : label} aria-current={active ? 'page' : undefined} onClick={action}><Icon /><span>{label}</span>{!!count && <small>{count}</small>}</button>
          ))}
        </div>
      </nav>
      {panel && <div className="archival-sheet-backdrop" onPointerDown={event => { if (event.currentTarget === event.target) { event.preventDefault(); close(); } }}>
        <div ref={panelRef} className="archival-sheet" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="archival-sheet-title">
          <div className="archival-sheet-grabber" /><div className="archival-sheet-title"><h2 id="archival-sheet-title">{panel === 'tracks' ? 'Memory Tracks' : panel === 'desk' ? 'Archival Desk' : 'On this day'}</h2><button type="button" className="archival-icon-button" onClick={close} aria-label={`Close ${panel}`}><X /></button></div>
          {panel === 'tracks' ? directory(true) : panel === 'discovery' ? <div className="archival-desk" onClick={event => { if ((event.target as Element).closest('button') && !(event.target as Element).closest('[data-keep-sheet]')) close(); }}>{discovery}</div> : <div className="archival-desk">
            <button className="archival-rail-item" onClick={() => go('atlas')}><Compass /><span>Atlas</span></button>
            <button className="archival-rail-item" onClick={() => go('postcards')}><Image /><span>Postcards</span></button>
            <button className="archival-rail-item" onClick={() => setPanel('discovery')}><Bell /><span>On this day</span></button>
            {onBrowse && <button className="archival-rail-item" onClick={() => { close(); onBrowse(); }}><Search /><span>Quick jump</span></button>}
            <button type="button" className="archival-rail-item" onClick={() => { close(); onOpenBlindbox(); }}><Dices /><span>Blindbox</span></button>
            <button type="button" id="export-timeline-json" className="archival-rail-item" onClick={() => { close(); void onExportBackup(); }}><Download /><span>Export backup (JSON)</span></button>
            <button type="button" className="archival-rail-item" onClick={() => { close(); onLogout(); }}><LogOut /><span>Sign out</span></button>
          </div>}
        </div>
      </div>}
    </div>
  );
}
