import { expect, test } from 'vitest';
import { humanize, stripWrapping } from '../src/engine';
import { FakeProvider } from '../src/engine/providers/fake';
import { HumanizerError } from '../src/shared/types';
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

test('a lossy first rewrite is retried silently and the better attempt wins', async () => {
  const original = 'Martinez raised $4.2M in 1994 for the second factory in Lisbon.';
  const prompts: string[] = [];
  let call = 0;
  const flaky = {
    info: { kind: 'fake' as const, model: 'flaky' },
    available: async (): Promise<boolean> => true,
    rewrite: async (req: { systemPrompt: string }): Promise<string> => {
      prompts.push(req.systemPrompt);
      call += 1;
      // First pass drops every fact; second keeps them.
      return call === 1
        ? 'Someone raised money for another factory.'
        : 'Martinez raised $4.2M in 1994 for a second factory in Lisbon.';
    },
  };
  const res = await humanize(original, { intensity: 'full' }, { providers: [flaky] });
  expect(call).toBe(2);
  expect(res.retried).toBe(true);
  expect(res.fidelity).toEqual([]);
  expect(res.rewritten).toContain('$4.2M');
  // The retry prompt names what was lost so the model knows what to protect.
  expect(prompts[1]).toContain('A previous attempt lost content');
  expect(prompts[1]).toContain('$4.2M');
});

test('a faithful first rewrite is not retried', async () => {
  let call = 0;
  const clean = {
    info: { kind: 'fake' as const, model: 'clean' },
    available: async (): Promise<boolean> => true,
    rewrite: async (): Promise<string> => {
      call += 1;
      return 'We dig into the plan today with the same detail as before.';
    },
  };
  const res = await humanize('We delve into the plan today with the same detail as before.', { intensity: 'full' }, { providers: [clean] });
  expect(call).toBe(1);
  expect(res.retried).toBe(false);
});

test('when both attempts lose content the first is kept and still reported', async () => {
  let call = 0;
  const bad = {
    info: { kind: 'fake' as const, model: 'bad' },
    available: async (): Promise<boolean> => true,
    rewrite: async (): Promise<string> => {
      call += 1;
      return call === 1 ? 'Lost the 1994 date only.' : 'Lost everything at all.';
    },
  };
  const res = await humanize('The Lisbon factory opened in 1994 under Martinez.', { intensity: 'full' }, { providers: [bad] });
  expect(call).toBe(2);
  expect(res.retried).toBe(true);
  // Still surfaced rather than hidden: the user is told what is missing.
  expect(res.fidelity.length).toBeGreaterThan(0);
});

test('a retry that fails keeps the first rewrite instead of losing it', async () => {
  // The first pass is finished and usable, merely lossy. A rate limit or a dead
  // socket on the second pass must not turn that into an error for the user.
  let call = 0;
  const flakySecond = {
    info: { kind: 'fake' as const, model: 'flaky-second' },
    available: async (): Promise<boolean> => true,
    rewrite: async (): Promise<string> => {
      call += 1;
      if (call === 2) throw new Error('429 rate limited');
      return 'The factory opened under Martinez.';
    },
  };
  const res = await humanize(
    'The Lisbon factory opened in 1994 under Martinez.',
    { intensity: 'full' },
    { providers: [flakySecond] },
  );
  expect(call).toBe(2);
  expect(res.rewritten).toBe('The factory opened under Martinez.');
  // A second pass was attempted but never completed, so it is not claimed.
  expect(res.retried).toBe(false);
  // What the first pass dropped is still reported rather than hidden.
  expect(res.fidelity.length).toBeGreaterThan(0);
});

test('an abort during the retry is passed on rather than swallowed', async () => {
  const ctl = new AbortController();
  let call = 0;
  const aborting = {
    info: { kind: 'fake' as const, model: 'aborting' },
    available: async (): Promise<boolean> => true,
    rewrite: async (): Promise<string> => {
      call += 1;
      if (call === 2) {
        ctl.abort();
        throw new HumanizerError('aborted');
      }
      return 'The factory opened under Martinez.';
    },
  };
  await expect(
    humanize(
      'The Lisbon factory opened in 1994 under Martinez.',
      { intensity: 'full', signal: ctl.signal },
      { providers: [aborting] },
    ),
  ).rejects.toMatchObject({ kind: 'aborted' });
});

test('a signal aborted after the first pass stops the retry from running', async () => {
  const ctl = new AbortController();
  let call = 0;
  const provider = {
    info: { kind: 'fake' as const, model: 'one-shot' },
    available: async (): Promise<boolean> => true,
    rewrite: async (): Promise<string> => {
      call += 1;
      ctl.abort(); // the user closed the popup while the first pass ran
      return 'The factory opened under Martinez.';
    },
  };
  await expect(
    humanize(
      'The Lisbon factory opened in 1994 under Martinez.',
      { intensity: 'full', signal: ctl.signal },
      { providers: [provider] },
    ),
  ).rejects.toMatchObject({ kind: 'aborted' });
  expect(call).toBe(1);
});

test('the silent retry still reaches a caller that is timing out on silence', async () => {
  // The second pass is not streamed, so a client idle timer armed by the first
  // pass would fire mid-retry and cancel a rewrite that had already succeeded.
  const seen: string[] = [];
  let call = 0;
  const chunky = {
    info: { kind: 'fake' as const, model: 'chunky' },
    available: async (): Promise<boolean> => true,
    rewrite: async (req: RewriteRequest): Promise<string> => {
      call += 1;
      req.onChunk?.('...still working');
      return call === 1
        ? 'The factory opened under Martinez.'
        : 'The Lisbon factory opened in 1994 under Martinez.';
    },
  };
  const res = await humanize(
    'The Lisbon factory opened in 1994 under Martinez.',
    { intensity: 'full', onChunk: text => void seen.push(text) },
    { providers: [chunky] },
  );
  expect(call).toBe(2);
  expect(res.retried).toBe(true);
  // Two passes, so at least two signs of life reached the caller.
  expect(seen.length).toBeGreaterThan(1);
  // The retry holds the view on the text that would be kept if it came to
  // nothing, rather than jumping back to a half-finished second attempt.
  expect(seen.at(-1)).toBe('The factory opened under Martinez.');
});
