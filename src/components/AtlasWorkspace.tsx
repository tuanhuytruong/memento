import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, Award, MapPin, Sparkles, X } from 'lucide-react';
import { request } from '../lib/api';
import { useArchiveInsights, type AtlasInsights, type InsightMemory } from '../lib/archiveInsights';
import type { AccountOverview, EmotionKey, TimelineEvent } from '../types';
import { dateLabel, moodColor, moodLabel } from './ArchiveInsightsPanels';
import { PrivateImage } from './PrivateImage';

const seals: [keyof AtlasInsights['seals'], string, number, string][] = [
  ['joyPeaks','Monthly Joy Peak',1,'Dated Joyful memory at 4/5 or more'],
  ['reflectiveDays','10 Days of Reflection',10,'Distinct Reflective or Serene days'],
  ['peakEntries','Peak Resonance',3,'Memories rated 5/5'],
  ['distinctMoods','Full Spectrum Keeper',6,'Distinct moods'],
  ['monthsInYear','Seasonal Chronicler',3,'Mood-logged months in one calendar year'],
  ['gratefulPeaks','Circle of Gratitude',2,'Grateful memories rated 4/5 or more'],
  ['longestStreak','7-Day Mood Cadence',7,'Consecutive mood-logged calendar days'],
  ['spanMonths','Year-Spanning Archive',12,'Months between first and last dated moods'],
];

function AtlasDialog({title, children, close}: {title: string; children: ReactNode; close: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} aria-label={title} className="insight-dialog" onCancel={event => { event.preventDefault(); close(); }}>
    <header className="insight-row"><h2>{title}</h2><button type="button" className="archival-icon-button" aria-label="Close" autoFocus onClick={close}><X /></button></header>
    {children}
  </dialog>;
}

interface AtlasWorkspaceProps {
  overview: AccountOverview | null;
  onFilterByMood: (mood: EmotionKey) => void;
  onFilterByPlace: (place: string) => void;
  onFilterByTag?: (tag: string, mood: EmotionKey) => void;
}

