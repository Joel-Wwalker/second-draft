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
  expect(full).toContain('Rewrite even when none of the listed tells appear');
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
  expect(full).toContain('so is returning the same structure with the words shuffled');
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
  expect(full).toContain('Do not invent details that were');
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
  expect(full).toContain('Never open two sentences in a row with This');
  expect(full).toContain('invent nothing');
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
  expect(full).toContain('Never delete a dash and close the gap');
  expect(full).toContain('Hyphens inside compound words are not dashes');
  expect(full).toContain('cost-effective');
  expect(full).toContain('Semicolons, colons, brackets and parentheses are not AI');
});

test('pacing is asked for in both directions, and fragmenting is named as a tell', () => {
  // The same review found one structural move, splitting, responsible for most
  // remaining problems: it destroyed variance the input already had and gamed the
  // spread metric by producing thirteen clipped sentences.
  const full = buildSystemPrompt({ intensity: 'full', tells: [], target: 'nano' });
  expect(full).toContain('Mix sentence lengths in both directions');
  expect(full).toContain('Merge two related sentences');
  expect(full).toContain('is its own AI tell');
  expect(full).toContain('never start two consecutive sentences with This');
});

test("the writer's own voice is protected rather than treated as a tell", () => {
  // First-person reviews were being sanded into neutral reports, and one rewrite
  // invented a vague attribution ("clunky, according to some") from the writer's
  // own stated opinion, manufacturing a tell out of human tissue.
  const full = buildSystemPrompt({ intensity: 'full', tells: [], target: 'nano' });
  expect(full).toContain("Keep the writer's own voice");
  expect(full).toContain('the writer, not tells');
  expect(full).toContain('never add one that was not there');
});
