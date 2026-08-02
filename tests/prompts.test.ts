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
  expect(full).toContain('rule-of-three');
  expect(light).not.toContain('rule-of-three');
});

test('full prompt mandates a rewrite even for clean text; light stays minimal', () => {
  const light = buildSystemPrompt({ intensity: 'light', tells: [], target: 'nano' });
  const full = buildSystemPrompt({ intensity: 'full', tells: [], target: 'nano' });
  expect(full).toContain('Returning the text unchanged is a failure');
  expect(full).toContain('Rewrite even when no listed tell appears');
  expect(light).not.toContain('unchanged is a failure');
});

test('the mandate demands new structure, never synonym churn', () => {
  // The old wording said the rewrite "must read noticeably different", and the
  // model satisfied it the cheapest way there is: built became constructed,
  // parts became portions, and both rule-of-three lists survived. The mandate
  // now defines different as structural, and names the churn as a failure too.
  const full = buildSystemPrompt({ intensity: 'full', tells: [], target: 'nano' });
  expect(full).not.toContain('noticeably different');
  expect(full).toContain('Do not make it different by swapping words for synonyms');
  expect(full).toContain('so is the same structure with the words shuffled');
  expect(full).toContain('never swap a plain word for a fancier one');
  // Plain wording must not decay into chattiness, which was the other direction
  // of the same churn.
  expect(full).toContain('plain wording is not casual wording');
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
  expect(full).toContain('Mix sentence lengths in both directions');
  expect(full).toContain('Use contractions where the register allows');
  expect(full).toContain('invent no details that were not there');
  // The light pass stays minimal: it only removes tells, it does not restyle.
  const light = buildSystemPrompt({ intensity: 'light', tells: [], target: 'nano' });
  expect(light).not.toContain('Mix sentence lengths');
  expect(light).not.toContain('Use contractions');
});

test('the full prompt teaches voice with worked examples, not adjectives', () => {
  // Measured on QuillBot's detector in one sitting: our output scored 76 percent
  // machine-written with "Neutral tone" and "Generic language" as the stated
  // reasons, a human Wikipedia paragraph scored zero, and a rewrite of our same
  // content using exactly these moves scored zero with no fact changed and no
  // grammar damaged. The prompt carries the moves with the examples that worked.
  const full = buildSystemPrompt({ intensity: 'full', tells: [], target: 'nano' });
  expect(full).toContain('not long words or short ones');
  expect(full).toContain('the fight ground on for ten years');
  // The professional register gets its own worked example, because the casual
  // moves (judgment sentences, stance words) are wrong there and precision is
  // the voice instead. Both examples preserve facts exactly.
  expect(full).toContain('"analyzed');
  expect(full).toContain('never');  // precision over plainness, wording checked below
  expect(full).toContain('Never open two consecutive sentences with This');
  expect(full).toContain('assert as fact what the writer would not');
  expect(full).toContain("Keep the writer's own voice");
  const light = buildSystemPrompt({ intensity: 'light', tells: [], target: 'nano' });
  expect(light).not.toContain('reads generated');
});

test('punctuation is replaced, never deleted, and hyphens are not dashes', () => {
  // A review of 114 rewrites found the worst failure class was grammar broken by
  // dashes vanishing with nothing in their place ("every letter and symbol a slow
  // and error prone process"), and by the no-dashes rule being over-applied to
  // hyphens and semicolons. The code path was always a replacement; the model was
  // over-generalising the instruction, so the instruction is explicit now.
  const full = buildSystemPrompt({ intensity: 'full', tells: [], target: 'nano' });
  expect(full).toContain('never delete one and close the gap');
  expect(full).toContain('Hyphens in compound words are not dashes');
  expect(full).toContain('cost-effective');
  expect(full).toContain('Semicolons, colons and brackets are not tells');
});

test('pacing is asked for in both directions, and fragmenting is named as a tell', () => {
  // The same review found one structural move, splitting, responsible for most
  // remaining problems: it destroyed variance the input already had and gamed the
  // spread metric by producing thirteen clipped sentences.
  const full = buildSystemPrompt({ intensity: 'full', tells: [], target: 'nano' });
  expect(full).toContain('Mix sentence lengths in both directions');
  expect(full).toContain('Merge two related sentences');
  expect(full).toContain('is its own AI tell');
  expect(full).toContain('Never open two consecutive sentences with This');
});

test("the writer's own voice is protected rather than treated as a tell", () => {
  // First-person reviews were being sanded into neutral reports, and one rewrite
  // invented a vague attribution ("clunky, according to some") from the writer's
  // own stated opinion, manufacturing a tell out of human tissue.
  const full = buildSystemPrompt({ intensity: 'full', tells: [], target: 'nano' });
  expect(full).toContain("Keep the writer's own voice");
  expect(full).toContain('the writer, not tells');
  expect(full).toContain('never add one');
});

test('a voice sample is trimmed to the room left, not dropped and not overrunning', () => {
  const p = buildSystemPrompt({
    intensity: 'full',
    tells: [],
    target: 'nano',
    voiceSample: 'plainly stated sentences about ordinary work '.repeat(200),
  });
  expect(p.length).toBeLessThanOrEqual(6000);
  // Present, so the feature still does its job under budget pressure.
  expect(p).toContain('Match the voice of this writing sample');
  expect(p).toContain('plainly stated sentences');
  // Cut at a word boundary rather than mid-word.
  expect(p.endsWith('plainl') || p.endsWith('sentenc') || p.endsWith('ordinar')).toBe(false);
});

