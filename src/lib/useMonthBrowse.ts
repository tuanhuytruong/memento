import {useEffect,useRef,useState} from 'react';
import {dataApi,type BrowseMonths,type BrowsePage} from './api';
import {selectAvailableMonth} from './monthBrowse';
import {feedScopeHash,type MomentFeedQuery} from './useMomentFeed';
/** Independent ephemeral browser. Cache and every asynchronous state update belong to one opening/scope. */
export function useMonthBrowse(open:boolean,query:MomentFeedQuery,generation:number,initialMonth:string){
 const scope=feedScopeHash(query,generation);const current=useRef('');current.current=`${open}:${scope}`;
 const [metadata,setMetadata]=useState<BrowseMonths|null>(null);const [month,setMonth]=useState(initialMonth);
 const [page,setPage]=useState<BrowsePage|null>(null);const [offset,setOffset]=useState(0);const [metadataLoading,setMetadataLoading]=useState(false);const [previewLoading,setLoading]=useState(false);const [error,setError]=useState('');const [metadataError,setMetadataError]=useState('');const [year,setYear]=useState(initialMonth==='undated'?'':initialMonth.slice(0,4));const [revision,setRevision]=useState(0);
 const metaController=useRef<AbortController|null>(null), previewController=useRef<AbortController|null>(null);const sequence=useRef(0);const cache=useRef(new Map<string,BrowsePage>());
 const valid=(key:string,signal:AbortSignal)=>current.current===key&&!signal.aborted;
 useEffect(()=>{setMetadata(null);setPage(null);setError('');setYear(initialMonth==='undated'?'':initialMonth.slice(0,4));cache.current.clear();setMonth(initialMonth);setOffset(0);return()=>{metaController.current?.abort();previewController.current?.abort();sequence.current++;};},[open,scope]);
 useEffect(()=>{if(!open)return;const controller=new AbortController();metaController.current?.abort();metaController.current=controller;const key=`true:${scope}`;
  setMetadataLoading(true);setMetadataError('');dataApi.browseMonths({...query,limit:120,...(year?{year}:{})},controller.signal).then(result=>{if(!valid(key,controller.signal))return;setMetadata(result);setMonth(old=>selectAvailableMonth([...result.months.map(m=>m.key),...(result.undatedCount?['undated']:[])],old,query.sortDirection??'newest')??'undated');}).catch(e=>{if(valid(key,controller.signal))setMetadataError(e.message);}).finally(()=>{if(valid(key,controller.signal))setMetadataLoading(false);});return()=>controller.abort();
 },[open,scope,year,revision]);
 async function load(selected:string,cursor:string|null=null,navigation:'next'|'previous'='next',nextOffset=0){
  previewController.current?.abort();const controller=new AbortController();previewController.current=controller;const id=++sequence.current;const key=`true:${scope}`;const cacheKey=`${selected}:${navigation}:${cursor??''}`;
  setLoading(true);setError('');try{let result=cache.current.get(cacheKey);if(result){cache.current.delete(cacheKey);cache.current.set(cacheKey,result);}if(!result){result=await dataApi.browsePreview({...query,month:selected,limit:24,cursor,navigation},controller.signal);if(!valid(key,controller.signal)||id!==sequence.current)return;cache.current.set(cacheKey,result);while(cache.current.size>3)cache.current.delete(cache.current.keys().next().value!);}
   if(!valid(key,controller.signal)||id!==sequence.current)return;setPage(result);setOffset(nextOffset);
  }catch(e){if(valid(key,controller.signal)&&id===sequence.current)setError(e instanceof Error?e.message:'Preview unavailable');}finally{if(valid(key,controller.signal)&&id===sequence.current)setLoading(false);}
 }
 useEffect(()=>{setPage(null);setOffset(0);cache.current.clear();if(open&&metadata)void load(month);return()=>previewController.current?.abort();},[open,scope,month,metadata]);
 const choose=(value:string)=>{if(value!==month){previewController.current?.abort();setMonth(value);}};
 const metadataPage=async(navigation:'next'|'previous')=>{const cursor=navigation==='next'?metadata?.nextCursor:metadata?.previousCursor;if(!cursor)return;metaController.current?.abort();const controller=new AbortController();metaController.current=controller;const key=`true:${scope}`;setMetadataLoading(true);setMetadataError('');try{const result=await dataApi.browseMonths({...query,limit:120,...(year?{year}:{}),cursor,navigation},controller.signal);if(valid(key,controller.signal)){setMetadata(result);choose(result.months[0]?.key??'undated');}}catch(e){if(valid(key,controller.signal))setMetadataError(e instanceof Error?e.message:'Months unavailable');}finally{if(valid(key,controller.signal))setMetadataLoading(false);}};
 return {metadata,month,page,offset,loading:metadataLoading||previewLoading,error:metadataError||error,year,setYear:(value:string)=>{metaController.current?.abort();previewController.current?.abort();sequence.current++;setYear(value);},choose,metadataPage,retry:()=>{if(metadata&&!metadataError)void load(month);else setRevision(v=>v+1);},next:()=>page?.nextCursor&&load(month,page.nextCursor,'next',offset+24),previous:()=>page?.previousCursor&&load(month,page.previousCursor,'previous',Math.max(0,offset-24))};
}
