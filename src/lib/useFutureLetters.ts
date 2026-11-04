import { useCallback, useEffect, useRef, useState } from 'react';
import { futureLettersApi } from './futureLettersApi';
import type { FutureLetter } from '../types';
export function useFutureLetters(owner:string,generation:number){
 const [letters,setLetters]=useState<FutureLetter[]>([]),[cursor,setCursor]=useState<string|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const scope=`${owner}:${generation}`,latest=useRef(scope);latest.current=scope;
 const request=useRef<AbortController|null>(null),retryCursor=useRef<string|null>(null);
 const load=useCallback(async(next:string|null=null)=>{request.current?.abort();const controller=new AbortController();request.current=controller;retryCursor.current=next;const captured=scope;setLoading(true);setError('');
 const current=()=>!controller.signal.aborted&&latest.current===captured&&request.current===controller;
 try{const page=await futureLettersApi.query(next,controller.signal);if(current()){setLetters(page.letters);setCursor(page.nextCursor);}}catch(e){if(current())setError(e instanceof Error?e.message:'Could not load letters.');}finally{if(current())setLoading(false);}
 },[scope]);
 useEffect(()=>{setLetters([]);setCursor(null);void load();return()=>request.current?.abort();},[load]);
 return {letters,cursor,loading,error,first:()=>void load(),next:()=>void load(cursor),retry:()=>void load(retryCursor.current)};
}
/** A single server-relative foreground timer, never an interval or client unlock. */
export function useFutureLetterSummary(owner:string,generation:number){
 const [readyCount,setReadyCount]=useState(0),[revision,setRevision]=useState(0);
 const scope=`${owner}:${generation}`,latest=useRef(scope);latest.current=scope;
 useEffect(()=>{setReadyCount(0);if(!owner)return;let disposed=false,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|null=null,inflight=false,last=0;
 const refresh=async(force=false)=>{if(disposed||document.visibilityState!=='visible'||inflight||(!force&&Date.now()-last<15000))return;inflight=true;last=Date.now();controller=new AbortController();
 try{const summary=await futureLettersApi.summary(controller.signal);if(disposed||latest.current!==scope)return;setReadyCount(summary.readyCount);clearTimeout(timer);if(summary.nextReleaseAt){const delay=Date.parse(summary.nextReleaseAt)-Date.parse(summary.serverNow)+1000;timer=setTimeout(()=>void refresh(true),Math.max(15000,Math.min(delay,2147483647)));}}
 catch{/* Quiet reminder failure must not disrupt the timeline. */}finally{inflight=false;}};
 const focus=()=>void refresh();void refresh(true);window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
 return()=>{disposed=true;controller?.abort();clearTimeout(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
 },[owner,generation,revision]);
 return {readyCount,refresh:()=>setRevision(n=>n+1)};
}
