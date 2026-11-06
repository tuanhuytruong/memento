import test from 'node:test';
import assert from 'node:assert/strict';
import {contentMotion,uiMotion} from '../src/lib/uiMotion';
import {isFeedAccessFailure} from '../src/lib/useMomentFeed';
test('reduced motion has no entering transform or wait',()=>{const m=contentMotion(true);assert.equal(m.initial,false);assert.equal(m.transition.duration,0);assert.deepEqual(m.animate,{opacity:1,y:0});});
test('content motion is a short block fade with bounded travel and no stagger',()=>{const m=contentMotion(false);assert.deepEqual(m.initial,{opacity:0,y:5});assert.deepEqual(m.animate,{opacity:1,y:0});assert.ok(m.transition.duration<=0.18);assert.equal(uiMotion.press,0.12);assert.equal(uiMotion.overlay,0.18);});
for(const status of [401,403,404])test(`authorization ${status} never retains private snapshot`,()=>assert.equal(isFeedAccessFailure({status}),true));
test('transport errors are eligible for explicit retained retry',()=>{assert.equal(isFeedAccessFailure({status:500}),false);assert.equal(isFeedAccessFailure(new Error('offline')),false);});
