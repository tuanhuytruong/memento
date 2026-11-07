import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addStoryMoment, moveStoryItem, validateStoryDraft, storyPayload } from '../src/lib/storyDraft';
const moment = (id:string,date:string) => ({id,date,eventId:'track',title:id,description:'',images:[],tags:[],createdAt:date,updatedAt:date});
test('selection initially sorts oldest first and deduplicates without losing item identity',()=>{
 let draft:any={trackId:'track',title:'Story',opening:'',closing:'',items:[]};
 draft=addStoryMoment(draft,moment('b','2026-02-01'),'b'); draft=addStoryMoment(draft,moment('a','2026-01-01'),'a');
 assert.deepEqual(draft.items.map((i:any)=>i.momentId),['a','b']);
 assert.equal(addStoryMoment(draft,moment('a','2026-01-01'),'duplicate').items.length,2);
 const reordered=moveStoryItem(draft,0,1); assert.deepEqual(reordered.items.map((i:any)=>i.itemId),['b','a']);
 assert.deepEqual(moveStoryItem(draft,0,-1),draft);
});
test('validates bounds, unique identities, and strips live memory projection from wire payload',()=>{
 const draft:any={trackId:'track',title:'Story',opening:'',closing:'',items:[{itemId:'x',momentId:'a',note:'bridge',moment:moment('a','2026-01-01')}]};
 assert.equal(validateStoryDraft(draft),null);
 assert.deepEqual(storyPayload(draft).items,[{itemId:'x',momentId:'a',note:'bridge'}]);
 assert.match(validateStoryDraft({...draft,title:' '})!,/title/i);
 assert.match(validateStoryDraft({...draft,items:[]})!,/1.*50/);
 assert.match(validateStoryDraft({...draft,items:[...draft.items,...draft.items]})!,/unique/i);
 assert.match(validateStoryDraft({...draft,opening:'x'.repeat(4001)})!,/4,000/);
 assert.match(validateStoryDraft({...draft,items:[{...draft.items[0],note:'x'.repeat(2001)}]})!,/2,000/);
});
