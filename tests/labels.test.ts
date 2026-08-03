import { expect, test } from 'vitest';
import { engineLabel, headline, resultStatus } from '../src/shared/labels';

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
  const base = { rewritten: 'x', engine: { kind: 'nano' as const } };
  expect(
    resultStatus({ ...base, changes: [{ range: { start: 0, end: 1 }, reason: 'Reworded' }], tells: { before: 3, after: 1 }, fidelity: [], retried: false, unchanged: false, }),
  ).toBe('1 change · AI tells: 3 → 1');
  expect(resultStatus({ ...base, changes: [], tells: { before: 0, after: 0 }, fidelity: [], retried: false, unchanged: false, })).toBe('0 changes · no AI tells detected');
});

test('the rules fallback is never dressed up as an AI verdict', () => {
  // Five paragraphs of GPT output once came back byte-identical under "Looks
  // human already": the model was unavailable, the rules fallback ran, and the
  // UI reported its mechanical scan as a clean bill of health.
  const rules = {
    rewritten: 'x',
    engine: { kind: 'rules' as const },
    changes: [],
    tells: { before: 0, after: 0 },
    fidelity: [],
    retried: false, unchanged: false,
  };
  expect(headline(rules)).toBe('AI engine unavailable');
  expect(resultStatus(rules)).toBe('0 changes · mechanical fixes only, no AI engine ran');
  // A real engine with the same numbers keeps the honest positive.
  expect(headline({ ...rules, engine: { kind: 'nano' as const } })).toBe('Looks human already');
});

test('headline counts surviving tells for a real engine', () => {
  const base = { rewritten: 'x', engine: { kind: 'nano' as const }, changes: [], fidelity: [], retried: false, unchanged: false, };
  expect(headline({ ...base, tells: { before: 3, after: 0 } })).toBe('All clear');
  expect(headline({ ...base, tells: { before: 3, after: 2 } })).toBe('2 tells left');
  expect(headline({ ...base, tells: { before: 3, after: 1 } })).toBe('1 tell left');
});

test('an echo never wears a score', () => {
  // Eight identical reports: the model returned the text as it arrived and the
  // headline said "2 tells left" over it.
  const echo = {
    rewritten: 'x',
    engine: { kind: 'nano' as const },
    changes: [],
    tells: { before: 7, after: 2 },
    fidelity: [],
    retried: true,
    unchanged: true,
  };
  expect(headline(echo)).toBe('Came back unchanged');
});
