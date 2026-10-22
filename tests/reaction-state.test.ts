import test from "node:test";
import assert from "node:assert/strict";
import { setReactionState } from "../src/lib/reactionState";
import type { MemoryReaction } from "../src/types";
const r = (emoji: MemoryReaction["emoji"], count: number, selected = false): MemoryReaction => ({ emoji, count, selected, usernames: ["other"] });
test("optimistic selection increments once and does not mutate input", () => { const before = [r("❤️", 2), r("😂", 1)]; const next = setReactionState(before, "❤️", true); assert.equal(next.find(x => x.emoji === "❤️")?.count, 3); assert.equal(next.find(x => x.emoji === "❤️")?.selected, true); assert.equal(next.find(x => x.emoji === "😂")?.count, 1); assert.equal(before[0].count, 2); assert.notEqual(next, before); });
test("deselection never goes below zero and keeps other reactions", () => { const next = setReactionState([r("❤️", 1, true), r("😂", 2)], "❤️", false); assert.equal(next.find(x => x.emoji === "❤️"), undefined); assert.equal(next.find(x => x.emoji === "😂")?.count, 2); assert.deepEqual(setReactionState([r("❤️", 0, true)], "❤️", false), []); });
test("duplicate desired state is idempotent", () => { assert.equal(setReactionState([r("❤️", 2, true)], "❤️", true)[0].count, 2); assert.equal(setReactionState([r("❤️", 2)], "❤️", false)[0].count, 2); });
