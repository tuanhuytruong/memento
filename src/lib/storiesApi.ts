import { request, dataApi } from './api';
import type { StoryDetail, StoryDraft, StorySummary } from '../types';
import { storyPayload } from './storyDraft';
const path=(id:string)=>`/stories/${encodeURIComponent(id)}`;
export const storiesApi={
 query:(trackOwnerId:string,trackId:string,cursor:string|null,signal:AbortSignal)=>request<{stories:StorySummary[];nextCursor:string|null}>('/stories/query',{method:'POST',body:JSON.stringify({trackOwnerId,trackId,cursor,limit:20}),signal}),
 detail:(id:string,trackOwnerId:string,trackId:string,signal?:AbortSignal)=>request<StoryDetail>(`${path(id)}?${new URLSearchParams({trackOwnerId,trackId})}`,{signal}),
 create:(draft:StoryDraft,key:string,signal:AbortSignal)=>request<StoryDetail>('/stories',{method:'POST',headers:{'Idempotency-Key':key},body:JSON.stringify(storyPayload(draft)),signal}),
 update:(id:string,draft:StoryDraft,expectedVersion:number,signal:AbortSignal)=>request<StoryDetail>(path(id),{method:'PUT',body:JSON.stringify({...storyPayload(draft),expectedVersion}),signal}),
 remove:(id:string,expectedVersion:number,signal:AbortSignal)=>request(path(id),{method:'DELETE',body:JSON.stringify({expectedVersion}),signal}),
 picker:(ownerId:string,trackId:string,search:string,cursor:string|null,signal:AbortSignal)=>dataApi.queryMoments({trackKey:`${ownerId}:${trackId}`,search,cursor,limit:40,sortDirection:'oldest'},signal),
};
