import { expect, test } from 'vitest';
import { humanize, stripWrapping } from '../src/engine';
import { FakeProvider } from '../src/engine/providers/fake';

test('falls back to rules-only when no provider is available', async () => {
  const res = await humanize('The plan—bold.', { intensity: 'light' }, { providers: [] });
  expect(res.engine.kind).toBe('rules');
  expect(res.rewritten).toBe('The plan, bold.');
  expect(res.changes[0]).toMatchObject({ ruleId: 'em-dash' });
});

test('uses the provider and enforces surviving em dashes', async () => {
  const fake = new FakeProvider(t => t.replace(/\bdelve\b/g, 'dig') + ' — done');
  const res = await humanize('We delve here', { intensity: 'full' }, { providers: [fake] });
  expect(res.engine).toMatchObject({ kind: 'fake', model: 'fake-echo' });
  expect(res.rewritten).toBe('We dig here, done');
});

test('skips unavailable providers and falls back to rules', async () => {
  const down = new FakeProvider(t => t, false);
  const res = await humanize('A—B', { intensity: 'light' }, { providers: [down] });
  expect(res.engine.kind).toBe('rules');
});

test('throws too-long for oversized input', async () => {
  await expect(
    humanize('x'.repeat(50_001), { intensity: 'light' }, { providers: [] }),
  ).rejects.toMatchObject({ kind: 'too-long' });
});

test('throws aborted when the signal is already aborted', async () => {
  const ctl = new AbortController();
  ctl.abort();
  await expect(
    humanize('hi there', { intensity: 'light', signal: ctl.signal }, { providers: [] }),
  ).rejects.toMatchObject({ kind: 'aborted' });
});

test('stripWrapping removes preambles, fences, and wrapper quotes', () => {
  expect(stripWrapping('Here is the rewritten text:\nClean.', 'orig')).toBe('Clean.');
  expect(stripWrapping('```\nClean.\n```', 'orig')).toBe('Clean.');
  expect(stripWrapping('"Clean."', 'orig')).toBe('Clean.');
});
