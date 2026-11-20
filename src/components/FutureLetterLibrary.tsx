import { lazy, Suspense, useEffect, useRef, useState, type RefObject } from 'react';
import type { EventTrack, FutureLetter } from '../types';
import { futureLettersApi } from '../lib/futureLettersApi';
import { request as apiRequest } from '../lib/api';
import { Lock, Mail, MailOpen, Plus, Stamp } from 'lucide-react';
import { ArchivalLibraryFrame, libraryButton as button, libraryPrimary, libraryCard } from './ArchivalLibraryFrame';
const Composer=lazy(()=>import('./FutureLetterComposer').then(m=>({default:m.FutureLetterComposer})));
const Reader=lazy(()=>import('./FutureLetterReader').then(m=>({default:m.FutureLetterReader})));
const folders = [['all','All'],['ready','Ready to open'],['sealed','Sealed'],['draft','Drafts'],['opened','Opened']] as const;
type Folder = typeof folders[number][0];
const styles = {
 draft: {Icon:Mail, label:'Draft', action:'Preview draft'},
 sealed: {Icon:Lock, label:'Sealed capsule', action:'Sealed envelope'},
 ready: {Icon:Stamp, label:'Ready to unseal', action:'Break seal & open'},
 opened: {Icon:MailOpen, label:'Opened letter', action:'Read opened letter'},
};
function releaseTime(letter: FutureLetter) {
 return letter.releaseAt ? `${new Date(letter.releaseAt).toLocaleString(undefined,{timeZone:letter.timezone||undefined})}${letter.timezone ? ` · ${letter.timezone}` : ''}` : 'No opening time set';
}
function useLetterFolder(folder: Folder) {
 const [cursor,setCursor]=useState<string|null>(null),[revision,refresh]=useState(0);
 const [result,setResult]=useState<{folder:Folder;cursor:string|null;revision:number;letters:FutureLetter[];nextCursor:string|null;error?:string}|null>(null);
 useEffect(()=>{
   const controller=new AbortController();
   const query={cursor,limit:20,...(folder==='all'?{}:{state:folder})};
   apiRequest<{letters:FutureLetter[];nextCursor:string|null}>('/future-letters/query',{method:'POST',body:JSON.stringify(query),signal:controller.signal}).then(page=>{
     if(!controller.signal.aborted)setResult({folder,cursor,revision,...page});
   },failure=>{
     if(!controller.signal.aborted)setResult({folder,cursor,revision,letters:[],nextCursor:null,error:failure instanceof Error?failure.message:'Could not load letters.'});
   });
   return ()=>controller.abort();
 },[folder,cursor,revision]);
 const page=result?.folder===folder&&result.cursor===cursor&&result.revision===revision?result:null;
 return {letters:page?.letters??[],cursor:page?.nextCursor,loading:!page,error:page?.error,first:()=>{setCursor(null);refresh(n=>n+1);},next:()=>{if(page?.nextCursor)setCursor(page.nextCursor);},retry:()=>refresh(n=>n+1)};
}
type Props = {tracks:EventTrack[];currentUserId:string;generation:number;workspace?:boolean;leaveGuard?:RefObject<(()=>boolean)|null>;onClose:()=>void;onChanged:()=>void};
export function FutureLetterLibrary(props: Props) {
 return <FutureLetterSession key={`${props.currentUserId}:${props.generation}`} {...props}/>;
}
function FutureLetterSession({tracks,currentUserId,generation,onClose,onChanged,workspace=false,leaveGuard}:Props){
 const [folder,setFolder]=useState<Folder>('all');
 const library=useLetterFolder(folder),[mode,setMode]=useState<'library'|'compose'|'read'>('library'),[detail,setDetail]=useState<FutureLetter|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false);
 const dirty=useRef(false),pending=useRef(false),alive=useRef(true),request=useRef<AbortController|null>(null),openOperations=useRef(new Map<string,string>());
 const scope=`${currentUserId}:${generation}`,latest=useRef(scope);latest.current=scope;
 const setPending=(v:boolean)=>{pending.current=v;setBusy(v);};
 const canLeave=()=>!pending.current&&(!dirty.current||window.confirm('Discard unsaved letter changes?'));
 // Navigation is a request boundary, independently of account identity.
 const invalidate=()=>{request.current?.abort();request.current=null;dirty.current=false;setLoading(false);setError('');setPending(false);};
 const transition=(next:'library'|'compose'|'read',letter:FutureLetter|null=null)=>{invalidate();setDetail(letter);setMode(next);};
 const close=()=>{if(workspace){back();return;}if(canLeave()){invalidate();onClose();}};
 useEffect(()=>{if(!workspace||!leaveGuard)return;leaveGuard.current=canLeave;return()=>{if(leaveGuard.current===canLeave)leaveGuard.current=null;};},[workspace,leaveGuard]);
 const newLetter=useRef<HTMLButtonElement>(null),returned=useRef(false);
 useEffect(()=>{if(workspace&&mode==='library'&&returned.current){returned.current=false;newLetter.current?.focus({preventScroll:true});}},[mode,workspace]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current?.abort();};},[]);
 useEffect(()=>{request.current?.abort();request.current=null;openOperations.current.clear();setDetail(null);setMode('library');setError('');setLoading(false);dirty.current=false;setPending(false);},[scope]);
 const back=()=>{if(!canLeave())return;returned.current=true;transition('library');library.first();onChanged();};
 const read=async(letter:FutureLetter, editDraft=false)=>{if(pending.current||!canLeave())return;invalidate();const abort=new AbortController();request.current=abort;const captured=scope;const current=()=>alive.current&&!abort.signal.aborted&&latest.current===captured&&request.current===abort;setLoading(true);setError('');
 try{let result;if(letter.state==='ready'){setPending(true);let operationId=openOperations.current.get(letter.id);if(!operationId){operationId=crypto.randomUUID();openOperations.current.set(letter.id,operationId);}result=await futureLettersApi.open(letter.id,operationId,abort.signal);}else result=await futureLettersApi.detail(letter.id,abort.signal);if(current()){transition(editDraft&&result.letter.state==='draft'?'compose':'read',result.letter);onChanged();}}
 catch(e){if(current())setError(e instanceof Error?e.message:'Could not open letter. Please retry.');}finally{if(current()){setLoading(false);setPending(false);}}};
 const remove=async()=>{if(!detail||pending.current||!window.confirm('Delete this letter permanently? Its source memories and photos will remain.'))return;const abort=new AbortController();request.current=abort;const captured=scope;const current=()=>alive.current&&!abort.signal.aborted&&latest.current===captured&&request.current===abort;setPending(true);setError('');try{await futureLettersApi.remove(detail.id,detail.version,abort.signal);if(current()){setPending(false);back();}}catch(e){if(current())setError(e instanceof Error?e.message:'Delete failed. Reload and retry.');}finally{if(current())setPending(false);}};
 return <ArchivalLibraryFrame workspace={workspace} composing={mode==='compose'} reading={mode==='read'} busy={busy} name="letters" headingId="letter-heading"
   title={mode==='compose'?'Write a letter':workspace?'Future Letters':'Letters to future me'} eyebrow="Time capsules for later"
   description="Seal private words and photographs for a future date. Nothing opens automatically." onClose={close} onBack={back}
   actions={mode==='library'?<button ref={newLetter} className={libraryPrimary} disabled={busy} onClick={()=>{if(canLeave())transition('compose');}}><Plus size={16} aria-hidden="true"/>{workspace?'Write a letter':'New letter'}</button>:mode==='read'&&detail?<>
     {detail.state==='draft'&&<button disabled={busy} className={button} onClick={()=>{if(canLeave())transition('compose',detail);}}>Edit draft</button>}
     <button disabled={busy} className={button} onClick={()=>void remove()}>Delete letter</button>
   </>:null}>
   <div className={mode==='compose'?'h-full':undefined}>
   {error&&<p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}{loading&&<p role="status">Loading letter…</p>}
   {mode==='library'&&<div className="space-y-6">
     <div role="group" aria-label="Letter folders" className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl bg-linen p-1 dark:bg-stone-800">{folders.map(([value,label])=>
       <button key={value} className={`min-h-11 rounded-lg px-3 text-xs font-medium ${folder===value?'bg-surface text-ink shadow-sm dark:bg-stone-950 dark:text-white':'text-ink-muted hover:bg-surface/50 dark:text-stone-300 dark:hover:bg-stone-950'}`}
         disabled={busy} aria-pressed={folder===value} onClick={()=>{if(folder!==value){invalidate();setFolder(value);library.first();}}}>{label}</button>)}</div>
     {library.loading&&<p role="status">Loading letters…</p>}
     {library.error&&<div role="alert" className="flex flex-wrap items-center gap-2">{library.error}<button className={button} onClick={library.retry}>Retry letters</button></div>}
     {!library.loading&&!library.error&&!library.letters.length&&<div className={`${libraryCard} px-6 py-12 text-center`}>
       <Mail size={28} strokeWidth={1.5} aria-hidden="true" className="mx-auto mb-3 text-ink-muted dark:text-stone-400"/>
       <h2 className="font-display text-2xl">{folder==='all'?'No letters yet':'No letters in this folder'}</h2>
       <p className="mt-2 text-sm text-ink-muted dark:text-stone-400">{folder==='all'?'No letters yet. A text-only letter is enough to begin.':'Choose another folder or write a new letter.'}</p>
     </div>}
     {!!library.letters.length&&<ul className="grid grid-cols-1 gap-5 md:grid-cols-2">{library.letters.map(letter=>{
       const {Icon,label,action:actionLabel}=styles[letter.state];
       const editDraft=workspace&&letter.state==='draft';
       const action=editDraft?'Continue draft':!workspace&&letter.state==='ready'?'Ready to open':actionLabel;
       return <li key={letter.id} className={`${libraryCard} ${letter.state==='ready'?'border-wax/60':letter.state==='sealed'?'bg-linen/60 dark:bg-stone-800':''}`}><article className="flex h-full flex-col gap-4 p-5 sm:p-6">
         <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs"><span className={`inline-flex items-center gap-1.5 font-medium ${letter.state==='ready'?'text-wax dark:text-orange-300':'text-ink-muted dark:text-stone-300'}`}><Icon size={15} aria-hidden="true"/>{label}</span><span className="break-words font-mono text-[11px] text-ink-muted dark:text-stone-400">{releaseTime(letter)}</span></div>
         <h2 className="break-words font-display text-2xl leading-snug">{letter.title}</h2>
         <p className="text-sm text-ink-muted dark:text-stone-300">{letter.state==='sealed'?'Locked until its opening time. ':letter.state==='ready'?'Its opening time has arrived. ':''}{letter.attachmentCount} {letter.attachmentCount===1?'photo':'photos'} enclosed</p>
         <div className="mt-auto border-t border-hairline pt-4 dark:border-stone-700"><button disabled={loading||busy} data-letter-id={letter.id} aria-label={`${action}: ${letter.title}`} className={letter.state==='ready'?`${libraryPrimary} bg-wax hover:bg-wax/90`:button} onClick={()=>void read(letter,editDraft)}>{action}</button></div>
       </article></li>;
     })}</ul>}
     <div className="flex flex-wrap gap-2"><button className={button} disabled={library.loading||busy} onClick={library.first}>Refresh letters</button>{library.cursor&&<button className={button} disabled={library.loading||busy} onClick={library.next}>Next letters</button>}</div>
   </div>}
   <Suspense fallback={<p role="status" className="p-4">Opening letter workspace…</p>}>
     {mode==='compose'&&<Composer key={`${scope}:${detail?.id||'new'}`} scope={scope} isCurrent={()=>alive.current&&latest.current===scope} initial={detail} tracks={tracks.filter(t=>(t.resourceOwnerId||currentUserId)===currentUserId&&t.accessRole==='owner')} onDirty={v=>{if(latest.current===scope)dirty.current=v;}} onBusy={v=>{if(latest.current===scope)setPending(v);}} onSaved={()=>{if(latest.current!==scope)return;dirty.current=false;setPending(false);back();}}/>}
     {mode==='read'&&detail&&(detail.state==='draft'||detail.state==='opened'?<Reader letter={detail}/>:<article className={`${libraryCard} mx-auto max-w-[760px] space-y-4 p-6 sm:p-12`}>
       <p className="inline-flex items-center gap-2 text-sm text-ink-muted dark:text-stone-300"><Lock size={16} aria-hidden="true"/>Sealed capsule</p>
       <h2 tabIndex={-1} ref={node=>node?.focus({preventScroll:true})} className="break-words font-display text-3xl">{detail.title}</h2>
       <p>This sealed letter cannot be edited or opened early. Return after its opening time.</p><p className="font-mono text-xs">{releaseTime(detail)}</p>
     </article>)}
   </Suspense></div>
 </ArchivalLibraryFrame>;
}
