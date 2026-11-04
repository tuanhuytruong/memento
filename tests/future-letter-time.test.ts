import test from 'node:test';
import assert from 'node:assert/strict';
import {localTimeCandidates,resolveLocalTime,formatLetterTime} from '../src/lib/futureLetterTime';
test('DST gaps, overlaps, exact offset choice, invalid calendar and formatting',()=>{
 assert.equal(localTimeCandidates('2030-03-10T02:30','America/New_York').length,0);
 const options=localTimeCandidates('2030-11-03T01:30','America/New_York');assert.equal(options.length,2);
 assert.deepEqual(options.map(v=>v.offsetMinutes),[-240,-300]);
 assert.throws(()=>resolveLocalTime('2030-11-03T01:30','America/New_York'));
 assert.equal(resolveLocalTime('2030-11-03T01:30','America/New_York',-300).releaseAt,'2030-11-03T06:30:00.000Z');
 assert.equal(localTimeCandidates('2030-02-30T01:00','UTC').length,0);
 assert.equal(resolveLocalTime('2030-01-01T09:00','Asia/Bangkok').releaseAt,'2030-01-01T02:00:00.000Z');
 for(const zone of ['+01:00','+0100','+01','-05:00','+00:00'])assert.deepEqual(localTimeCandidates('2030-01-01T09:00',zone),[]);
 for(const zone of ['UTC','Etc/UTC','GMT'])assert.equal(resolveLocalTime('2030-01-01T09:00',zone).releaseAt,'2030-01-01T09:00:00.000Z');
 assert.equal(resolveLocalTime('2030-01-01T09:00','Etc/GMT-1').offsetMinutes,60);
 assert.ok(formatLetterTime('2030-01-01T02:00:00Z','Asia/Bangkok').length>5);
});
