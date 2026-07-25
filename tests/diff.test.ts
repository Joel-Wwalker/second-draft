import { expect, test } from 'vitest';
import { diffChanges, tokenize } from '../src/shared/diff';
import { detect } from '../src/engine/rules';

test('tokenize records char offsets', () => {
  expect(tokenize('ab  cd')[1]).toMatchObject({ text: 'cd', start: 4, end: 6 });
});

test('identical texts produce no changes', () => {
  expect(diffChanges('same text', 'same text', [])).toEqual([]);
});

test('single word replacement yields one Reworded change over the new word', () => {
  const after = 'a X c d';
  const changes = diffChanges('a b c d', after, []);
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({ reason: 'Reworded' });
  expect(after.slice(changes[0]!.range.start, changes[0]!.range.end)).toBe('X');
});

test('changes overlapping a detected tell inherit its rule id and reason', () => {
  const before = 'We delve into the plan.';
  const changes = diffChanges(before, 'We dig into the plan.', detect(before));
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({ ruleId: 'ai-vocab', reason: 'AI-associated vocabulary' });
});

test('pure deletion yields a zero-width change', () => {
  const changes = diffChanges('keep this extra part', 'keep this', []);
  expect(changes).toHaveLength(1);
  expect(changes[0]!.range.start).toBe(changes[0]!.range.end);
});
