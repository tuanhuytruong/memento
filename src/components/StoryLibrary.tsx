import { lazy, Suspense, useEffect, useRef, useState, type RefObject } from 'react';
import type { EventTrack, StoryDetail, TimelineEvent } from '../types';
import { storiesApi } from '../lib/storiesApi';
import { useStoryLibrary } from '../lib/useStoryLibrary';
import { BookOpen, Plus } from 'lucide-react';
import { ArchivalLibraryFrame, libraryButton as button, libraryCard, libraryField, libraryPrimary } from './ArchivalLibraryFrame';
import { trackIdentity } from '../lib/resourceIdentity';
const Composer=lazy(()=>import('./StoryComposer').then(m=>({default:m.StoryComposer})));
const Reader=lazy(()=>import('./StoryReader').then(m=>({default:m.StoryReader})));
type Props = { tracks: EventTrack[]; currentUserId: string; generation: number; initialTrackKey: string; workspace?: boolean; leaveGuard?: RefObject<(() => boolean) | null>; onClose: () => void; onOpenMoment: (moment: TimelineEvent) => void };
export function StoryLibrary(props: Props) {
 return <StoryLibrarySession key={`${props.currentUserId}:${props.generation}`} {...props} />;
}
function StoryLibrarySession({tracks,currentUserId,generation,initialTrackKey,onClose,onOpenMoment,workspace=false,leaveGuard}:Props){
 const [key,setKey]=useState(initialTrackKey==='all'?'':initialTrackKey),[mode,setMode]=useState<'library'|'read'|'compose'>('library');
 const track=tracks.find(t=>trackIdentity(t)===key),ownerId=track?.resourceOwnerId||currentUserId;
 const owned=!!track&&ownerId===currentUserId&&track.accessRole==='owner';
 const library=useStoryLibrary(track?ownerId:'',track?.id||'',generation);
 const [detail,setDetail]=useState<StoryDetail|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false);
 const dirty=useRef(false),pending=useRef(false),alive=useRef(true),request=useRef<AbortController|null>(null),trackSelect=useRef<HTMLSelectElement>(null),returned=useRef(false);
 const scope=JSON.stringify([currentUserId,generation,ownerId,track?.id,track?.accessRole]);
 const scopeRef=useRef(scope);scopeRef.current=scope;
 useEffect(()=>{request.current?.abort();setLoading(false);setDetail(null);setMode('library');setError('');dirty.current=false;setPending(false);},[scope]);
 const canLeave=()=>!pending.current&&(!dirty.current||window.confirm('Discard unsaved story changes?'));
 useEffect(()=>{if(!workspace||!leaveGuard)return;leaveGuard.current=canLeave;return()=>{if(leaveGuard.current===canLeave)leaveGuard.current=null;};},[workspace,leaveGuard]);
 const close=()=>{if(workspace){back();return;}if(canLeave()){request.current?.abort();onClose();}};
 useEffect(()=>{if(workspace&&mode==='library'&&returned.current){returned.current=false;trackSelect.current?.focus({preventScroll:true});}},[mode,workspace]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current?.abort();};},[]);
 const setPending=(value:boolean)=>{pending.current=value;setBusy(value);};
 const back=()=>{if(!canLeave())return;returned.current=true;dirty.current=false;request.current?.abort();setLoading(false);setMode('library');setDetail(null);setError('');setPending(false);library.first();};
 const compose=()=>{request.current?.abort();setLoading(false);setError('');dirty.current=false;setDetail(null);setMode('compose');};
 const read=async(id:string, edit=false)=>{
  if(!track)return;request.current?.abort();const controller=new AbortController();request.current=controller;const capturedScope=scope;
  const current=()=>alive.current&&!controller.signal.aborted&&request.current===controller&&scopeRef.current===capturedScope;
  setLoading(true);setError('');
  try{const result=await storiesApi.detail(id,ownerId,track.id,controller.signal);if(current()){setDetail(result);setMode(edit&&owned&&result.capabilities.canEdit?'compose':'read');}}
  catch(failure){if(current())setError(failure instanceof Error?failure.message:'Could not read story. Please retry.');}
  finally{if(current())setLoading(false);}
 };
 const remove=async()=>{
  if(!owned||!detail?.capabilities.canDelete||pending.current||!window.confirm('Delete this story? Its original memories and photos will not be deleted.'))return;
  const controller=new AbortController();request.current=controller;const current=()=>alive.current&&!controller.signal.aborted&&request.current===controller&&scopeRef.current===scope;setPending(true);setError('');
  try{await storiesApi.remove(detail.story.id,detail.story.version,controller.signal);if(current()){setPending(false);back();}}
  catch(failure){if(current())setError(failure instanceof Error?failure.message:'Delete failed. Reload the story and retry.');}
  finally{if(current())setPending(false);}
 };
 const visibleMode = detail && (detail.story.ownerId!==ownerId || detail.story.trackId!==track?.id) ? 'library' : mode;
 return <ArchivalLibraryFrame workspace={workspace} composing={visibleMode==='compose'} reading={visibleMode==='read'} busy={busy} name="stories" headingId="story-library-heading"
   title={visibleMode==='compose'?(detail?'Edit story':'New story'):'Stories'} eyebrow="Curated narratives" description="Weave individual moments into quiet, readable chapters with opening and closing notes."
   onClose={close} onBack={back} actions={visibleMode==='library'&&owned?<button className={libraryPrimary} onClick={compose}><Plus size={16} aria-hidden="true"/>New story</button>:visibleMode==='read'&&owned&&detail?<>
   {detail.capabilities.canEdit&&<button className={button} disabled={busy} onClick={()=>setMode('compose')}>{detail.items.some(i=>!i.moment||i.unavailable)?'Edit / repair story':'Edit story'}</button>}
   {detail.capabilities.canDelete&&<button className={button} disabled={busy} onClick={()=>void remove()}>Delete story</button>}</>:null}>
   {error&&<p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
   {loading&&<p role="status">Loading story…</p>}
   {visibleMode==='library'&&<div className="space-y-6">
     <label className="block max-w-md text-sm font-medium">Story track<select ref={trackSelect} className={libraryField} value={track?key:''} onChange={e=>{request.current?.abort();setKey(e.target.value);}}><option value="">Choose a track</option>{tracks.map(t=><option key={trackIdentity(t)} value={trackIdentity(t)}>{t.title}{t.accessRole!=='owner'?' (shared)':''}</option>)}</select></label>
     {library.loading&&<p role="status">Loading stories…</p>}
     {library.error&&<div role="alert" className="flex flex-wrap items-center gap-2">{library.error}<button className={button} onClick={library.retry}>Retry stories</button></div>}
     {!library.loading&&!library.error&&!library.stories.length&&<div className={`${libraryCard} px-6 py-12 text-center`}>
       <BookOpen size={28} strokeWidth={1.5} aria-hidden="true" className="mx-auto mb-3 text-ink-muted dark:text-stone-400"/>
       <h2 className="font-display text-2xl">{track?'No stories composed yet':'Stories by track'}</h2>
       <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted dark:text-stone-400">{!tracks.length?'Create a track and add memories to begin your first story.':!track?'Choose an owned or shared track to browse its stories.':owned?'Select memories from this track and arrange them into a story.':'The track owner can curate stories here.'}</p>
       {owned&&<button className={`${libraryPrimary} mt-6`} onClick={compose}>Compose first story</button>}
     </div>}
     {!!library.stories.length&&<ul className="grid grid-cols-1 gap-6 md:grid-cols-2">{library.stories.map(story=><li key={story.id} className={`${libraryCard} overflow-hidden`}><article>
       <div className="grid aspect-video place-items-center bg-linen text-ink-muted dark:bg-stone-800 dark:text-stone-400"><BookOpen size={28} strokeWidth={1.5} aria-hidden="true"/></div>
       <div className="space-y-3 p-5 sm:p-6">
         <p className="break-words font-mono text-xs text-ink-muted dark:text-stone-400">{track?.title}{story.itemCount!==undefined&&` · ${story.itemCount} ${story.itemCount===1?'memory':'memories'}`} · {story.updatedAt?.slice(0,10)}</p>
         <h2 className="break-words font-display text-2xl">{story.title}</h2>
         {story.opening&&<p className="line-clamp-3 break-words text-sm leading-relaxed text-ink-soft dark:text-stone-300">{story.opening}</p>}
         <div className="flex flex-wrap justify-between gap-2 border-t border-hairline pt-3 dark:border-stone-700"><button className={button} aria-label={`Read story: ${story.title}`} disabled={loading} onClick={()=>void read(story.id)}>Read story</button>{workspace&&owned&&<button className={button} aria-label={`Edit: ${story.title}`} disabled={loading} onClick={()=>void read(story.id,true)}>Edit</button>}</div>
       </div>
     </article></li>)}</ul>}
     <div className="flex flex-wrap gap-2">{library.hasPrevious&&<button className={button} onClick={library.first}>First stories</button>}{library.nextCursor&&<button className={button} onClick={library.next}>Next stories</button>}</div>
   </div>}
   <Suspense fallback={<p role="status" className="p-4">Opening story workspace…</p>}>
     {visibleMode==='compose'&&track&&owned&&<Composer key={`${scope}:${detail?.story.id||'new'}`} initial={detail} ownerId={ownerId} trackId={track.id} onDirty={value=>{if(scopeRef.current===scope)dirty.current=value;}} onBusy={value=>{if(scopeRef.current===scope)setPending(value);}} onSaved={()=>{if(scopeRef.current!==scope)return;setPending(false);dirty.current=false;back();}}/>}
     {visibleMode==='read'&&detail&&<Reader detail={detail} trackTitle={track?.title} onOpen={onOpenMoment}/>}
   </Suspense>
 </ArchivalLibraryFrame>;
}
