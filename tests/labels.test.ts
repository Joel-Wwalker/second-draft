import { expect, test } from 'vitest';
import { engineLabel } from '../src/shared/labels';

test('labels known kinds and appends the model when present', () => {
  expect(engineLabel({ kind: 'rules' })).toBe('Quick clean (no AI engine available)');
  expect(engineLabel({ kind: 'fake', model: 'fake-echo' })).toBe('Test engine (fake-echo)');
});

test('falls back to the raw kind for unknown values', () => {
  expect(engineLabel({ kind: 'mystery' as never })).toBe('mystery');
  expect(engineLabel({ kind: 'byok' })).toBe('Your API key');
});
