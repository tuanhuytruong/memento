import { useEffect, useState } from 'react';
import type { StorySummary } from '../types';
import { storiesApi } from './storiesApi';
export function useStoryLibrary(ownerId:string,trackId:string,generation:number){
 const scope=JSON.stringify([ownerId,trackId,generation]);
 const [position,setPosition]=useState<{scope:string;cursor:string|null}>({scope,cursor:null}),[retry,setRetry]=useState(0);
 const cursor=position.scope===scope?position.cursor:null;
 const setCursor=(value:string|null)=>setPosition({scope,cursor:value});
 const [state,setState]=useState<{scope:string;stories:StorySummary[];nextCursor:string|null;loading:boolean;error:string}>({scope:'',stories:[],nextCursor:null,loading:false,error:''});
 useEffect(()=>{
  if(!ownerId||!trackId)return;const controller=new AbortController();
  setState({scope,stories:[],nextCursor:null,loading:true,error:''});
  storiesApi.query(ownerId,trackId,cursor,controller.signal).then(page=>{if(!controller.signal.aborted)setState({scope,...page,loading:false,error:''});}).catch(error=>{if(!controller.signal.aborted)setState({scope,stories:[],nextCursor:null,loading:false,error:error instanceof Error?error.message:'Could not load stories.'});});
  return()=>controller.abort();
 },[scope,ownerId,trackId,cursor,retry]);
 return {...(state.scope===scope?state:{stories:[],nextCursor:null,loading:!!trackId,error:''}),next:()=>setCursor(state.nextCursor),first:()=>{setCursor(null);setRetry(n=>n+1);},retry:()=>setRetry(n=>n+1),hasPrevious:cursor!==null};
}
