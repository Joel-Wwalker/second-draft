import { expect, test } from 'vitest';
import { buildSystemPrompt } from '../src/engine/prompts';
import { detect } from '../src/engine/rules';

const tells = detect('We delve—deeply.');

test('light prompt lists detected tells and the output contract', () => {
  const p = buildSystemPrompt({ intensity: 'light', tells, target: 'nano' });
  expect(p).toContain('Output only the rewritten text');
  expect(p).toContain('em dash');
  expect(p).toContain('Change as little as possible');
  expect(p).toMatch(/Detected in this text: .*em dash/);
  expect(p).toContain('Leave text inside quotation marks exactly as written.');
});

test('full prompt includes pattern guidance that light omits', () => {
  const light = buildSystemPrompt({ intensity: 'light', tells, target: 'nano' });
  const full = buildSystemPrompt({ intensity: 'full', tells, target: 'nano' });
  expect(full).toContain('rule of three');
  expect(light).not.toContain('rule of three');
});

test('full prompt mandates a rewrite even for clean text; light stays minimal', () => {
  const light = buildSystemPrompt({ intensity: 'light', tells: [], target: 'nano' });
  const full = buildSystemPrompt({ intensity: 'full', tells: [], target: 'nano' });
  expect(full).toContain('Returning the text unchanged or nearly unchanged is a failure');
  expect(full).toContain('Rewrite even when none of the listed tells appear');
  expect(light).not.toContain('unchanged is a failure');
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

test('the full prompt asks for rhythm, contractions, and concreteness without inventing facts', () => {
  const full = buildSystemPrompt({ intensity: 'full', tells: [], target: 'nano' });
  expect(full).toContain('Mix sentence lengths on purpose');
  expect(full).toContain('Use contractions where the register allows');
  expect(full).toContain('Do not invent details that were');
  // The light pass stays minimal: it only removes tells, it does not restyle.
  const light = buildSystemPrompt({ intensity: 'light', tells: [], target: 'nano' });
  expect(light).not.toContain('Mix sentence lengths');
  expect(light).not.toContain('Use contractions');
});
