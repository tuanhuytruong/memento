import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLetter,validateLetterSchedule,letterState} from '../future-letter-validation.mjs';
test('strict draft text/photo validation and exact IANA schedule',()=>{
 assert.equal(validateLetter({title:' hi ',body:'text',photos:[]}).title,'hi');
 for(const value of [{title:'',body:'x'},{title:'x',body:'x\u0000'},{title:'x',body:'x\ud800'},{title:'x',body:'x',photos:Array(7).fill({momentId:'m',imageId:'i'})},{title:'x',body:'x',key:'secret'}])assert.throws(()=>validateLetter(value),e=>e.status===400);
 const good={releaseAt:'2030-11-03T05:30:00.000Z',timezone:'America/New_York',localTime:'2030-11-03T01:30',offsetMinutes:-240};
 assert.equal(validateLetterSchedule(good).releaseAt,good.releaseAt);
 for(const v of [{...good,offsetMinutes:-300},{...good,timezone:'bogus'},{...good,localTime:'2030-03-10T02:30'},{...good,releaseAt:'2030-11-03T05:30:00.001Z'}])assert.throws(()=>validateLetterSchedule(v),e=>e.status===400);
 for(const timezone of ['+01:00','+0100','+01','-05:00','+00:00'])assert.throws(()=>validateLetterSchedule({releaseAt:'2030-01-01T00:00:00.000Z',timezone,localTime:'2030-01-01T01:00',offsetMinutes:60}),e=>e.status===400);
 for(const timezone of ['UTC','Etc/UTC','GMT','US/Eastern']){
  const eastern=timezone==='US/Eastern';assert.equal(validateLetterSchedule({releaseAt:'2030-01-01T00:00:00.000Z',timezone,localTime:eastern?'2029-12-31T19:00':'2030-01-01T00:00',offsetMinutes:eastern?-300:0}).timezone,timezone);
 }
 assert.equal(letterState({sealed_at:'x',release_at:'2030-01-01T00:00:00Z'},Date.parse('2030-01-01T00:00:00Z')),'ready');
});

import {encodeStoryCursor,decodeStoryCursor} from '../story-queries.mjs';
import {queryLetters,encodeLetterCursor,decodeLetterCursor} from '../future-letter-queries.mjs';
import {randomUUID} from 'node:crypto';
test('letter cursor signatures reject forgery and existing story/feed navigation domains',async()=>{
 const user=randomUUID(),secret='x'.repeat(40),scope={userId:user,trackOwnerId:user,trackId:'future-letters-v1:null'},payload={...scope,id:randomUUID(),updatedAt:'2030-01-01T00:00:00.000001Z',expiresAt:Date.now()+10000};
 const letterScope={userId:user,state:null},letterPayload={...letterScope,id:payload.id,updatedAt:payload.updatedAt,expiresAt:payload.expiresAt};
 const valid=encodeLetterCursor(letterPayload,secret);
 assert.equal(decodeLetterCursor(valid,letterScope,secret).updatedAt,payload.updatedAt);
 assert.throws(()=>decodeStoryCursor(valid,scope,secret),e=>e.status===400);
 for(const timezone of ['Etc/GMT-1','Asia/Bangkok'])assert.equal(validateLetterSchedule({releaseAt:'2030-01-01T00:00:00Z',timezone,localTime:timezone==='Etc/GMT-1'?'2030-01-01T01:00':'2030-01-01T07:00',offsetMinutes:timezone==='Etc/GMT-1'?60:420}).timezone,timezone);
 assert.throws(()=>validateLetterSchedule({releaseAt:'2030-02-30T00:00:00Z',timezone:'UTC',localTime:'2030-03-02T00:00',offsetMinutes:0}),e=>e.status===400);
 for(const token of [valid+'x',encodeLetterCursor({...letterPayload,userId:randomUUID()},secret),encodeLetterCursor({...letterPayload,state:'draft'},secret),encodeLetterCursor({...letterPayload,expiresAt:0},secret),encodeLetterCursor({...letterPayload,id:'invalid'},secret),encodeLetterCursor({...letterPayload,updatedAt:'invalid'},secret)])assert.throws(()=>decodeLetterCursor(token,letterScope,secret),e=>e.status===400);
 const never={query(){throw new Error('unexpected DB');}};
 for(const token of [encodeStoryCursor(payload,secret),encodeStoryCursor({...payload,trackId:'story-track'},secret),encodeStoryCursor(payload,secret)+'x',encodeStoryCursor({...payload,userId:randomUUID()},secret),encodeStoryCursor({...payload,expiresAt:0},secret)])await assert.rejects(queryLetters(never,user,{cursor:token},'pg_temp',secret),e=>e.status===400);
});
