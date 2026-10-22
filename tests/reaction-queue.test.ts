import test from 'node:test';
import assert from 'node:assert/strict';
import { createReactionQueue } from '../src/lib/reactionQueue';
import { setReactionState } from '../src/lib/reactionState';
import type { MemoryReaction } from '../src/types';
const gate = () => { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; };
test('serial rapid same/different emoji rebases authoritative counts without flashing older intent', async () => {
  let server: MemoryReaction[] = []; let shown: MemoryReaction[] = []; const hold = gate(); let calls = 0;
  const queue = createReactionQueue([], async (emoji, active) => { calls++; if (calls === 1) await hold.promise; server = setReactionState(server, emoji, active); return [...server, { emoji: '🎉', selected: false, count: 7, usernames: ['other'] }]; }, state => { shown = state; }, () => true);
  const a = queue.enqueue('❤️', true); const b = queue.enqueue('❤️', false); const c = queue.enqueue('😂', true);
  assert.equal(calls, 1); assert.equal(shown.some(r => r.emoji === '❤️'), false); assert.equal(shown.find(r => r.emoji === '😂')?.selected, true);
  hold.release(); await Promise.all([a,b,c]); assert.equal(calls, 3); assert.equal(shown.find(r => r.emoji === '🎉')?.count, 7); assert.equal(shown.find(r => r.emoji === '😂')?.selected, true); assert.equal(shown.some(r => r.emoji === '❤️'), false);
});
test('failed earlier write cannot roll back later intent; exact desired retry succeeds', async () => {
  const hold = gate(); let calls = 0; let shown: MemoryReaction[] = []; let server: MemoryReaction[] = [];
  const queue = createReactionQueue([], async (emoji, active) => { if (++calls === 1) { await hold.promise; throw new Error('failure'); } server = setReactionState(server, emoji, active); return server; }, state => { shown = state; }, () => true);
  const failed = assert.rejects(queue.enqueue('❤️', true), /failure/); const next = queue.enqueue('😂', true); hold.release(); await Promise.all([failed, next]); assert.equal(shown.find(r => r.emoji === '😂')?.selected, true); assert.equal(shown.some(r => r.emoji === '❤️'), false); await queue.enqueue('❤️', true); assert.equal(shown.find(r => r.emoji === '❤️')?.selected, true);
});
test('session invalidation suppresses stale publication and queued writes', async () => {
  const hold = gate(); let valid = true; let calls = 0; let paints = 0;
  const queue = createReactionQueue([], async () => { calls++; await hold.promise; return []; }, () => { paints++; }, () => valid);
  const a = assert.rejects(queue.enqueue('❤️', true), /Session changed/); const b = assert.rejects(queue.enqueue('😂', true), /Session changed/); const before = paints; valid = false; hold.release(); await Promise.all([a,b]); assert.equal(calls, 1); assert.equal(paints, before);
});
