import { expect, test } from 'vitest';
import { humanize, stripWrapping } from '../src/engine';
import { FakeProvider } from '../src/engine/providers/fake';
import type { RewriteRequest } from '../src/shared/types';

test('falls back to rules-only when no provider is available', async () => {
  const res = await humanize('The plan—bold.', { intensity: 'light' }, { providers: [] });
  expect(res.engine.kind).toBe('rules');
  expect(res.rewritten).toBe('The plan, bold.');
  expect(res.changes[0]).toMatchObject({ ruleId: 'em-dash' });
  expect(res.tells).toEqual({ before: 1, after: 0 });
});

test('uses the provider and enforces surviving em dashes', async () => {
  const fake = new FakeProvider(t => t.replace(/\bdelve\b/g, 'dig') + ' — done');
  const res = await humanize('We delve here', { intensity: 'full' }, { providers: [fake] });
  expect(res.engine).toMatchObject({ kind: 'fake', model: 'fake-echo' });
  expect(res.rewritten).toBe('We dig here, done');
  expect(res.tells).toEqual({ before: 1, after: 0 });
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

test('stripWrapping keeps wrappers the original already had', () => {
  expect(stripWrapping('Here is the plan: do it.', 'Here is the plan: do it.')).toBe('Here is the plan: do it.');
  expect(stripWrapping('```\ncode\n```', '```\ncode\n```')).toBe('```\ncode\n```');
});

test('a provider whose available() throws is skipped, not fatal', async () => {
  const explosive = {
    info: { kind: 'nano' as const },
    available: async (): Promise<boolean> => {
      throw new Error('probe failed');
    },
    rewrite: async (): Promise<string> => 'never',
  };
  const res = await humanize('A—B here', { intensity: 'light' }, { providers: [explosive] });
  expect(res.engine.kind).toBe('rules');
});

test('an empty provider rewrite is rejected, not applied', async () => {
  const empty = new FakeProvider(() => '');
  await expect(
    humanize('some real text', { intensity: 'light' }, { providers: [empty] }),
  ).rejects.toMatchObject({ kind: 'internal' });
});

test('customTells option flows into detection before and after the rewrite', async () => {
  const text = 'This has our secret phrase. It really does have a secret phrase.';
  const res = await humanize(text, { intensity: 'light', customTells: ['secret phrase'] }, { providers: [] });
  expect(res.tells).toEqual({ before: 2, after: 2 });
});

test('a custom tell reaches the system prompt sent to the provider', async () => {
  let capturedPrompt = '';
  const capturing = {
    info: { kind: 'fake' as const },
    available: async (): Promise<boolean> => true,
    rewrite: async (req: RewriteRequest): Promise<string> => {
      capturedPrompt = req.systemPrompt;
      return req.text;
    },
  };
  await humanize(
    'Our secret phrase is here.',
    { intensity: 'full', customTells: ['secret phrase'] },
    { providers: [capturing] },
  );
  expect(capturedPrompt).toContain('your phrase "secret phrase"');
  expect(capturedPrompt).not.toContain('Detected in this text: custom');
});
