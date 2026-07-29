import { expect, test } from 'vitest';
import { formatChanges } from '../src/shared/change-log';
import type { HumanizeResult } from '../src/shared/types';

const base = { engine: { kind: 'rules' as const }, tells: { before: 1, after: 0 }, fidelity: [] };

test('maps changes to before/after rows with reasons', () => {
  const result: HumanizeResult = {
    ...base,
    rewritten: 'We dig into the plan.',
    changes: [{ range: { start: 3, end: 6 }, from: { start: 3, end: 8 }, ruleId: 'ai-vocab', reason: 'AI-associated vocabulary' }],
  };
  expect(formatChanges(result, 'We delve into the plan.')).toEqual([
    { reason: 'AI-associated vocabulary', before: 'delve', after: 'dig' },
  ]);
});

test('labels pure insertions and deletions', () => {
  const result: HumanizeResult = {
    ...base,
    rewritten: 'kept text',
    changes: [
      { range: { start: 4, end: 4 }, from: { start: 4, end: 10 }, reason: 'Reworded' },
      { range: { start: 0, end: 4 }, from: { start: 0, end: 0 }, reason: 'Reworded' },
    ],
  };
  const rows = formatChanges(result, 'kept extra text');
  expect(rows[0]).toEqual({ reason: 'Reworded', before: 'extra', after: '(removed)' });
  expect(rows[1]).toEqual({ reason: 'Reworded', before: '(added)', after: 'kept' });
});

test('long snippets are truncated', () => {
  const long = 'y'.repeat(200);
  const result: HumanizeResult = {
    ...base,
    rewritten: long,
    changes: [{ range: { start: 0, end: 200 }, from: { start: 0, end: 200 }, reason: 'Rewritten' }],
  };
  const [row] = formatChanges(result, long);
  expect(row!.after.length).toBe(90);
  expect(row!.after.endsWith('...')).toBe(true);
});
