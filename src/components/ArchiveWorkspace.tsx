import { ArchiveDataHealth, MoodRhythmStrip } from './ArchiveInsightsPanels';
import { useArchiveInsights } from '../lib/archiveInsights';
import { ArchiveViews } from './ArchiveShell';
import type { ReactNode } from 'react';
import type { AccountOverview, EmotionKey, EventTrack, ViewMode } from '../types';

interface ArchiveWorkspaceProps {
  viewMode: ViewMode;
  onViewMode: (view: ViewMode) => void;
  density: number;
  onDensity: (density: number) => void;
  activeTrack: EventTrack | null;
  trackCount: number;
  trackDetails?: ReactNode;
  children: ReactNode;
}

export function ArchiveWorkspace({ activeTrack, trackCount, trackDetails, children, viewMode, onViewMode, density, onDensity }: ArchiveWorkspaceProps) {
  return (
    <div className="archival-workspace" data-density={density}>
      <section className="archival-masthead" aria-labelledby="archive-heading">
        <div className="archival-masthead-main"><div className="archival-masthead-copy">
          <p className="archival-eyebrow">{activeTrack ? 'Archive / Track' : 'Mend your memory, together'}</p>
          <h1 id="archive-heading">{activeTrack?.title ?? 'Your Living Archive'}</h1>
          {activeTrack ? (activeTrack.description && <p className="archival-intro">{activeTrack.description}</p>) : <p className="archival-intro">Chronicles, quiet mornings, and shared perspectives gathered across <span className="font-mono">{trackCount}</span> {trackCount === 1 ? 'track' : 'tracks'}.</p>}
        </div>
        <ArchiveViews mobile mode={viewMode} onChange={onViewMode} />
        {viewMode === 'timeline' && <div className="archival-density">
          <div><label htmlFor="archive-density">Spacing &amp; fade</label><small>{['Dense', 'Compact', 'Balanced', 'Spacious'][density - 1]} · Fade &gt; {['7d','30d','90d','6mo'][density - 1]}</small></div>
          <div><button type="button" onClick={() => onDensity(1)}>Dense</button><input id="archive-density" aria-label="Timeline spacing and memory fade threshold" type="range" min={1} max={4} value={density} onChange={event => onDensity(Number(event.target.value))} /><button type="button" onClick={() => onDensity(4)}>Spacious</button></div>
        </div>}</div>
        {trackDetails}
      </section>
      {children}
    </div>
  );
}

export function ArchiveOverview({overview, onOpenAtlas, selectedEmotions, onToggleEmotionFilter, onClearEmotionFilters}: {
  overview: AccountOverview | null; tracks: EventTrack[]; onOpenAtlas: () => void;
  selectedEmotions?: EmotionKey[]; onToggleEmotionFilter?: (mood: EmotionKey) => void; onClearEmotionFilters?: () => void;
}) {
  const {data,error,retry} = useArchiveInsights('archive',overview);
  return <div className="archival-overview">
    {error ? <p role="alert">Archive insights are unavailable. <button className="archival-control" onClick={retry}>Retry insights</button></p> : !data && <p role="status">Loading archive insights…</p>}
    <MoodRhythmStrip data={data} onOpenAtlas={onOpenAtlas} selectedEmotions={selectedEmotions} onToggleEmotionFilter={onToggleEmotionFilter} onClearEmotionFilters={onClearEmotionFilters} />
    <ArchiveDataHealth health={data?.health} />
  </div>;
}
