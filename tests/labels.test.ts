import { expect, test } from 'vitest';
import { engineLabel, resultStatus } from '../src/shared/labels';

test('labels known kinds and appends the model when present', () => {
  expect(engineLabel({ kind: 'rules' })).toBe('Quick clean (no AI engine available)');
  expect(engineLabel({ kind: 'fake', model: 'fake-echo' })).toBe('Test engine (fake-echo)');
  expect(engineLabel({ kind: 'nano' })).toBe('On-device AI (Gemini Nano)');
});

test('falls back to the raw kind for unknown values', () => {
  expect(engineLabel({ kind: 'mystery' as never })).toBe('mystery');
  expect(engineLabel({ kind: 'byok' })).toBe('Your API key');
});

test('resultStatus reports changes and the tell score', () => {
  const base = { rewritten: 'x', engine: { kind: 'rules' as const } };
  expect(
    resultStatus({ ...base, changes: [{ range: { start: 0, end: 1 }, reason: 'Reworded' }], tells: { before: 3, after: 1 }, fidelity: [], retried: false }),
  ).toBe('1 change · AI tells: 3 → 1');
  expect(resultStatus({ ...base, changes: [], tells: { before: 0, after: 0 }, fidelity: [], retried: false })).toBe('0 changes · no AI tells detected');
});
