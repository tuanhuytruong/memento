import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { EventTrack, StoryDetail, TimelineEvent } from '../types';
import { storiesApi } from '../lib/storiesApi';
import { useStoryLibrary } from '../lib/useStoryLibrary';
import { useModalLifecycle } from '../lib/useModalLifecycle';
import { trackIdentity } from '../lib/resourceIdentity';
const Composer=lazy(()=>import('./StoryComposer').then(m=>({default:m.StoryComposer})));
const Reader=lazy(()=>import('./StoryReader').then(m=>({default:m.StoryReader})));
const button='min-h-11 min-w-11 rounded-xl border border-stone-300 px-3 py-2 text-sm disabled:opacity-40 dark:border-stone-700';
export function StoryLibrary({tracks,currentUserId,generation,initialTrackKey,onClose,onOpenMoment}:{tracks:EventTrack[];currentUserId:string;generation:number;initialTrackKey:string;onClose:()=>void;onOpenMoment:(moment:TimelineEvent)=>void}){
 const [key,setKey]=useState(initialTrackKey==='all'?'':initialTrackKey),[mode,setMode]=useState<'library'|'read'|'compose'>('library');
 const track=tracks.find(t=>trackIdentity(t)===key),ownerId=track?.resourceOwnerId||currentUserId;
 const owned=!!track&&ownerId===currentUserId&&track.accessRole==='owner';
 const library=useStoryLibrary(track?ownerId:'',track?.id||'',generation);
 const [detail,setDetail]=useState<StoryDetail|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false);
 const dirty=useRef(false),pending=useRef(false),alive=useRef(true),request=useRef<AbortController|null>(null),body=useRef<HTMLDivElement>(null);
 const scope=`${currentUserId}:${generation}:${ownerId}:${key}`;
 const scopeRef=useRef(scope);scopeRef.current=scope;
 useEffect(()=>{request.current?.abort();setLoading(false);setDetail(null);setMode('library');setError('');dirty.current=false;setPending(false);},[scope]);
 const canLeave=()=>!pending.current&&(!dirty.current||window.confirm('Discard unsaved story changes?'));
 const close=()=>{if(canLeave())onClose();};
 const panel=useModalLifecycle(true,close);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current?.abort();};},[]);
 const setPending=(value:boolean)=>{pending.current=value;setBusy(value);};
 const back=()=>{if(!canLeave())return;dirty.current=false;request.current?.abort();setMode('library');setDetail(null);setError('');setPending(false);library.first();};
 const read=async(id:string)=>{
  if(!track)return;request.current?.abort();const controller=new AbortController();request.current=controller;const capturedScope=scope;
  const current=()=>alive.current&&!controller.signal.aborted&&request.current===controller&&scopeRef.current===capturedScope;
  setLoading(true);setError('');
  try{const result=await storiesApi.detail(id,ownerId,track.id,controller.signal);if(current()){setDetail(result);setMode('read');}}
  catch(failure){if(current())setError(failure instanceof Error?failure.message:'Could not read story. Please retry.');}
  finally{if(current())setLoading(false);}
 };
 const remove=async()=>{
  if(!detail||pending.current||!window.confirm('Delete this story? Its original memories and photos will not be deleted.'))return;
  const controller=new AbortController();request.current=controller;setPending(true);setError('');
  try{await storiesApi.remove(detail.story.id,detail.story.version,controller.signal);if(alive.current){setPending(false);back();}}
  catch(failure){if(alive.current&&!controller.signal.aborted)setError(failure instanceof Error?failure.message:'Delete failed. Reload the story and retry.');}
  finally{if(alive.current)setPending(false);}
 };
 return <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="story-library-heading" tabIndex={-1} className="fixed inset-0 z-40 flex items-center justify-center bg-stone-950/50 p-0 sm:p-5" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}>
 <section className="flex h-[100dvh] w-full max-w-[960px] flex-col overflow-hidden bg-stone-50 text-stone-900 shadow-xl sm:max-h-[92dvh] sm:rounded-3xl dark:bg-stone-950 dark:text-stone-100">
 <header className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 dark:border-stone-800"><h1 id="story-library-heading" className="font-display text-xl">{mode==='compose'?(detail?'Edit story':'New story'):'Stories'}</h1><div className="flex flex-wrap gap-2">{mode!=='library'&&<button className={button} disabled={busy} onClick={back}>Back to stories</button>}<button className={button} disabled={busy} aria-label="Close stories" onClick={close}>Close</button></div></header>
 <div ref={body} className={`min-h-0 flex-1 ${mode==='compose'?'overflow-hidden':'overflow-y-auto overscroll-contain p-4 sm:p-7'}`}>
 {error&&<div role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-red-800 dark:bg-red-950 dark:text-red-200">{error}</div>}
 {loading&&<p role="status">Loading story…</p>}
 {mode==='library'&&<div className="space-y-5"><p className="text-sm text-stone-500">A track holds memories. A story arranges them into a living narrative. A postcard is a separate keepsake image. Shared stories follow their track’s access; only owners can edit.</p>
 <label className="block">Story track<select aria-label="Story track" className="mt-1 min-h-11 w-full rounded-xl border border-stone-300 bg-transparent p-3 dark:border-stone-700" value={key} onChange={e=>{setKey(e.target.value);setError('');}}><option value="">Choose a track</option>{tracks.map(t=><option key={trackIdentity(t)} value={trackIdentity(t)}>{t.title}{t.accessRole!=='owner'?' (shared)':''}</option>)}</select></label>
 {owned&&<button className={`${button} bg-amber-600 text-white`} onClick={()=>{dirty.current=false;setDetail(null);setMode('compose');}}>New story</button>}
 {!tracks.length&&<p>Create a track and add memories to begin your first story.</p>}
 {library.loading&&<p role="status">Loading stories…</p>}{library.error&&<div role="alert">{library.error}<button className={button} onClick={library.retry}>Retry stories</button></div>}
 {track&&!library.loading&&!library.error&&!library.stories.length&&<p>No stories in this track yet.{owned?' Choose New story to bring its memories together.':' The owner can curate stories here.'}</p>}
 <ul className="space-y-3">{library.stories.map(story=><li key={story.id}><button className={`${button} w-full p-4 text-left`} disabled={loading} onClick={()=>void read(story.id)}><strong className="block break-words font-display text-xl">{story.title}</strong><span className="text-xs text-stone-500">{story.itemCount??0} memories · Updated {story.updatedAt?.slice(0,10)}</span></button></li>)}</ul>
 <div className="flex gap-2">{library.hasPrevious&&<button className={button} onClick={library.first}>First stories</button>}{library.nextCursor&&<button className={button} onClick={library.next}>Next stories</button>}</div></div>}
 <Suspense fallback={<p role="status">Opening story workspace…</p>}>
 {mode==='compose'&&track&&owned&&<Composer key={detail?.story.id||key} initial={detail} ownerId={ownerId} trackId={track.id} onDirty={value=>{dirty.current=value;}} onBusy={setPending} onSaved={()=>{setPending(false);dirty.current=false;back();}}/>}
 {mode==='read'&&detail&&<><div className="mb-5 flex flex-wrap gap-2">{owned&&detail.capabilities.canEdit&&<button className={button} onClick={()=>setMode('compose')}>{detail.items.some(i=>!i.moment||i.unavailable)?'Edit / repair story':'Edit story'}</button>}{owned&&detail.capabilities.canDelete&&<button className={button} disabled={busy} onClick={()=>void remove()}>Delete story</button>}</div><Reader detail={detail} onOpen={moment=>{const scroll=body.current?.scrollTop||0;onOpenMoment(moment);requestAnimationFrame(()=>{if(body.current)body.current.scrollTop=scroll;});}}/></>}
 </Suspense>
 </div></section></div>;
}
