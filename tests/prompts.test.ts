import { expect, test } from 'vitest';
import { buildSystemPrompt } from '../src/engine/prompts';
import { detect } from '../src/engine/rules';

const tells = detect('We delve—deeply.');

test('light prompt lists detected tells and the output contract', () => {
  const p = buildSystemPrompt({ intensity: 'light', tells, target: 'nano' });
  expect(p).toContain('Output only the rewritten text');
  expect(p).toContain('em dash');
  expect(p).toContain('Change as little as possible');
});

test('full prompt includes pattern guidance that light omits', () => {
  const light = buildSystemPrompt({ intensity: 'light', tells, target: 'nano' });
  const full = buildSystemPrompt({ intensity: 'full', tells, target: 'nano' });
  expect(full).toContain('rule of three');
  expect(light).not.toContain('rule of three');
});

test('nano prompts stay under the size budget even with a huge voice sample', () => {
  const p = buildSystemPrompt({
    intensity: 'full',
    tells,
    voiceSample: 'word '.repeat(2000),
    target: 'nano',
  });
  expect(p.length).toBeLessThan(6000);
});

test('voice sample is included when provided', () => {
  const p = buildSystemPrompt({ intensity: 'full', tells, voiceSample: 'My own words here.', target: 'byok' });
  expect(p).toContain('My own words here.');
});

test('heuristic tells respect minCountForPrompt', () => {
  const one = detect('We value speed, quality, and trust.');
  const p = buildSystemPrompt({ intensity: 'full', tells: one, target: 'byok' });
  expect(p).not.toContain('Detected in this text');
});
