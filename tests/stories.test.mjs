import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStory, storyOperationKey, storyHash } from '../story-validation.mjs';
const body=()=>({trackId:'t',title:' A story ',opening:'',closing:'',items:[{itemId:'a',momentId:'m',note:''}]});
test('story validation rejects PostgreSQL-incompatible Unicode in every text field',()=>{
 for(const text of ['a\u0000b','a\ud800b','a\udc00b']) {
  for(const field of ['trackId','title','opening','closing']) assert.throws(()=>validateStory({...body(),[field]:text}),e=>e.status===400);
  for(const field of ['itemId','momentId','note']) assert.throws(()=>validateStory({...body(),items:[{...body().items[0],[field]:text}]}),e=>e.status===400);
 }
 assert.equal(validateStory({...body(),title:'A 😀 story'}).title,'A 😀 story');
});
test('story validation canonicalizes exact bounded document and preserves order',()=>{
 assert.equal(validateStory(body()).title,'A story');
 const a=body();a.items.push({itemId:'b',momentId:'n',note:'bridge'});assert.deepEqual(validateStory(a).items.map(i=>i.momentId),['m','n']);
 for(const patch of [{title:''},{title:'x'.repeat(121)},{opening:'x'.repeat(4001)},{items:[]},{items:Array.from({length:51},(_,n)=>({itemId:String(n),momentId:String(n),note:''}))},{items:[...a.items,a.items[0]]},{trackId:3},{objectKey:'private'}]) assert.throws(()=>validateStory({...body(),...patch}),e=>e.status===400);
 assert.throws(()=>validateStory({...body(),items:[{itemId:'a',momentId:'m',note:'x'.repeat(2001)}]}),e=>e.status===400);
 assert.equal(storyHash(validateStory(body())),storyHash(validateStory({...body(),title:'A story'})));
 assert.throws(()=>storyOperationKey('bad'),e=>e.status===400);assert.equal(storyOperationKey('operation-123'),'operation-123');
});
