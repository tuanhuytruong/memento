import {useEffect, useRef, useState} from 'react';
import {ArrowLeft, CalendarDays, Layers, Leaf, Search, X} from 'lucide-react';
import {ApiError, authApi, dataApi, type AuthUser} from '../lib/api';
import type {EventTrack, TimelineEvent} from '../types';
import {PrivateImage} from '../components/PrivateImage';
import {trackIdentity} from '../lib/resourceIdentity';
import './photo-diary.css';

export default function PhotoDiaryPreview() {
  const [user,setUser]=useState<AuthUser|null>(null), [session,setSession]=useState('checking');
  const [tracks,setTracks]=useState<EventTrack[]>([]), [items,setItems]=useState<TimelineEvent[]>([]);
  const [track,setTrack]=useState(''), [search,setSearch]=useState(''), [from,setFrom]=useState(''), [to,setTo]=useState('');
  const [query,setQuery]=useState(''), [cursor,setCursor]=useState<string|null>(null), [next,setNext]=useState<string|null>(null);
  const [total,setTotal]=useState<number|null>(null), [busy,setBusy]=useState(false), [error,setError]=useState(''), [retry,setRetry]=useState(0);
  const [selected,setSelected]=useState<TimelineEvent|null>(null), [detail,setDetail]=useState<TimelineEvent|null>(null), [detailError,setDetailError]=useState(''), [detailRetry,setDetailRetry]=useState(0), [photo,setPhoto]=useState(0);
  const dialog=useRef<HTMLDialogElement>(null), opener=useRef<HTMLElement|null>(null);
  const deny=()=>{setUser(null);setItems([]);setTracks([]);setSelected(null);setDetail(null);setTotal(null);setSession('signed-out');};
  useEffect(()=>{let alive=true; const check=()=>authApi.me().then(u=>{if(alive){setUser(u);setSession('ready');}}).catch(e=>{if(alive){deny();if(!(e instanceof ApiError && e.status===401))setSession('error');}}); void check(); window.addEventListener('focus',check);return()=>{alive=false;window.removeEventListener('focus',check);};},[]);
  useEffect(()=>{if(!user)return;let alive=true;void dataApi.tracks().then(t=>{if(alive)setTracks(t);}).catch(e=>{if(alive){if([401,403].includes(e.status))deny();else setError('Tracks could not be loaded. Return to the app or reload to retry.');}});return()=>{alive=false;};},[user?.id]);
  useEffect(()=>{const timer=setTimeout(()=>{setQuery(search);setCursor(null);},300);return()=>clearTimeout(timer);},[search]);
  useEffect(()=>{if(!user)return;const controller=new AbortController();setItems([]);setSelected(null);setDetail(null);setBusy(true);setError('');setNext(null);setTotal(null);
    if(from&&to&&from>to){setError('The start date must not be after the end date.');setBusy(false);return;}
    void dataApi.queryMoments({search:query,trackKey:track||null,dateFrom:from,dateTo:to,sortDirection:'newest',limit:12,...(cursor?{cursor}:{})},controller.signal).then(page=>{if(!controller.signal.aborted){setItems(page.moments);setNext(page.nextCursor);setTotal(page.total??null);}}).catch(e=>{if(!controller.signal.aborted){if([401,403].includes(e.status))deny();else setError(e.message||'Memories could not be loaded.');}}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});return()=>controller.abort();
  },[user?.id,query,track,from,to,cursor,retry]);
  useEffect(()=>{if(!selected){dialog.current?.close();return;}let alive=true;setDetail(null);setDetailError('');setPhoto(0);dialog.current?.showModal();void dataApi.moment(selected.id,selected.resourceOwnerId!).then(m=>{if(alive)setDetail(m);}).catch(e=>{if(alive){setDetail(null);setDetailError(e.message||'Memory unavailable.');if([401,403].includes(e.status))deny();}});return()=>{alive=false;};},[selected,detailRetry]);
  const close=()=>{dialog.current?.close();setSelected(null);setDetail(null);opener.current?.focus({preventScroll:true});};
  const open=(m:TimelineEvent,el:HTMLElement)=>{opener.current=el;setSelected(m);};
  const reset=()=>{setTrack('');setSearch('');setQuery('');setFrom('');setTo('');setCursor(null);};
  const trackFor=(m:TimelineEvent)=>tracks.find(t=>t.id===m.eventId&&t.resourceOwnerId===m.resourceOwnerId)?.title??'Track unavailable';
  const meta=(m:TimelineEvent)=><div className="pd-meta"><span className="pd-tag"><Layers size={15}/>{trackFor(m)}</span><span>{m.date||'Undated'}{m.time?` · ${m.time}`:''}</span>{m.isMilestone&&<span>Milestone</span>}<span>{m.images.length} photo{m.images.length===1?'':'s'}</span></div>;
  const card=(m:TimelineEvent,i:number)=><article key={`${m.resourceOwnerId}:${m.id}`} className={`pd-card ${i===0?'pd-feature':''} ${!m.images.length?'pd-text':''}`} data-memory={m.id}>
    {m.images[0]&&<button className="pd-photo" aria-label={`View photos: ${m.title||'Untitled memory'}`} onClick={e=>open(m,e.currentTarget)}><PrivateImage src={m.images[0]} variant="thumb" alt={m.title||'Memory photo'} fit="cover"/></button>}
    <div className="pd-card-content"><button className="pd-title" onClick={e=>open(m,e.currentTarget)}><h2>{m.title||'Untitled memory'}</h2></button>{!m.images.length&&<p className="pd-excerpt">{m.description||m.idea||'No description'}</p>}{meta(m)}</div></article>;
  return <main className="photo-diary" data-photo-diary>
    <header className="pd-header"><a className="pd-brand" href="/"><Leaf size={27}/>Memento</a><nav aria-label="Preview navigation"><span aria-current="page">Memories</span><span title="Unavailable in this preview">Rediscover <small>unavailable</small></span><span title="Unavailable in this preview">Library <small>unavailable</small></span></nav><a className="pd-return" href="/"><ArrowLeft size={18}/>Back to app</a></header>
    <div className="pd-notice">Photo Diary · Read-only design preview <span>Creating, editing, sharing and reactions are available only in the normal app.</span></div>
    <h1>The days worth keeping</h1>
    {session!=='ready'?<section className="pd-state" role="status"><h2>{session==='checking'?'Checking your session…':session==='error'?'Unable to check your session':'Your memories stay private'}</h2><p>{session==='checking'?'Please wait.':'Sign in using the normal app, then return to this preview. No data is shown without an authorized DEV session.'}</p>{session!=='checking'&&<><a href="/">Open normal app / sign in</a><button onClick={()=>window.location.reload()}>Retry session</button></>}</section>:<>
    <form className="pd-toolbar" onSubmit={e=>e.preventDefault()} aria-label="Filter memories">
      <label className="pd-track"><Layers size={20}/><span className="pd-sr">Track</span><select aria-label="Track" value={track} onChange={e=>{setTrack(e.target.value);setCursor(null);}}><option value="">All tracks</option>{tracks.map(t=><option key={trackIdentity(t)} value={trackIdentity(t)}>{t.title}</option>)}</select></label>
      <label className="pd-search"><Search size={20}/><input aria-label="Search memories" placeholder="Search memories…" value={search} onChange={e=>setSearch(e.target.value)}/></label>
      <fieldset><legend><CalendarDays size={17}/> Date range</legend><label><span>From</span><input aria-label="From date" type="date" value={from} onChange={e=>{setFrom(e.target.value);setCursor(null);}}/></label><label><span>To</span><input aria-label="To date" type="date" value={to} onChange={e=>{setTo(e.target.value);setCursor(null);}}/></label></fieldset>
    </form><div className="pd-results"><span>{busy?'Loading memories…':total!==null?`${total} matching memories · newest first`:'Newest first'} · up to 12 per page</span><button onClick={reset}>Clear filters</button></div>
    {busy?<section className="pd-state" role="status">Loading your memories…</section>:error?<section className="pd-state" role="alert"><p>{error}</p><button onClick={()=>setRetry(n=>n+1)}>Retry</button></section>:!items.length?<section className="pd-state" role="status"><h2>No memories here yet</h2><p>Try another track, search or date range.</p><button onClick={reset}>Reset filters</button></section>:<><div className="pd-grid">{items.slice(0,4).map(card)}</div>{items.length>4&&<div className="pd-more-grid">{items.slice(4).map((m,i)=>card(m,i+4))}</div>}<footer className="pd-pager"><span>Editorial sizing follows chronology, not pinned status.</span>{cursor&&<button onClick={()=>setCursor(null)}>Newest page</button>}{next&&<button onClick={()=>{setCursor(next);window.scrollTo({top:0,behavior:'instant'});}}>Next page</button>}</footer></>}
    </>}
    <dialog ref={dialog} className="pd-dialog" aria-label="Read-only memory detail" onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target===e.currentTarget)close();}} onKeyDown={e=>{if(e.key==='Tab'){const controls=Array.from(dialog.current!.querySelectorAll<HTMLElement>('button,a,input,select')).filter(el=>!el.hasAttribute('disabled'));const first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}}}>
      <div className="pd-detail"><header><span>Read-only memory</span><button autoFocus aria-label="Close detail" onClick={close}><X size={22}/></button></header>{detailError?<div role="alert"><p>{detailError}</p><button onClick={()=>setDetailRetry(n=>n+1)}>Retry detail</button></div>:!detail?<p role="status">Loading memory…</p>:<>
      {detail.images.length>0&&<><div className="pd-detail-photo"><PrivateImage key={detail.images[photo]} src={detail.images[photo]} variant="display" alt={detail.title||'Memory photo'} fit="contain"/></div><div className="pd-photo-controls"><button disabled={photo===0} onClick={()=>setPhoto(n=>n-1)}>Previous photo</button><span>{photo+1} / {detail.images.length}</span><button disabled={photo===detail.images.length-1} onClick={()=>setPhoto(n=>n+1)}>Next photo</button></div></>}
      <h2>{detail.title||'Untitled memory'}</h2>{meta(detail)}<p className="pd-body">{detail.description}</p>{detail.idea&&<blockquote>{detail.idea}</blockquote>}{detail.location&&<p>Location: {detail.location.name}</p>}{detail.tags.length>0&&<p>Tags: {detail.tags.join(', ')}</p>}<p className="pd-detail-note">Editing, reactions, perspectives and original downloads are unavailable in this preview. <a href="/">Return to the normal app</a>.</p></>}
      </div></dialog>
  </main>;
}
