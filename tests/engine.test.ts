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

test('quotation marks the model invented are removed', async () => {
  // What Gemini Nano actually did on the first real run: quoted the opening
  // sentence of a paragraph that quoted nobody, so the rewrite read as a citation.
  const original = 'Helen of Troy is one of the most famous women in Greek mythology, celebrated for her beauty.';
  const quoting = new FakeProvider(
    () => '"Helen of Troy is one of the most famous women in Greek myth," celebrated for her beauty.',
  );
  const res = await humanize(original, { intensity: 'full' }, { providers: [quoting] });
  expect(res.rewritten).not.toContain('"');
  expect(res.rewritten).toBe('Helen of Troy is one of the most famous women in Greek myth, celebrated for her beauty.');
});

test('quotation marks the original had are left alone', async () => {
  // Stripping here would destroy meaning, and the fidelity check watches quotes.
  const original = 'She called it "the face that launched a thousand ships" more than once.';
  const keeper = new FakeProvider(t => t.replace('more than once', 'repeatedly'));
  const res = await humanize(original, { intensity: 'full' }, { providers: [keeper] });
  expect(res.rewritten).toBe('She called it "the face that launched a thousand ships" repeatedly.');
});

test('curly quotes the model invented go too', async () => {
  const original = 'The factory opened in 1994 under Martinez.';
  const curly = new FakeProvider(() => '“The factory opened in 1994” under Martinez.');
  const res = await humanize(original, { intensity: 'full' }, { providers: [curly] });
  expect(res.rewritten).toBe('The factory opened in 1994 under Martinez.');
});