test('the first pass is told which AI words were found, not just how many', () => {
  // A count is not actionable. Naming the category and a number replaced a static
  // list that at least said delve and crucial, so the model went from a guessable
  // list to no list at all. Fixable rules are exempt: applyFixes guarantees those
  // whatever the model returns.
  const tells = detect(
    'The council reviewed the ledgers meticulously and consequently the delve into ' +
      'disputes ended there. Ultimately a proactive push from the guilds was crucial.',
  );
  const p = buildSystemPrompt({ intensity: 'full', tells, target: 'nano' });
  expect(p).toContain('"meticulously"');
  expect(p).toContain('"delve"');
  expect(p).not.toContain('AI-associated word (');
});

test('the preservation rules are bounded to wording, not to sentence shape', () => {
  // Measured cost of leaving this implicit: with the term-of-art, hedge and
  // voice-marker rules added and no boundary drawn, bigram overlap with the
  // source went from 0.45 to 0.62 and the engine de-flattened 5 of 29 flat
  // inputs where it had managed 22. The model read "keep this" as "keep
  // everything", and pacing repair needs the opposite.
  const full = buildSystemPrompt({ intensity: 'full', tells: [], target: 'nano' });
  expect(full).toContain('None of them protects sentence shape');
  expect(full).toContain('rebuild the sentences around them');
});

test('a rule that defends something absent from the text is left out', () => {
  // Every conditional rule is a "keep" instruction, and a pile of them taught the
  // model to keep the sentences too: bigram overlap with the source went 0.45 to
  // 0.62 and de-flattening fell from 22 of 29 flat inputs to 5. Defending a hedge
  // in a paragraph with no hedge buys nothing and costs that.
  const history =
    'The Assize of Bread fixed loaf weights against the price of grain from 1266. ' +
    'Enforcement fell to borough courts, whose records survive unevenly. Bakers ' +
    'were fined by the dozen in some years and not at all in others.';
  const personal =
    'Honestly, I did not expect the first month to be that hard. I kept a list of ' +
    'everything I got wrong, which helped more than I thought it would.';

  const forHistory = buildSystemPrompt({ intensity: 'full', tells: [], target: 'nano', text: history });
  const forPersonal = buildSystemPrompt({ intensity: 'full', tells: [], target: 'nano', text: personal });

  expect(forHistory).not.toContain('Keep every hedge as strong as it arrived');
  expect(forHistory).not.toContain("Keep the writer's own voice");
  expect(forPersonal).toContain("Keep the writer's own voice");
  expect(forPersonal).not.toContain('Keep every hedge as strong as it arrived');
  // Cheaper as well as less insistent, which is the point on a small model.
  expect(forHistory.length).toBeLessThan(forPersonal.length);
});

test('without the text every conditional rule is kept, which is the cautious default', () => {
  const p = buildSystemPrompt({ intensity: 'full', tells: [], target: 'nano' });
  expect(p).toContain('Keep every hedge as strong as it arrived');
  expect(p).toContain("Keep the writer's own voice");
});

test('quote marks wrapping whole paragraphs are called formatting, not protected', () => {
  // The input shape that silenced the engine seven times: five paragraphs, each
  // wrapped in double quotes, pasted as one block. Most of the text sits inside
  // quotation marks, and "leave text inside quotation marks exactly as written"
  // then commands a verbatim return, which the model dutifully produced.
  const wrapped = [
    'Alexander the Great was one of the most successful military leaders in his era of history.',
    '"Dear Mr. Johnson, I am writing to ask whether I may have an extension on the project due Friday."',
    '"One of the most memorable events in my life was my first day at a new school in a new town."',
    '"Artificial intelligence has created serious concerns about personal privacy in modern times."',
  ].join('\n\n');
  const formatted = buildSystemPrompt({ intensity: 'full', tells: [], target: 'nano', text: wrapped });
  expect(formatted).toContain('they are formatting, not quotations');
  expect(formatted).not.toContain('Leave text inside quotation marks exactly as written');

  // A real quotation inside ordinary prose keeps its protection.
  const quoting =
    'The chair opened the meeting with a warning. "We will not fund this twice," she said, and ' +
    'the minutes record that nobody argued. The rest of the session covered the roof repairs, ' +
    'the insurance excess, and the schedule for the winter inspections across both sites.';
  const protective = buildSystemPrompt({ intensity: 'full', tells: [], target: 'nano', text: quoting });
  expect(protective).toContain('Leave text inside quotation marks exactly as written');
  expect(protective).not.toContain('they are formatting, not quotations');

  // No text to measure: protecting quotations is the safe default, because
  // wrongly protecting formatting mutes a rewrite while wrongly rewriting a
  // quotation changes what somebody said.
  const bare = buildSystemPrompt({ intensity: 'full', tells: [], target: 'nano' });
  expect(bare).toContain('Leave text inside quotation marks exactly as written');
});
