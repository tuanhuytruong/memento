import type { ReactNode } from 'react';
import type { AccountOverview, EventTrack } from '../types';

interface ArchiveWorkspaceProps {
  activeTrack: EventTrack | null;
  overview: AccountOverview | null;
  trackCount: number;
  trackDetails?: ReactNode;
  children: ReactNode;
}

export function ArchiveWorkspace({ activeTrack, overview, trackCount, trackDetails, children }: ArchiveWorkspaceProps) {
  const metrics = [
    [overview?.total, 'memory', 'memories'],
    [trackCount, 'track', 'tracks'],
    [overview?.photos, 'photo', 'photos'],
    [overview?.milestones, 'milestone', 'milestones'],
    [overview?.places, 'place', 'places'],
  ] as const;
  return (
    <div className="archival-workspace">
      <section className="archival-masthead" aria-labelledby="archive-heading">
        <div className="archival-masthead-copy">
          <p className="archival-eyebrow">{activeTrack ? 'Archive / Track' : 'Mend your memory, together'}</p>
          <h1 id="archive-heading">{activeTrack?.title ?? 'Your Living Archive'}</h1>
          {activeTrack ? (activeTrack.description && <p className="archival-intro">{activeTrack.description}</p>) : <p className="archival-intro">Chronicles, quiet mornings, and shared perspectives gathered across {trackCount} {trackCount === 1 ? 'track' : 'tracks'}.</p>}
        </div>
        {trackDetails}
        <div id="memory-summary" data-summary aria-label="Full archive summary" className="archival-summary">
          {metrics.map(([value, singular, plural]) => <span key={singular} data-summary-metric><strong>{value ?? '—'}</strong> {value === 1 ? singular : plural}</span>)}
        </div>
      </section>
      {children}
    </div>
  );
}
