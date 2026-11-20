import { useState, type ReactNode } from 'react';
import { BookOpen, ChevronRight, Clock, Dices, Download, FolderKanban, Image, Layers, LogOut, Mail, PanelLeftClose, PanelLeftOpen, Plus, X } from 'lucide-react';
import { getEventIconComponent } from '../data/eventThemes';
import { trackIdentity } from '../lib/resourceIdentity';
import { useModalLifecycle } from '../lib/useModalLifecycle';
import type { AccountOverview, EventTrack } from '../types';
import '../archival-shell.css';

interface ArchiveShellProps {
  children: ReactNode;
  tracksPanel: (select: (track: EventTrack | null) => void, close: () => void) => ReactNode;
  tracks: EventTrack[];
  overview: AccountOverview | null;
  activeTrack: EventTrack | null;
  username: string;
  readyLetterCount: number;
  onSelectTrack: (track: EventTrack | null) => void;
  onCreateMemory?: () => void;
  onOpenStories: () => void;
  onOpenLetters: () => void;
  onOpenBlindbox: () => void;
  onCreatePostcard?: () => void;
  onExportBackup: () => Promise<void>;
  onLogout: () => void;
}

export function ArchiveShell({ children, tracksPanel, tracks, overview, activeTrack, username, readyLetterCount,
  onSelectTrack, onCreateMemory, onOpenStories, onOpenLetters, onOpenBlindbox, onCreatePostcard, onExportBackup, onLogout }: ArchiveShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [panel, setPanel] = useState<'tracks' | 'desk' | null>(null);
  const close = () => setPanel(null);
  const panelRef = useModalLifecycle(panel !== null, close);
  const select = (track: EventTrack | null) => {
    close();
    onSelectTrack(track);
    window.scrollTo(0, 0);
  };
  const destinations = [
    { label: 'Archive', Icon: Clock, action: () => select(null), active: !panel },
    { label: 'Tracks', Icon: Layers, action: () => setPanel('tracks'), active: panel === 'tracks' },
    { label: 'Stories', Icon: BookOpen, action: onOpenStories, id: 'open-stories' },
    { label: 'Letters', Icon: Mail, action: onOpenLetters, id: 'open-future-letters', count: readyLetterCount },
  ];
  const counts = new Map(overview?.tracks.map(row => [`${row.trackOwnerId}:${row.trackId}`, row.count]));
  const initial = Array.from(username)[0]?.toUpperCase();

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
          {destinations.map(({ label, Icon, action, active, id, count }) => (
            <button key={label} id={id} type="button" className="archival-rail-item" aria-label={count ? `${label}, ${count} ready` : label} aria-current={active ? 'page' : undefined} title={collapsed ? label : undefined} onClick={action}>
              <Icon />{!collapsed && <><span>{label}</span>{!!count && <small>{count}</small>}</>}
            </button>
          ))}
          {onCreatePostcard && <button id="create-postcard" type="button" className="archival-rail-item" aria-label="Postcards" title={collapsed ? 'Postcards' : undefined} onClick={onCreatePostcard}><Image />{!collapsed && <span>Postcards</span>}</button>}
          <button type="button" className="archival-rail-item" aria-label="Blindbox" title={collapsed ? 'Blindbox' : undefined} onClick={onOpenBlindbox}><Dices className="archival-wax" />{!collapsed && <><span>Blindbox</span><small>Surprise</small></>}</button>
        </nav>
        <nav id="archival-track-directory" className="archival-directory" aria-label="Track shortcuts" hidden={collapsed}>
          <div className="archival-directory-title"><span>Tracks</span><button type="button" onClick={() => setPanel('tracks')}>Browse tracks <ChevronRight size={13} /></button></div>
          <button type="button" className="archival-rail-item" aria-pressed={!activeTrack} onClick={() => select(null)}><Layers /><span>All tracks</span>{overview && <small>{overview.total}</small>}</button>
          {tracks.map(track => {
            const key = trackIdentity(track);
            const Icon = getEventIconComponent(track.icon);
            return <button key={key} type="button" className="archival-rail-item" aria-pressed={!!activeTrack && trackIdentity(activeTrack) === key} onClick={() => select(track)}><Icon /><span title={track.title}>{track.title}</span>{overview && <small>{counts.get(key) ?? 0}</small>}</button>;
          })}
        </nav>
      </aside>
      <div className="archival-body">
        <header className="archival-topbar">
          <button type="button" className="archival-mobile-tracks archival-icon-button" aria-label="Open tracks drawer" onClick={() => setPanel('tracks')}><FolderKanban /></button>
          <div className="archival-breadcrumb"><button type="button" onClick={() => select(null)}>Archive</button>{activeTrack && <><ChevronRight size={14} /><span title={activeTrack.title}>{activeTrack.title}</span></>}</div>
          <span className="archival-mobile-title" title={activeTrack?.title}>{activeTrack?.title ?? 'Archive'}</span>
          <div className="archival-top-actions">
            {onCreateMemory && <button id="open-create-event-modal" type="button" className="archival-primary-button archival-new-memory" onClick={onCreateMemory} aria-label="New memory"><Plus size={16} /><span>New memory</span></button>}
            <div data-account-menu><button type="button" className="archival-account" title={username} aria-label={`Account: ${username}`} aria-haspopup="dialog" aria-expanded={panel === 'desk'} onClick={() => setPanel('desk')}>{initial}</button></div>
          </div>
        </header>
        {children}
      </div>
      <nav className="archival-mobile-nav" aria-label="Mobile navigation">
        <div>
          {[...destinations, { label: 'Desk', Icon: FolderKanban, action: () => setPanel('desk'), active: panel === 'desk' }].map(({ label, Icon, action, active, count }) => (
            <button key={label} type="button" aria-label={count ? `${label}, ${count} ready` : label} aria-current={active ? 'page' : undefined} onClick={action}><Icon /><span>{label}</span>{!!count && <small>{count}</small>}</button>
          ))}
        </div>
      </nav>
      {panel && <div className="archival-sheet-backdrop" onPointerDown={event => { if (event.currentTarget === event.target) { event.preventDefault(); close(); } }}>
        <div ref={panelRef} className="archival-sheet" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="archival-sheet-title">
          <div className="archival-sheet-title"><h2 id="archival-sheet-title">{panel === 'tracks' ? 'Tracks' : 'Desk'}</h2><button type="button" className="archival-icon-button" onClick={close} aria-label={`Close ${panel}`}><X /></button></div>
          {panel === 'tracks' ? tracksPanel(select, close) : <div className="archival-desk">
            <p className="archival-desk-user">Signed in as <strong>{username}</strong></p>
            <button type="button" className="archival-rail-item" onClick={() => { close(); onOpenBlindbox(); }}><Dices /><span>Blindbox</span></button>
            {onCreatePostcard && <button type="button" className="archival-rail-item" onClick={() => { close(); onCreatePostcard(); }}><Image /><span>Create postcard</span></button>}
            <button type="button" id="export-timeline-json" className="archival-rail-item" onClick={() => { close(); void onExportBackup(); }}><Download /><span>Export backup (JSON)</span></button>
            <button type="button" className="archival-rail-item" onClick={() => { close(); onLogout(); }}><LogOut /><span>Sign out</span></button>
          </div>}
        </div>
      </div>}
    </div>
  );
}
