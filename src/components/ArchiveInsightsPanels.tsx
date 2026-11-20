import { Activity, BookOpen, CalendarClock, Compass, FolderOpen, Hash } from 'lucide-react';
import { useState } from 'react';
import { EMOTIONS } from '../data/emotions';

import type { ArchiveInsights } from '../lib/archiveInsights';
import type { EmotionKey } from '../types';
import './archive-insights.css';

export const moodLabel = (mood: EmotionKey) => EMOTIONS.find(entry => entry.key === mood)?.label ?? mood;
export const moodColor = (mood: EmotionKey) => EMOTIONS.find(entry => entry.key === mood)?.color ?? 'currentColor';
export const dateLabel = (day: string) => new Intl.DateTimeFormat('en', {dateStyle:'medium',timeZone:'UTC'}).format(new Date(`${day}T00:00:00Z`));

export function MoodRhythmStrip({data, onOpenAtlas, selectedEmotions = [], onToggleEmotionFilter, onClearEmotionFilters}: {
  data?: ArchiveInsights; onOpenAtlas: () => void; selectedEmotions?: EmotionKey[];
  onToggleEmotionFilter?: (mood: EmotionKey) => void; onClearEmotionFilters?: () => void;
}) {
  const [selected, setSelected] = useState('');
  const today = Date.parse(data?.today ?? '');
  const x = (day: string) => 12 + (29 - (today - Date.parse(day)) / 86_400_000) * 396 / 29;
  const y = (average: number) => 56 - (average - 1) * 11;
  const daily = data?.daily ?? [];
  const point = daily.find(row => row.day === selected);
  const dominant = data?.moods[0];
  return <section aria-label="Mood rhythm" className="archival-overview-panel insight-rhythm">
    <div className="insight-row"><span><Activity size={14} /> <strong>Mood rhythm</strong>{dominant && <small> · Most often {moodLabel(dominant.mood)} ({data.mood.logged} logged)</small>}</span>
      <button type="button" className="archival-control" onClick={onOpenAtlas}><Compass size={14} /> Mood Atlas</button></div>
    {data && !dominant && <p>No moods logged yet.</p>}
    {dominant && <details open><summary>Archive-wide mood distribution</summary>
      <div className="insight-rhythm-grid"><div><strong>30-day intensity trend</strong>
        {daily.length ? <><svg viewBox="0 0 420 68" role="img" aria-label="Recorded daily average mood intensity across the last 30 days">
          {[1,3,5].map(n => <line key={n} x1="8" x2="412" y1={y(n)} y2={y(n)} stroke="var(--archive-line)" />)}
          <polyline points={daily.map(row => `${x(row.day)},${y(row.average)}`).join(' ')} fill="none" stroke="var(--archive-prussian)" strokeWidth="2" />
          {daily.map(row => <circle key={row.day} cx={x(row.day)} cy={y(row.average)} r={row.day === selected ? 5 : 3.5} fill={moodColor(row.mood)}><title>{dateLabel(row.day)}: {row.average}/5 · {row.count} logged</title></circle>)}
        </svg><label>Recorded day <select value={selected} onChange={event => setSelected(event.target.value)}><option value="">Select a day</option>{daily.map(row => <option key={row.day} value={row.day}>{dateLabel(row.day)}</option>)}</select></label>
          {point && <p role="status">{moodLabel(point.mood)} · {point.average.toFixed(1)}/5 average · {point.count} logged</p>}</> : <p>No dated moods in the last 30 days.</p>}
      </div><div><p>All-time intensity: <b>{data.mood.average?.toFixed(1)}/5</b></p><ul className="insight-pills">{data.moods.map(row => <li key={row.mood}>
        {onToggleEmotionFilter ? <button type="button" aria-pressed={selectedEmotions.includes(row.mood)} onClick={() => onToggleEmotionFilter(row.mood)}>{moodLabel(row.mood)} {row.count}</button> : <span>{moodLabel(row.mood)} {row.count}</span>}
      </li>)}</ul>{selectedEmotions.length > 0 && onClearEmotionFilters && <button type="button" onClick={onClearEmotionFilters}>Clear mood filters</button>}</div></div>
    </details>}
  </section>;
}

export function ArchiveDataHealth({health}: {health?: ArchiveInsights['health']}) {
  const metrics = [
    {Icon:BookOpen, label:'Total memories', value:health?.total, detail:health && `${health.photos} photos · ${health.milestones} milestones · ${health.withPlace} with places`},
    {Icon:FolderOpen, label:'Active tracks', value:health && `${health.activeTracks} / ${health.totalTracks}`},
    {Icon:Hash, label:'Tag count', value:health?.tagCount, detail:health?.topTag && `Most used: #${health.topTag.label} (${health.topTag.count})`},
    {Icon:CalendarClock, label:'Oldest entry', value:health?.earliest ? dateLabel(health.earliest) : undefined, detail:health && `${health.dated} dated · ${health.withMood} with mood`},
  ];
  return <section aria-label="Archive data health summary" className="archival-overview-panel"><details open><summary>Data health <small>· All accessible tracks</small></summary>
    <div id="memory-summary" data-summary className="archival-health-grid">{metrics.map(({Icon,label,value,detail}) => <div key={label} data-summary-metric><p><Icon size={14} />{label}</p><strong>{value ?? '—'}</strong>{detail && <p>{detail}</p>}</div>)}</div>
  </details></section>;
}