test('a model quoting its own answer is undone even when the original quotes something', async () => {
  // The real Gemini Nano failure, with the text that produced it. The original
  // quotes a phrase near the end, which is why a blanket rule cannot apply: the
  // model wrapped its opening sentence in quotes as well, and only that pair is
  // invention.
  const original =
    'Helen of Troy is one of the most famous women in Greek mythology, celebrated for her ' +
    'extraordinary beauty and her role in the Trojan War. She was the daughter of Zeus and was ' +
    'married to Menelaus, the king of Sparta. Helen is often described as “the face that ' +
    'launched a thousand ships,” symbolizing both irresistible beauty and the terrible ' +
    'consequences of love, desire, and betrayal.';
  const nanoLike = new FakeProvider(
    () =>
      '"Helen of Troy is one of the most famous women in Greek mythology, celebrated for her ' +
      'extraordinary beauty and her role in the Trojan War." She was the daughter of Zeus and ' +
      'married to Menelaus, the king of Sparta. Helen is often called "the face that launched a ' +
      'thousand ships," a symbol of both captivating beauty and the destructive power of love, ' +
      'desire, and betrayal.',
  );
  const res = await humanize(original, { intensity: 'full' }, { providers: [nanoLike] });

  expect(res.rewritten.startsWith('Helen of Troy')).toBe(true);
  expect(res.rewritten).not.toContain('Trojan War."');
  // The quotation the original actually made survives, marks and all.
  expect(res.rewritten).toContain('"the face that launched a thousand ships,"');
  // Exactly one pair left, which is the one pair the original had.
  expect((res.rewritten.match(/"/g) ?? []).length).toBe(2);
});

test('a quotation the original opens with is not mistaken for invention', async () => {
  const original = '"We grew fast," she said, and the numbers back her up.';
  const keeper = new FakeProvider(t => t.replace('back her up', 'agree'));
  const res = await humanize(original, { intensity: 'full' }, { providers: [keeper] });
  expect(res.rewritten).toBe('"We grew fast," she said, and the numbers agree.');
});

/**
 * Four sentences of 6, 7, 40 and 3 words: pacing that changes on purpose. It keeps
 * every proper noun in the source, because the fidelity check outranks rhythm and
 * would otherwise discard this in favour of the flat version.
 */
const VARIED =
  'Helen of Troy was the daughter of Zeus. She married Menelaus, the king of Sparta. ' +
  'Then the Trojan prince Paris took her east, and a Greek expedition sailed after her, which ' +
  'hardened into a war that ran for ten years and left Helen carrying more of the blame than any ' +
  'of the men who launched it. Homer knew that.';

test('an evenly paced rewrite is retried, and the second pass is told the numbers', async () => {
  // The pattern that already works for lost content, applied to the thing that
  // actually makes text read like a machine wrote it.
  const original =
    'Helen of Troy is one of the most famous women in Greek mythology, remembered for her beauty and ' +
    'her part in the Trojan War. She was the daughter of Zeus and married Menelaus, the king of Sparta. ' +
    'The Trojan prince Paris took her to Troy, which started a Greek expedition to bring her back. ' +
    'That expedition turned into a war lasting ten full years. Helen is blamed for it more than anyone.';
  const prompts: string[] = [];
  let call = 0;
  const flatThenVaried = {
    info: { kind: 'fake' as const, model: 'flat-first' },
    available: async (): Promise<boolean> => true,
    rewrite: async (req: RewriteRequest): Promise<string> => {
      prompts.push(req.systemPrompt);
      call += 1;
      return call === 1
        ? // Five sentences, all the same size. Loses nothing, so only rhythm can trigger the retry.
          'Helen of Troy is one of the best known women in all of Greek mythology and its stories. ' +
          'She was the daughter of Zeus and she married Menelaus, who was the king of Sparta. ' +
          'The Trojan prince Paris then took her away to Troy, which started a Greek expedition. ' +
          'That expedition turned into a full war that lasted for ten long and bitter years. ' +
          'Helen is blamed for the whole of it more than any other person in the story.'
        : VARIED;
    },
  };
  const res = await humanize(original, { intensity: 'full' }, { providers: [flatThenVaried] });

  expect(call).toBe(2);
  expect(res.retried).toBe(true);
  // This input already varies its pacing, so the first pass is not lectured about
  // rhythm. Only the rewrite that came back flat is.
  expect(prompts[0]).not.toContain('steady length is the strongest sign');
  // The retry got measurements, not the adjective the first pass already ignored.
  expect(prompts[1]).toContain('still read machine-made');
  expect(prompts[1]).toMatch(/run \d+, \d+/);
  // And the varied pass is the one kept.
  expect(res.rewritten).toContain('Homer knew that');
});

test('a rewrite that varies its pacing is left alone', async () => {
  const original =
    'Helen of Troy is one of the most famous women in Greek mythology, remembered for her beauty and ' +
    'her part in the Trojan War. She was the daughter of Zeus and married Menelaus, the king of Sparta. ' +
    'The Trojan prince Paris took her to Troy, which started a Greek expedition to bring her back. ' +
    'That expedition turned into a war lasting ten full years. Helen is blamed for it more than anyone.';
  let call = 0;
  const varied = {
    info: { kind: 'fake' as const, model: 'varied' },
    available: async (): Promise<boolean> => true,
    rewrite: async (): Promise<string> => {
      call += 1;
      return VARIED;
    },
  };
  const res = await humanize(original, { intensity: 'full' }, { providers: [varied] });
  expect(call).toBe(1);
  expect(res.retried).toBe(false);
});

test('flat pacing counts against the score, so the failure is visible', async () => {
  const original =
    'Helen of Troy is one of the most famous women in Greek mythology, remembered for her beauty and ' +
    'her part in the Trojan War. She was the daughter of Zeus and married Menelaus, the king of Sparta. ' +
    'The Trojan prince Paris took her to Troy, which started a Greek expedition to bring her back. ' +
    'That expedition turned into a war lasting ten full years. Helen is blamed for it more than anyone.';
  const stubborn = {
    info: { kind: 'fake' as const, model: 'stubborn' },
    available: async (): Promise<boolean> => true,
    // Same length every sentence, both passes. A score of zero here would be a lie.
    rewrite: async (): Promise<string> =>
      'Helen of Troy is one of the best known women in all of Greek mythology and its stories. ' +
      'She was the daughter of Zeus and she married Menelaus, who was the king of Sparta. ' +
      'The Trojan prince Paris then took her away to Troy, which started a Greek expedition. ' +
      'That expedition turned into a full war that lasted for ten long and bitter years. ' +
      'Helen is blamed for the whole of it more than any other person in the story.',
  };
  const res = await humanize(original, { intensity: 'full' }, { providers: [stubborn] });
  expect(res.tells.after).toBeGreaterThan(0);
});

test('a flat source is measured on the first pass, before anything has failed', async () => {
  // Our own output from the comparison that started this, fed back in as input.
  const flat =
    'Helen of Troy remains a really well-known figure in Greek mythology, celebrated for her beauty ' +
    'and her involvement in starting the Trojan War. She married Menelaus, who was the king of Sparta, ' +
    'but she either left or was taken by Trojan prince Paris and brought to Troy. This sparked a huge ' +
    'Greek expedition led by Menelaus to retrieve her, which then became a decade-long war. Though ' +
    'Helen often gets blamed for the war, many accounts present her as a complex person. Her decisions ' +
    'were influenced by the gods, fate, and the powerful men in her life.';
  const prompts: string[] = [];
  const noted = {
    info: { kind: 'fake' as const, model: 'noted' },
    available: async (): Promise<boolean> => true,
    rewrite: async (req: RewriteRequest): Promise<string> => {
      prompts.push(req.systemPrompt);
      return VARIED;
    },
  };
  await humanize(flat, { intensity: 'full' }, { providers: [noted] });
  // The measured lengths, not the adjective that has been in the prompt all along.
  expect(prompts[0]).toContain('23, 24, 18, 16, 15');
  expect(prompts[0]).toContain('steady length is the strongest sign');
});

test('a source that already varies gets no rhythm lecture', async () => {
  const varied = VARIED;
  const prompts: string[] = [];
  const quiet = {
    info: { kind: 'fake' as const, model: 'quiet' },
    available: async (): Promise<boolean> => true,
    rewrite: async (req: RewriteRequest): Promise<string> => {
      prompts.push(req.systemPrompt);
      return VARIED;
    },
  };
  await humanize(varied, { intensity: 'full' }, { providers: [quiet] });
  expect(prompts[0]).not.toContain('steady length is the strongest sign');
});


test('heavy vocabulary reaches the prompt even when the pacing is fine', async () => {
  // Nearly every word here runs long, while the sentence lengths swing from four
  // words to twenty-four, so only the vocabulary signal can fire. The prompt gets
  // the measured share and examples, not an adjective.
  const heavyVaried =
    'Administrators prioritized comprehensive documentation everywhere. Nevertheless, operational ' +
    'personnel repeatedly circumvented established bureaucratic procedures, generating considerable ' +
    'organizational friction throughout successive reorganizations and undermining institutional ' +
    'accountability across departmental hierarchies during subsequent evaluations. Leadership ' +
    'commissioned independent assessments. Their conclusions emphasized measurable transparency, ' +
    'sustainable implementation frameworks, and considerable administrative simplification, ' +
    'notwithstanding persistent budgetary constraints and complicated regulatory obligations. ' +
    'Meanwhile, subordinate coordinators documented significant procedural irregularities repeatedly.';
  const prompts: string[] = [];
  const provider = {
    info: { kind: 'fake' as const, model: 'latinate' },
    available: async (): Promise<boolean> => true,
    rewrite: async (req: RewriteRequest): Promise<string> => {
      prompts.push(req.systemPrompt);
      return VARIED;
    },
  };
  await humanize(heavyVaried, { intensity: 'full' }, { providers: [provider] });
  expect(prompts[0]).toContain('words in every 100');
  expect(prompts[0]).toContain('nearer 19');
  // Not a pacing lecture: the pacing here is fine.
  expect(prompts[0]).not.toContain('steady length is the strongest sign');
});
