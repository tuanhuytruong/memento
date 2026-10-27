import test from 'node:test';
import assert from 'node:assert/strict';
import { recentReactorText, reactionSummaryLabel } from '../src/lib/reactionPresentation';

const reaction = (count: number, usernames: string[]) => ({ emoji: '❤️' as const, count, usernames, selected: false });
test('recent reactor text is empty for no reactions and includes one through five in supplied recency order', () => {
  assert.equal(recentReactorText(reaction(0, [])), '');
  assert.equal(recentReactorText(reaction(1, ['Newest'])), 'Newest');
  assert.equal(recentReactorText(reaction(5, ['Five', 'Four', 'Three', 'Two', 'One'])), 'Five, Four, Three, Two, One');
});
test('recent reactor text bounds names and derives overflow from count', () => {
  assert.equal(recentReactorText(reaction(7, ['Seven', 'Six', 'Five', 'Four', 'Three', 'Two', 'One'])), 'Seven, Six, Five, Four, Three, and 2 more');
  assert.equal(recentReactorText(reaction(9, ['Same', 'Same', 'Other'])), 'Same, Same, Other, and 6 more');
  assert.equal(recentReactorText(reaction(3, ['Newest', 'Older', 'Oldest', 'Stale'])), 'Newest, Older, Oldest');
  assert.match(reactionSummaryLabel(reaction(7, ['Seven', 'Six', 'Five', 'Four', 'Three', 'Two', 'One'])), /Seven, Six, Five, Four, Three, and 2 more$/);
});
