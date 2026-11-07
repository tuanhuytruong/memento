import { request, dataApi } from './api';
import type { FutureLetter, FutureLetterDraft } from '../types';
const path=(id:string)=>`/future-letters/${encodeURIComponent(id)}`;
export const futureLettersApi={
 query:(cursor:string|null,signal:AbortSignal)=>request<{letters:FutureLetter[];nextCursor:string|null}>('/future-letters/query',{method:'POST',body:JSON.stringify({cursor,limit:20}),signal}),
 summary:(signal?:AbortSignal)=>request<{readyCount:number;nextReleaseAt:string|null;serverNow:string}>('/future-letters/summary',{signal}),
 detail:(id:string,signal?:AbortSignal)=>request<{letter:FutureLetter}>(path(id),{signal}),
 create:(draft:FutureLetterDraft,key:string,signal:AbortSignal)=>request<{letter:FutureLetter}>('/future-letters',{method:'POST',headers:{'Idempotency-Key':key},body:JSON.stringify(draft),signal}),
 update:(id:string,draft:FutureLetterDraft,expectedVersion:number,signal:AbortSignal)=>request<{letter:FutureLetter}>(path(id),{method:'PUT',body:JSON.stringify({...draft,expectedVersion}),signal}),
 seal:(id:string,body:Record<string,unknown>,signal:AbortSignal)=>request<{letter:FutureLetter}>(`${path(id)}/seal`,{method:'POST',body:JSON.stringify(body),signal}),
 open:(id:string,operationId:string,signal:AbortSignal)=>request<{letter:FutureLetter}>(`${path(id)}/open`,{method:'POST',body:JSON.stringify({operationId}),signal}),
 remove:(id:string,expectedVersion:number,signal:AbortSignal)=>request(path(id),{method:'DELETE',body:JSON.stringify({expectedVersion}),signal}),
 picker:(trackKey:string,cursor:string|null,signal:AbortSignal)=>dataApi.queryMoments({trackKey,cursor,limit:30,sortDirection:'newest'},signal),
};
