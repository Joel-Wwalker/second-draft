import { expect, test } from 'vitest';
import { humanize, stripWrapping } from '../src/engine';
import { FakeProvider } from '../src/engine/providers/fake';
import { HumanizerError } from '../src/shared/types';
import type { RewriteRequest } from '../src/shared/types';

/**
 * The prompts the register pass saw, with any shaping-pass prompt removed.
 *
 * Flat input now costs an extra model call before the rewrite proper, so a bare
 * prompts[0] is the shaping prompt on some fixtures and the register prompt on
 * others. Both carry the cadence instruction, so an index-based assertion can
 * pass against the wrong pass and prove nothing.
 */
const registerPrompts = (all: string[]): string[] =>
  all.filter(p => !p.startsWith('Rewrite the text the user sends, changing only'));

/** Prompts the shaping pass saw; empty when the input was not flat. */
const shapingPrompts = (all: string[]): string[] =>
  all.filter(p => p.startsWith('Rewrite the text the user sends, changing only'));


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
  expect(registerPrompts(prompts)[1]).toContain('A previous attempt lost content');
  expect(registerPrompts(prompts)[1]).toContain('$4.2M');
});

test('a faithful, genuinely rewritten first attempt is not retried', async () => {
  // "Genuinely" carries weight now: a one-word swap used to pass here, and a
  // one-word swap is exactly the under-rewritten case the retry exists for.
  let call = 0;
  const clean = {
    info: { kind: 'fake' as const, model: 'clean' },
    available: async (): Promise<boolean> => true,
    rewrite: async (): Promise<string> => {
      call += 1;
      return 'Today we dig into the plan, and the detail matches what we had before.';
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
    'Helen of Troy is one of the most crucial women in Greek mythology, remembered for her beauty and ' +
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
  expect(registerPrompts(prompts)[0]).not.toContain('steady length is the strongest sign');
  // The retry got measurements, not the adjective the first pass already ignored.
  expect(registerPrompts(prompts)[1]).toContain('still read machine-made');
  expect(registerPrompts(prompts)[1]).toMatch(/run \d+, \d+/);
  // And the varied pass is the one kept.
  expect(res.rewritten).toContain('Homer knew that');
});

test('a rewrite that varies its pacing is left alone', async () => {
  const original =
    'Helen of Troy is one of the most crucial women in Greek mythology, remembered for her beauty and ' +
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
    'Helen of Troy is one of the most crucial women in Greek mythology, remembered for her beauty and ' +
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
  // Flat input is shaped before it is rewritten, so the numbers arrive in the
  // shaping prompt. Still the first pass, still before anything has failed.
  expect(shapingPrompts(prompts)[0]).toContain('23, 24, 18, 16, 15');
  expect(shapingPrompts(prompts)[0]).toContain('steady length is the strongest sign');
  // And once shaping has fixed the rhythm, the register pass is not lectured
  // about a problem that no longer exists.
  expect(registerPrompts(prompts)[0]).not.toContain('steady length is the strongest sign');
});

test('a source that already varies gets no rhythm lecture', async () => {
  // One tell so the engine runs at all; clean input is returned untouched now.
  const varied = VARIED.replace('daughter of Zeus', 'crucial daughter of Zeus');
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
  expect(registerPrompts(prompts)[0]).not.toContain('steady length is the strongest sign');
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
  expect(registerPrompts(prompts)[0]).toContain('words in every 100');
  expect(registerPrompts(prompts)[0]).toContain('nearer 19');
  // Not a pacing lecture: the pacing here is fine.
  expect(registerPrompts(prompts)[0]).not.toContain('steady length is the strongest sign');
});

/** The user's real report: input and output from a live Gemini Nano run. */
const ROMAN_INPUT =
  'The Roman Empire was one of the largest and most influential empires in history. At its height, ' +
  'it controlled much of Europe, North Africa, and parts of Asia. The Romans built roads, bridges, ' +
  'aqueducts, and large cities. They also developed laws and systems of government that influenced ' +
  'many modern countries. Although the empire eventually fell, its language, architecture, and ideas ' +
  'remain important.';

const ROMAN_CHURNED =
  'The Roman Empire was a massive and influential force in history. At its peak, Roman control ' +
  'spanned much of Europe, North Africa, and portions of Asia. The Romans constructed roads, ' +
  'bridges, aqueducts, and sizable cities. They also created laws and governmental systems that ' +
  'continue to shape modern governments. The empire did eventually decline, but its language, ' +
  'architecture, and ideas continue to matter.';

test('the retry is told which tells survived, with their own text', async () => {
  // The live run this reproduces scored 3 tells in, 3 tells out: the model
  // swapped words sideways while both rule-of-three lists and the flat pacing
  // survived. The retry fired but its note only discussed pacing, so the second
  // pass had no target. Now the surviving tells are named with their excerpts.
  const prompts: string[] = [];
  let call = 0;
  const churner = {
    info: { kind: 'fake' as const, model: 'churner' },
    available: async (): Promise<boolean> => true,
    rewrite: async (req: RewriteRequest): Promise<string> => {
      prompts.push(req.systemPrompt);
      // ROMAN_INPUT is flat, so a shaping pass runs first. Echo it back: an
      // unchanged spread is rejected, the register pass gets the original, and
      // this test keeps testing what it was written to test.
      if (req.systemPrompt.startsWith('Rewrite the text the user sends, changing only')) {
        return req.text;
      }
      call += 1;
      return call === 1
        ? ROMAN_CHURNED
        : // The retry fixes what it was told about: one list broken up, pacing varied.
          'The Roman Empire was one of the largest empires in history, and among the most ' +
          'influential. It controlled much of Europe and North Africa at its height, plus parts ' +
          'of Asia. Roads, bridges, aqueducts, whole cities: the Romans built at a scale nobody ' +
          'matched. Their laws and systems of government still shape many modern countries. The ' +
          'empire fell. Its language, architecture, and ideas did not.';
    },
  };
  const res = await humanize(ROMAN_INPUT, { intensity: 'full' }, { providers: [churner] });

  expect(call).toBe(2);
  expect(registerPrompts(prompts)[1]).toContain('Your rewrite still contains');
  expect(registerPrompts(prompts)[1]).toContain('rule of three');
  // The excerpt itself, so the model knows which list. Note it is not the
  // geographic one: "North Africa" is two words, which the pattern requires
  // single-word items to avoid flagging ordinary place lists.
  expect(registerPrompts(prompts)[1]).toContain('bridges, aqueducts');
  // The better-paced second pass with fewer surviving tells is the one kept.
  expect(res.rewritten).toContain('The empire fell.');
});

test('a rewrite that upgrades plain words is retried for it by name', async () => {
  // Varied pacing and no tells on either side, so nothing else can trigger:
  // only the vocabulary getting heavier than the input.
  const plain =
    'Helen married the crucial king of Sparta. Then Paris took her east, and the war that followed ran ' +
    'for ten years and left her with more blame than the men who launched it. Homer knew that. ' +
    'The blame stuck anyway. People still argue about her reasons, and every account says more ' +
    'about its author than about her.';
  const upgraded =
    'Helen married the crucial king of Sparta. Then Paris transported her eastward, and the subsequent ' +
    'conflict persisted for ten years and left her shouldering more culpability than the men who ' +
    'instigated it. Homer understood that. The culpability endured regardless. People still argue ' +
    'about her reasons, and every account says more about its author than about her.';
  const prompts: string[] = [];
  let call = 0;
  const upgrader = {
    info: { kind: 'fake' as const, model: 'upgrader' },
    available: async (): Promise<boolean> => true,
    rewrite: async (req: RewriteRequest): Promise<string> => {
      prompts.push(req.systemPrompt);
      call += 1;
      return call === 1 ? upgraded : plain;
    },
  };
  const res = await humanize(plain, { intensity: 'full' }, { providers: [upgrader] });

  expect(call).toBe(2);
  expect(registerPrompts(prompts)[1]).toContain('vocabulary heavier');
  expect(registerPrompts(prompts)[1]).toContain('transported');
  // The pass that kept the input's weight wins.
  expect(res.rewritten).toBe(plain);
});

test('a rewrite that fixes none of the detected tells is retried even when its style is fine', async () => {
  // Short enough that pacing and weight are not judged, so only the surviving
  // tell can trigger. Echoing the input back means zero progress on it.
  const listy =
    'The plan covers France, Spain, and Portugal. It was drafted last spring by the regional ' +
    'team. Nobody objected then.';
  const prompts: string[] = [];
  let call = 0;
  const echo = {
    info: { kind: 'fake' as const, model: 'echo' },
    available: async (): Promise<boolean> => true,
    rewrite: async (req: RewriteRequest): Promise<string> => {
      prompts.push(req.systemPrompt);
      call += 1;
      return listy;
    },
  };
  const res = await humanize(listy, { intensity: 'full' }, { providers: [echo] });

  expect(call).toBe(2);
  expect(registerPrompts(prompts)[1]).toContain('Your rewrite still contains');
  expect(registerPrompts(prompts)[1]).toContain('rule of three');
  expect(res.retried).toBe(true);
});

test('clean input is returned untouched rather than rewritten into something worse', async () => {
  // From a review of 114 rewrites: an input with no tells was rewritten anyway,
  // and with nothing to remove the model fell back on its default moves, adding
  // an "-ing" tack-on and flattening the pacing. Two of three tell-count
  // regressions were this exact shape.
  const clean =
    'Helen of Troy was the daughter of Zeus. She married Menelaus, the king of Sparta. ' +
    'Then the Trojan prince Paris took her east, and a Greek expedition sailed after her, which ' +
    'hardened into a war that ran for ten years and left Helen carrying more of the blame than any ' +
    'of the men who launched it. Homer knew that.';
  let called = 0;
  const provider = {
    info: { kind: 'fake' as const, model: 'untouched' },
    available: async (): Promise<boolean> => true,
    rewrite: async (): Promise<string> => {
      called += 1;
      return 'something worse';
    },
  };
  const res = await humanize(clean, { intensity: 'full' }, { providers: [provider] });

  expect(called).toBe(0);
  expect(res.rewritten).toBe(clean);
  expect(res.changes).toEqual([]);
  expect(res.retried).toBe(false);
  expect(res.tells.after).toBe(res.tells.before);
});

test('text with real tells is still rewritten', async () => {
  // The gate must not swallow the work: this has tells and flat pacing.
  const tellish =
    'The plan represents a testament to our vibrant culture. It is not just a plan, it is a promise. ' +
    'The team will delve into the intricate details. The team will foster alignment across groups. ' +
    'The team will leverage crucial insights from data. Furthermore the plan underscores our values.';
  let called = 0;
  const provider = {
    info: { kind: 'fake' as const, model: 'works' },
    available: async (): Promise<boolean> => true,
    rewrite: async (): Promise<string> => {
      called += 1;
      return VARIED;
    },
  };
  await humanize(tellish, { intensity: 'full' }, { providers: [provider] });
  expect(called).toBeGreaterThan(0);
});

test('AI vocabulary the old list missed is detected, so the no-rewrite gate does not fire', async () => {
  // Pair 30 of the 100-rewrite review in miniature: strong prose, no dash, no
  // curly quote, no rule-of-three, and six words that mark it as machine-written.
  // The gate returned text like this untouched and reported zero tells, because
  // not one of these words was in the list it consulted.
  const heavy =
    'The council met each spring to settle the accounts of the previous year. ' +
    'Members reviewed the ledgers meticulously, and consequently the disputes that ' +
    'had run on for years were closed inside a single session. Ultimately the ' +
    'practice spread to the other towns along the river, though that took another ' +
    'decade and a proactive push from the guilds. Poor harvests exacerbated the ' +
    'arguments over precedence. The records survive in the town archive today.';
  let called = false;
  const fake = new FakeProvider(t => {
    called = true;
    return t;
  });
  const res = await humanize(heavy, { intensity: 'full' }, { providers: [fake] });
  expect(called).toBe(true);
  expect(res.tells.before).toBeGreaterThan(0);
});

test('a rewrite that only changes quote characters counts as no rewrite and is retried', async () => {
  // The review found two rewrites in a hundred that came back with nothing but
  // the apostrophes straightened. applyFixes runs before the comparison, so a
  // byte check called them changed and the retry never fired.
  const original =
    "The tenants' agreement ran for seven years and nobody read it closely. " +
    'It set the rent, the repairs and the notice period. When the roof failed ' +
    'in the second winter the landlord pointed at clause nine, which said ' +
    'nothing about roofs at all. They argued about it until the following spring.';
  const prompts: string[] = [];
  let call = 0;
  const echo = {
    info: { kind: 'fake' as const, model: 'echo' },
    available: async (): Promise<boolean> => true,
    rewrite: async (req: RewriteRequest): Promise<string> => {
      prompts.push(req.systemPrompt);
      call += 1;
      // First pass: the same text with curly apostrophes and doubled spacing.
      if (call === 1) return original.replace(/'/g, '’').replace(/\. /g, '.  ');
      return original.replace('nobody read it closely', 'nobody read it');
    },
  };
  const res = await humanize(original, { intensity: 'full' }, { providers: [echo] });
  expect(call).toBe(2);
  expect(registerPrompts(prompts)[1]).toContain('returned the text exactly as it arrived');
  expect(res.rewritten).toContain('nobody read it.');
});

test('a tell the rewrite invented triggers a retry even when the total count fell', async () => {
  // Four rewrites in the review were handed prose without negative parallelism
  // and wrote it in. Each had removed enough other tells that the count dropped,
  // so the old no-progress trigger read it as success.
  const source =
    'The bridge opened in 1874 after two collapses during construction. ' +
    'Engineers blamed the first on the caissons and the second on a winter storm. ' +
    'The county paid for both inquiries and published neither, moreover the ' +
    'contractor kept the retainer. Traffic crossed it for ninety years.';
  const prompts: string[] = [];
  let call = 0;
  const inventor = {
    info: { kind: 'fake' as const, model: 'inventor' },
    available: async (): Promise<boolean> => true,
    rewrite: async (req: RewriteRequest): Promise<string> => {
      prompts.push(req.systemPrompt);
      call += 1;
      // Removes the 'moreover' tell but writes in a negative parallelism the
      // original never had, so the raw count goes down while the text gets worse.
      if (call === 1) {
        return source
          .replace(', moreover the', '. The')
          .replace('Traffic crossed it', 'It was not just a crossing but a lifeline, and traffic crossed it');
      }
      return source.replace(', moreover the', '. The');
    },
  };
  const res = await humanize(source, { intensity: 'full' }, { providers: [inventor] });
  expect(call).toBe(2);
  expect(registerPrompts(prompts)[1]).toContain('added something the original did not have');
  expect(res.rewritten).not.toContain('not just a crossing');
});

test('a real rewrite beats a no-op even when the no-op scores better on style', async () => {
  // The ranking bug that cost nine retries in a hundred. A no-op inherits the
  // input's style score, so on text whose pacing is already fine it scores zero
  // and beat any genuine rewrite carrying a single style note. The retry fired
  // correctly and its result was discarded here.
  // Carries one tell, so the no-rewrite gate lets it reach the model, and paces
  // itself well, so the no-op it comes back as carries no style note.
  const source =
    'The harbour wall was rebuilt in 1904 after the storm took the old one. ' +
    'Money came from the fishing families, who were repaid over twenty years at ' +
    'no interest. The council minutes record two crucial objections and neither ' +
    'is explained. Nobody has found the original drawings, so the repairs in 1968 ' +
    'were done from survey alone, and the join is still visible at low tide.';
  // Deliberately flat, so it carries a style note the no-op does not, and
  // deliberately faithful, so fidelity cannot decide the comparison first.
  const flatRewrite =
    'The harbour wall was rebuilt in 1904 after the storm hit it. The money came ' +
    'from the local fishing families in the town. They were repaid over twenty ' +
    'years at no interest. The council minutes record two objections to the work. ' +
    'Neither of those two objections is explained anywhere. Nobody has ever found ' +
    'the original drawings for it. The repairs in 1968 were done from survey ' +
    'alone. The join is still visible there at low tide.';
  let call = 0;
  const lazy = {
    info: { kind: 'fake' as const, model: 'lazy' },
    available: async (): Promise<boolean> => true,
    rewrite: async (): Promise<string> => {
      call += 1;
      return call === 1 ? source : flatRewrite;
    },
  };
  const res = await humanize(source, { intensity: 'full' }, { providers: [lazy] });
  expect(call).toBe(2);
  // Doing something imperfect beats declining to act.
  expect(res.rewritten).toBe(flatRewrite);
});

const FLAT_SOURCE =
  'The harbour authority reviewed the moorings in March and again in September. ' +
  'The report noted the same six faults on both occasions without much comment. ' +
  'Repairs were scheduled for the spring and then quietly moved to the autumn. ' +
  'The berth holders were told about the delay by letter in early August. ' +
  'Nobody from the authority attended the meeting that the berth holders called.';
const SHAPED =
  'The harbour authority reviewed the moorings in March, then again in September, and the ' +
  'report noted the same six faults on both occasions without much comment. Repairs were ' +
  'scheduled for the spring. They were then quietly moved to the autumn, and the berth ' +
  'holders were told about the delay by letter in early August. Nobody came. The meeting ' +
  'the berth holders called went unattended by anyone from the authority.';

test('flat input is shaped by a dedicated pass before the rewrite proper', async () => {
  // Seven batches established that one prompt cannot both protect wording and
  // rebuild rhythm. The two instincts get separate calls, and only flat text
  // pays for the second one.
  const prompts: string[] = [];
  const shaper = {
    info: { kind: 'fake' as const, model: 'shaper' },
    available: async (): Promise<boolean> => true,
    rewrite: async (req: RewriteRequest): Promise<string> => {
      prompts.push(req.systemPrompt);
      return req.systemPrompt.startsWith('Rewrite the text the user sends, changing only')
        ? SHAPED
        : req.text.replace('quietly', 'later');
    },
  };
  const res = await humanize(FLAT_SOURCE, { intensity: 'full' }, { providers: [shaper] });
  expect(shapingPrompts(prompts)).toHaveLength(1);
  expect(shapingPrompts(prompts)[0]).toContain('changing only where its sentences begin and end');
  // The register pass worked from the shaped text, not the original.
  expect(res.rewritten).toContain('later');
  expect(res.rewritten).toContain('Nobody came');
});

test('well-paced input pays for no shaping pass at all', async () => {
  const prompts: string[] = [];
  const watcher = {
    info: { kind: 'fake' as const, model: 'watcher' },
    available: async (): Promise<boolean> => true,
    rewrite: async (req: RewriteRequest): Promise<string> => {
      prompts.push(req.systemPrompt);
      return req.text.replace('crucial', 'important-looking');
    },
  };
  await humanize(VARIED.replace('daughter of Zeus', 'crucial daughter of Zeus'), { intensity: 'full' }, { providers: [watcher] });
  expect(shapingPrompts(prompts)).toHaveLength(0);
});

test('a shaping pass that drops a fact is thrown away, not passed on', async () => {
  // Shape is worth nothing at the cost of a date. The register pass must receive
  // the original text, and the user must not be shown a rewrite missing 1998.
  const withFact = `${FLAT_SOURCE} The authority had been warned about the moorings in 1998.`;
  const shaper = {
    info: { kind: 'fake' as const, model: 'lossy-shaper' },
    available: async (): Promise<boolean> => true,
    rewrite: async (req: RewriteRequest): Promise<string> => {
      // Better rhythm, and the date is gone.
      if (req.systemPrompt.startsWith('Rewrite the text the user sends, changing only')) return SHAPED;
      return req.text;
    },
  };
  const res = await humanize(withFact, { intensity: 'full' }, { providers: [shaper] });
  expect(res.rewritten).toContain('1998');
});

test('a shaping pass that does not improve the rhythm is thrown away', async () => {
  // It had one job. Keeping a pass that failed at it would hand the register pass
  // a worse starting point for nothing.
  const flatter =
    'The council met on Tuesday to discuss the drainage works near the old mill. ' +
    'The clerk had circulated the costings to every member the previous Friday. ' +
    'Two members asked whether the figures included the culvert under the lane. ' +
    'The surveyor confirmed that they did not and offered to price it separately. ' +
    'The chair adjourned the item until the January meeting without taking a vote. ' +
    'The minutes record none of the discussion beyond the decision to adjourn it.';
  const shaper = {
    info: { kind: 'fake' as const, model: 'useless-shaper' },
    available: async (): Promise<boolean> => true,
    rewrite: async (req: RewriteRequest): Promise<string> => {
      if (req.systemPrompt.startsWith('Rewrite the text the user sends, changing only')) {
        // Same shape, different words: exactly what this pass is told not to do.
        return req.text.replace('discuss', 'consider').replace('circulated', 'distributed');
      }
      return req.text.replace('Tuesday', 'the Tuesday');
    },
  };
  const res = await humanize(flatter, { intensity: 'full' }, { providers: [shaper] });
  expect(res.rewritten).toContain('discuss');
  expect(res.rewritten).toContain('circulated');
});

test('light intensity never pays for a shaping pass, however flat the text', async () => {
  // Light mode promises to change as little as possible. A pass whose whole job
  // is moving sentence boundaries contradicts that, so flat text under light
  // goes straight to the single rewrite.
  const prompts: string[] = [];
  const watcher = {
    info: { kind: 'fake' as const, model: 'watcher' },
    available: async (): Promise<boolean> => true,
    rewrite: async (req: RewriteRequest): Promise<string> => {
      prompts.push(req.systemPrompt);
      return req.text;
    },
  };
  await humanize(FLAT_SOURCE, { intensity: 'light' }, { providers: [watcher] });
  expect(shapingPrompts(prompts)).toHaveLength(0);
});

const MULTI_PARA =
  'The committee reviewed the flood defence budget in March and found a crucial shortfall. ' +
  'The gap came from two sources, and neither had been flagged before the review started.\n\n' +
  'The first source was the pump maintenance contract, which had been priced in 2019 and ' +
  'never revisited despite two extensions. The second was the survey backlog itself.\n\n' +
  'Residents were told about the shortfall in a letter that reached most households in May. ' +
  'The letter promised a revised schedule by autumn and apologized for the delay in plain terms.';

test('wrapper quotes around paragraphs are stripped in code before any model sees them', async () => {
  const wrapped = MULTI_PARA.split('\n\n').map(p => `"${p}"`).join('\n\n');
  const prompts: string[] = [];
  const echo = {
    info: { kind: 'fake' as const, model: 'echo' },
    available: async (): Promise<boolean> => true,
    rewrite: async (req: RewriteRequest): Promise<string> => {
      prompts.push(req.text);
      return req.text.replace('crucial shortfall', 'big shortfall');
    },
  };
  const res = await humanize(wrapped, { intensity: 'full' }, { providers: [echo] });
  // The model never saw a wrapper quote, and neither does the user.
  expect(prompts.every(p => !p.includes('"'))).toBe(true);
  expect(res.rewritten).not.toContain('"');
});

test('a whole-blob echo is salvaged paragraph by paragraph', async () => {
  // The five-paragraph paste behind eight identical reports, in miniature: the
  // model echoes the whole blob every time, but rewrites paragraphs sent alone.
  let call = 0;
  const blobEcho = {
    info: { kind: 'fake' as const, model: 'blob-echo' },
    available: async (): Promise<boolean> => true,
    rewrite: async (req: RewriteRequest): Promise<string> => {
      call += 1;
      if (req.text.includes('\n\n')) return req.text; // whole blob: echo, twice
      return req.text
        .replace('The first source was', 'First came')
        .replace('Residents were told about', 'Residents heard about');
    },
  };
  const res = await humanize(MULTI_PARA, { intensity: 'full' }, { providers: [blobEcho] });
  expect(call).toBeGreaterThan(2); // whole-blob attempts plus per-paragraph salvage
  expect(res.unchanged).toBe(false);
  expect(res.rewritten).toContain('First came');
  expect(res.rewritten).toContain('Residents heard about');
  // Paragraph breaks survive reassembly.
  expect(res.rewritten.split(/\n\s*\n/)).toHaveLength(3);
});

test('when even the salvage echoes, the result says unchanged instead of scoring itself', async () => {
  const totalEcho = new FakeProvider(t => t);
  const res = await humanize(MULTI_PARA, { intensity: 'full' }, { providers: [totalEcho] });
  expect(res.unchanged).toBe(true);
});

test('a paragraph that echoes its first attempt gets one corrected retry, and no more', async () => {
  // Every paragraph runs the pipeline alone now, so the echo retry is the
  // ordinary noop retry, carrying the anti-echo correction. Stubborn paragraphs
  // keep their original after it, and nothing gets a third chance.
  const perParaCalls = new Map<string, number>();
  const stubborn = {
    info: { kind: 'fake' as const, model: 'stubborn' },
    available: async (): Promise<boolean> => true,
    rewrite: async (req: RewriteRequest): Promise<string> => {
      const n = (perParaCalls.get(req.text) ?? 0) + 1;
      perParaCalls.set(req.text, n);
      // First paragraph converts on the corrected second attempt, with a
      // genuine restructure rather than a word swap: near-echoes are refused by
      // the same measure that triggers the retry. The others never convert.
      if (req.text.startsWith('The committee') && n === 2) {
        if (!req.systemPrompt.includes('returned the text exactly as it arrived')) return req.text;
        return (
          'In March the committee went over the flood defence budget and found a hole in it. ' +
          'Two separate sources fed the gap. Nobody had flagged either one before the review began.'
        );
      }
      return req.text;
    },
  };
  const res = await humanize(MULTI_PARA, { intensity: 'full' }, { providers: [stubborn] });
  expect(res.rewritten).toContain('In March the committee went over');
  // Every paragraph got exactly two chances, no more.
  for (const n of perParaCalls.values()) expect(n).toBe(2);
  expect(res.unchanged).toBe(false);
});

test('multi-paragraph input never reaches the model as one blob', async () => {
  // The architecture the whole saga bought. A prompt built for a whole paste
  // dilutes across it and the model answers with token swaps: measured, the
  // blob prompt left three of five paragraphs identical while the same
  // paragraphs under their own prompts moved four of five below 80% overlap.
  // So the model only ever sees paragraphs.
  const seen: string[] = [];
  const solo = {
    info: { kind: 'fake' as const, model: 'solo' },
    available: async (): Promise<boolean> => true,
    rewrite: async (req: RewriteRequest): Promise<string> => {
      seen.push(req.text);
      return req.text
        .replace('The committee reviewed', 'That March the committee combed through')
        .replace('The first source was', 'First came')
        .replace('Residents were told about', 'Residents heard about');
    },
  };
  const res = await humanize(MULTI_PARA, { intensity: 'full' }, { providers: [solo] });
  expect(seen.every(t => !t.includes('\n\n'))).toBe(true);
  expect(res.rewritten).toContain('combed through');
  expect(res.rewritten).toContain('First came');
  expect(res.rewritten).toContain('Residents heard about');
  expect(res.rewritten.split(/\n\s*\n/)).toHaveLength(3);
  expect(res.unchanged).toBe(false);
});

test('a paragraph the blob pass barely touched is deepened, and a near-echo replacement is refused', async () => {
  // The user-visible failure after the echo fixes: the blob pass changed two
  // words of a long paragraph, the salvage saw "not an echo" and moved on, and
  // the person who pasted it saw an untouched paragraph.
  const deepen = {
    info: { kind: 'fake' as const, model: 'deepen' },
    available: async (): Promise<boolean> => true,
    rewrite: async (req: RewriteRequest): Promise<string> => {
      if (req.text.includes('\n\n')) {
        // Blob pass: a two-word tweak to paragraph one, real rewrites elsewhere.
        const [a, b, c] = req.text.split('\n\n');
        return [
          a!.replace('found a crucial shortfall', 'found a big shortfall'),
          'The maintenance contract was priced back in 2019 and nobody looked at it again through two extensions, while the survey backlog quietly grew alongside it.',
          'A letter reached most households in May, promising a revised schedule by autumn and apologizing plainly for the delay.',
        ].join('\n\n');
      }
      // Solo pass: a genuine restructure of the under-served paragraph.
      return (
        'That March, going over the flood defence budget, the committee hit a shortfall. ' +
        'It had two sources. Neither one had been flagged before the review began.'
      );
    },
  };
  const res = await humanize(MULTI_PARA, { intensity: 'full' }, { providers: [deepen] });
  expect(res.rewritten).toContain('That March, going over');
  expect(res.rewritten).not.toContain('found a big shortfall');
});

test('a salvage replacement that adds a tell is refused', async () => {
  // A salvage once wrote "robust", a word on the engine's own detection list,
  // into a paragraph that arrived without it. The count dropped elsewhere, so
  // nothing objected. The source here is tell-free on purpose: a source
  // already carrying one tell may trade it sideways under the count bound, and
  // an earlier version of this test proved that by accident with "crucial".
  // Tell-free where it matters, but not everywhere: a fully clean, well-paced
  // input never reaches a model at all, because the no-rewrite gate returns it
  // first, which made an earlier version of this test pass with the guard
  // deleted. The em dash in the last paragraph gets the engine running while
  // the harbour paragraph itself still arrives with zero tells.
  const CLEAN_PARAS =
    'The harbour board met on a Tuesday to talk through the mooring survey. ' +
    'Nobody expected the meeting to run long, and it did anyway.\n\n' +
    'The survey had found six faults, and four of them sat below the waterline. ' +
    'Fixing those meant divers, and divers meant money the board had not set aside.\n\n' +
    'A vote was taken before the room emptied. The repairs were approved for spring — ' +
    'with the diving work first on the list and the paperwork to follow.';
  const teller = {
    info: { kind: 'fake' as const, model: 'teller' },
    available: async (): Promise<boolean> => true,
    rewrite: async (req: RewriteRequest): Promise<string> => {
      if (req.text.includes('\n\n')) return req.text;
      if (!req.text.startsWith('The harbour board')) return req.text;
      // A real restructure that smuggles in a listed word.
      return (
        'On a Tuesday the harbour board sat down over the mooring survey, a robust agenda in hand. ' +
        'Long meetings were nobody\'s plan. This one ran long anyway.'
      );
    },
  };
  const res = await humanize(CLEAN_PARAS, { intensity: 'full' }, { providers: [teller] });
  expect(res.rewritten).not.toContain('robust');
});
