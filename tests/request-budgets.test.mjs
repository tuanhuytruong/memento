import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestBudgets} from '../request-budgets.mjs';
function invoke(fn, req) { let passed=false; const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(x){this.body=x;}};fn(req,res,e=>{if(e)throw e;passed=true;});return {passed,res}; }
test('image/read/write quotas isolated per authenticated user; same IP independent accounts',()=>{
 const b=createRequestBudgets({limits:{image:2,write:1,read:1}}),base={user:{id:'a'},ip:'same',method:'GET',path:'/api/images/test'};
 assert.ok(invoke(b.account,base).passed);assert.ok(invoke(b.account,base).passed);
 const denied=invoke(b.account,base);assert.equal(denied.res.statusCode,429);assert.ok(denied.res.headers['Retry-After']);
 assert.ok(invoke(b.account,{...base,method:'POST',path:'/api/moments'}).passed);
 assert.ok(invoke(b.account,{...base,user:{id:'b'}}).passed);
});
test('finite keys and expiring windows',()=>{let time=0;const b=createRequestBudgets({now:()=>time,maxKeys:2,windowMs:1000});for(const id of ['a','b'])assert.ok(invoke(b.account,{user:{id},method:'GET',path:'/api/moments'}).passed);assert.equal(invoke(b.account,{user:{id:'c'},method:'GET',path:'/api/moments'}).res.statusCode,429);time=1001;assert.ok(invoke(b.account,{user:{id:'c'},method:'GET',path:'/api/moments'}).passed);assert.equal(b.stats().keys,1);});
