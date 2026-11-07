import type { StoryDraft, TimelineEvent } from '../types';
import { compareMoments } from './momentFilters';
export function addStoryMoment(draft:StoryDraft,moment:TimelineEvent,itemId:string):StoryDraft {
 if(draft.items.some(item=>item.momentId===moment.id)||draft.items.length>=50)return draft;
 return {...draft,items:[...draft.items,{itemId,momentId:moment.id,note:'',moment}].sort((a,b)=>a.moment&&b.moment?compareMoments(a.moment,b.moment,'oldest'):0)};
}
export function moveStoryItem(draft:StoryDraft,index:number,delta:number):StoryDraft {
 const target=index+delta;if(index<0||target<0||index>=draft.items.length||target>=draft.items.length)return draft;
 const items=[...draft.items];[items[index],items[target]]=[items[target],items[index]];return {...draft,items};
}
export function validateStoryDraft(draft:StoryDraft):string|null {
 if(!draft.title.trim()||draft.title.trim().length>120)return 'A title of 1–120 characters is required.';
 if(draft.opening.length>4000||draft.closing.length>4000)return 'Opening and closing notes must be at most 4,000 characters.';
 if(draft.items.length<1||draft.items.length>50)return 'Choose 1–50 memories.';
 if(new Set(draft.items.map(i=>i.momentId)).size!==draft.items.length||new Set(draft.items.map(i=>i.itemId)).size!==draft.items.length)return 'Each memory and item identity must be unique.';
 if(draft.items.some(i=>i.note.length>2000))return 'Bridge notes must be at most 2,000 characters.';
 return null;
}
export function storyPayload(draft:StoryDraft){return {trackId:draft.trackId,title:draft.title.trim(),opening:draft.opening,closing:draft.closing,items:draft.items.map(({itemId,momentId,note})=>({itemId,momentId,note}))};}