export function AtlasWorkspace({overview, onFilterByMood, onFilterByPlace, onFilterByTag}: AtlasWorkspaceProps) {
  const [tab, setTab] = useState<'moods'|'places'>('moods');
  const [achievements, setAchievements] = useState(false);
  const [association, setAssociation] = useState<'all'|'tag'|'place'>('all');
  const [selectedMood, setSelectedMood] = useState<EmotionKey>();
  const [preview, setPreview] = useState<{item:InsightMemory; overview:AccountOverview|null} | null>(null);
  const [memory, setMemory] = useState<{selection:typeof preview; data?:TimelineEvent; error?:boolean}>();
  const {data, error, retry} = useArchiveInsights('atlas', overview);
  const activePreview = preview && preview.overview === overview && data ? preview : null;
  useEffect(() => {
    if (!activePreview) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); setMemory({selection:activePreview,error:true}); }, 15_000);
    const {ownerId,id} = activePreview.item;
    request<{moment:TimelineEvent}>(`/moments/${encodeURIComponent(id)}?${new URLSearchParams({ownerId})}`, {signal:controller.signal, cache:'no-store'})
      .then(result => {
        if (controller.signal.aborted) return;
        if (result?.moment?.id !== id || result.moment.resourceOwnerId !== ownerId) throw Error('Unexpected memory identity');
        setMemory({selection:activePreview,data:result.moment});
      }).catch(() => { if (!controller.signal.aborted) setMemory({selection:activePreview,error:true}); })
      .finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [activePreview]);
  const open = (item: InsightMemory) => setPreview({item,overview});
  const detail = memory?.selection === activePreview ? memory : undefined;
  const dominant = data?.moods[0];
  const pulse = data?.moods.find(row => row.mood === selectedMood) ?? dominant;
  const unlocked = data ? seals.filter(([key,,target]) => data.seals[key] >= target).length : 0;
  const recent = (examples:InsightMemory[]) => <ul className="insight-recent">{examples.map(item => <li key={JSON.stringify([item.ownerId,item.id])}><button type="button" onClick={() => open(item)}><span>{item.title || 'Untitled memory'}</span><small>{item.date ? dateLabel(item.date) : 'Undated'}</small></button></li>)}</ul>;
  const factors = data?.associations.filter(f => association === 'all' || f.kind === association) ?? [];
  const associationsFor = (mood: EmotionKey) => factors.filter(f => f.mood === mood);

  return <div className="archival-workspace insight-atlas">
    <header className="insight-masthead"><div><p className="archival-eyebrow">{tab === 'moods' ? 'Emotional climate across time' : 'Geographic index of your archive'}</p>
      <h1>{tab === 'moods' ? 'Mood Atlas' : 'Places Atlas'}</h1><p>{tab === 'moods' ? 'Trace the emotional texture and intensity of your memories across months and chapters.' : 'Revisit the cities, venues, and neighborhoods preserved across your tracks.'}</p></div>
      <div className="insight-row"><div className="insight-segment" role="group" aria-label="Atlas views">
        <button type="button" aria-pressed={tab === 'moods'} onClick={() => setTab('moods')}>Mood Atlas</button>
        <button type="button" aria-pressed={tab === 'places'} onClick={() => setTab('places')}>Places Atlas</button></div>
        {data && tab === 'moods' && <button type="button" className="archival-control" onClick={() => setAchievements(true)}><Award size={16} /> Achievements {unlocked}/{seals.length}</button>}</div>
    </header>
    {error ? <p role="alert">Atlas is unavailable. <button className="archival-control" onClick={retry}>Retry Atlas</button></p> : !data && <p role="status">Loading Atlas…</p>}
    {data && tab === 'moods' && <>
      <section aria-label="Mood metrics" className="insight-metrics">
        {[['Dominant mood', dominant ? moodLabel(dominant.mood) : '—'], ['Logged moods', data.mood.logged], ['Average intensity', data.mood.average === null ? '—' : `${data.mood.average.toFixed(1)}/5`], ['Mood seals', `${unlocked}/${seals.length}`]].map(([label,value]) => <div className="insight-card" key={label}><small>{label}</small><strong>{value}</strong></div>)}
      </section>
      {!dominant ? <section className="insight-card"><Sparkles /><h2>No moods logged yet</h2><p>Add a mood when recording a memory to reveal the emotional climate of your archive.</p></section> : <>
        <section className="insight-card insight-pulse"><h2>Mood Pulse Constellation</h2><p>Size reflects the count of logged moods across all accessible tracks.</p>
          <div className="insight-orbits" role="group" aria-label="Explore mood distribution">{data.moods.map(row => <button type="button" key={row.mood} aria-pressed={pulse?.mood === row.mood} style={{borderColor:moodColor(row.mood)}} onClick={() => setSelectedMood(row.mood)}>
            <span aria-hidden="true" style={{background:moodColor(row.mood),width:8 + 20 * Math.sqrt(row.count/dominant.count),aspectRatio:'1',borderRadius:'50%'}} />{moodLabel(row.mood)}</button>)}</div>
          {pulse && <div className="insight-row"><p>{moodLabel(pulse.mood)} · {pulse.count} logged · {pulse.average.toFixed(1)}/5 average</p><button type="button" className="archival-control" onClick={() => onFilterByMood(pulse.mood)}>Filter archive <ArrowUpRight size={14}/></button></div>}
        </section>
        <section className="insight-card"><h2>Monthly Temperament</h2><p>Latest 24 recorded months · dominant mood and average intensity</p>
          {data.months.length ? <ul className="insight-months">{data.months.map(row => <li key={row.month} style={{borderTopColor:moodColor(row.mood)}}><b>{row.month}</b><span>{moodLabel(row.mood)}</span><small>{row.average.toFixed(1)}/5 · {row.count} logged</small></li>)}</ul> : <p>No dated moods yet.</p>}
          {data.peak && <div className="insight-row"><p>Peak milestone · {moodLabel(data.peak.mood)} · {data.peak.intensity}/5</p><button type="button" className="archival-control" onClick={() => open(data.peak!)}>View peak memory</button></div>}
        </section>
        <section className="insight-card"><h2>Mood Correlations</h2><p>Observed associations, not causes. Each factor needs at least four logged moods and two occurrences of the highlighted mood.</p>
          <label>Explore factors <select value={association} onChange={event => setAssociation(event.target.value as typeof association)}><option value="all">All factors</option><option value="tag">Tags</option><option value="place">Places</option></select></label>
          {factors.length === 0 ? <p>Not enough evidence for a positive association here.</p> : <div className="insight-grid">{(['joyful','reflective'] as const).map(mood => <div key={mood}><h3>{moodLabel(mood)}</h3>{associationsFor(mood).length === 0 && <p>No supported association.</p>}
            <ul className="insight-factors">{associationsFor(mood).map((f,index) => <li key={`${f.kind}:${index}`}><strong>{f.kind === 'tag' && '#'}{f.label}</strong><meter min={0} max={1} value={f.share} aria-label={`${moodLabel(mood)} share for ${f.label}`} /><small>{(f.share*100).toFixed(0)}% · {f.count}/{f.sample} logged · {(f.baseline*100).toFixed(0)}% archive baseline</small>{f.kind === 'tag' && onFilterByTag && <button type="button" className="archival-control" onClick={() => onFilterByTag(f.label,f.mood)}>Filter archive</button>}</li>)}</ul></div>)}</div>}
        </section>
        <section><h2>Mood Index</h2><div className="insight-grid">{data.moods.map(row => <article className="insight-card" key={row.mood} style={{borderTopColor:moodColor(row.mood)}}><h3>{moodLabel(row.mood)}</h3><p>{row.count} logged · {row.average.toFixed(1)}/5 average</p>{recent(row.examples)}<button type="button" className="archival-control" onClick={() => onFilterByMood(row.mood)}>Filter archive to {moodLabel(row.mood)} <ArrowUpRight size={14} /></button></article>)}</div></section>
      </>}
    </>}
    {data && tab === 'places' && (data.places.length === 0 ? <section className="insight-card"><MapPin /><h2>No places mapped yet</h2><p>Add a city or venue when recording a memory to grow your Places Atlas.</p></section> : <>
      <p className="insight-totals">{data.geography.places} places · {data.geography.countries} countries · {data.geography.moments} geotagged memories{data.geography.places > data.places.length && ` · Top ${data.places.length} places shown`}</p>
      <div className="insight-grid">{data.places.map((place,index) => <article className="insight-card insight-place" key={index}>
        {place.imageId && <div className="insight-cover"><PrivateImage src={`/api/images/${encodeURIComponent(place.imageId)}`} variant="thumb" alt="" loading="lazy" className="w-full h-full" /></div>}
        <h2>{place.city}</h2><p>{[place.country, `${place.count} ${place.count === 1 ? 'memory' : 'memories'}`, place.mood && moodLabel(place.mood)].filter(Boolean).join(' · ')}</p>
        {place.earliest && place.latest && <small>{dateLabel(place.earliest)}{place.earliest !== place.latest && ` – ${dateLabel(place.latest)}`}</small>}
        {recent(place.examples)}<button type="button" className="archival-control" onClick={() => onFilterByPlace(place.city.slice(0,120))}>Search archive for {place.city} <ArrowUpRight size={14}/></button>
      </article>)}</div>
    </>)}
    {data && achievements && <AtlasDialog title="Mood Achievements" close={() => setAchievements(false)}><p>{unlocked} of {seals.length} seals unlocked</p><ul className="insight-seals">{seals.map(([key,label,target,criteria]) => <li key={key}><Award size={18} /><div><strong>{label}</strong><p>{criteria}</p><small>{data.seals[key]} / {target} · {data.seals[key] >= target ? 'Unlocked' : 'In progress'}</small></div></li>)}</ul></AtlasDialog>}
    {activePreview && <AtlasDialog title={detail?.data?.title || 'Memory preview'} close={() => setPreview(null)}>
      {detail?.error ? <p role="alert">This memory could not be opened. It may no longer be available. <button className="archival-control" onClick={() => open(activePreview.item)}>Retry memory</button></p> : detail?.data ? <><p>{activePreview.item.date ? dateLabel(activePreview.item.date) : 'Undated'}</p><p className="insight-description">{detail.data.description}</p>{detail.data.images?.[0] && <div className="insight-preview-image"><PrivateImage src={detail.data.images[0]} variant="display" alt="Memory photo" fit="contain" className="w-full h-full" /></div>}</> : <p role="status">Loading memory…</p>}
    </AtlasDialog>}
  </div>;
}
