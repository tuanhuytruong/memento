import test from 'node:test';
import assert from 'node:assert/strict';
import { SUN_RAY_LIMIT, sunRayLabel, sunRays } from '../src/components/MonthSunIndex.tsx';
const item=(id:string)=>({ownerId:'owner',id,eventId:'track',date:'2026-10-15',time:null,title:`Title ${id}`,excerpt:'excerpt',thumbUrl:null});
test('sun rays cap each rendered radial page at ten with deterministic positions',()=>{
 const rays=sunRays(Array.from({length:11},(_,i)=>item(String(i))),0);
 assert.equal(SUN_RAY_LIMIT,10); assert.equal(rays.length,10); assert.deepEqual(rays.map(ray=>ray.index),[0,1,2,3,4,5,6,7,8,9]);
 assert.deepEqual(sunRays(Array.from({length:11},(_,i)=>item(String(i))),10).map(ray=>ray.index),[10]);
 assert.match(sunRayLabel(item('x'),2,11),/Memory 2 of 11: 2026-10-15 · Title x/);
});
