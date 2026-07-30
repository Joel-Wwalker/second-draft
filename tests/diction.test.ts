import { expect, test } from 'vitest';
import { MAX_LONG_WORD_RATE, dictionInstruction, isOverwrought, measureDiction } from '../src/shared/diction';

/** A real paragraph from the model, from the 60-sample corpus. */
const MACHINE =
  'Remote work culture encompasses the norms, values, and behaviors that characterize organizations ' +
  'where employees perform their duties outside of a traditional office setting. It often prioritizes ' +
  'asynchronous communication, relying on digital tools like email, instant messaging, and project ' +
  'management software to facilitate collaboration. Building trust and fostering a sense of community ' +
  'are crucial aspects, frequently achieved through virtual social events and intentional efforts to ' +
  'maintain connection.';

/** A real Wikipedia introduction, from the 1000-sample control group. */
const HUMAN =
  'The coppersmith barbet is an Asian barbet with a green body, a red head and a yellow patch around ' +
  'the eye. It is named for the sound it makes, a repeated note like a smith striking metal. The bird ' +
  'is found in gardens and open woodland across much of South and Southeast Asia. It nests in holes it ' +
  'bores into dead wood, often in a branch that hangs over a path, and both parents feed the young.';

test('the model paragraph reads as heavy, the human one does not', () => {
  const machine = measureDiction(MACHINE)!;
  const human = measureDiction(HUMAN)!;
  expect(isOverwrought(machine)).toBe(true);
  expect(isOverwrought(human)).toBe(false);
  // The gap is wide, not marginal: this is why the signal is worth acting on.
  expect(machine.rate).toBeGreaterThan(human.rate * 2);
});

test('the threshold sits at the top of the human range, not in the middle of it', () => {
  // Just above the human 90th percentile of 0.281, measured over 1000 paragraphs.
  // Pinned so nobody tightens it on taste and starts telling people their own
  // vocabulary is robotic.
  expect(MAX_LONG_WORD_RATE).toBe(0.3);
});

test('text too short to judge is not judged', () => {
  expect(measureDiction('Extraordinarily comprehensive institutional frameworks.')).toBeNull();
});

test('names are not offered as words to simplify', () => {
  // A name is a fact the rewrite has to keep, so it is useless as an example.
  const withNames =
    'Constantinople remained the administrative centre of the Byzantine institutional apparatus for ' +
    'centuries, and Justinian reorganised its bureaucratic establishments comprehensively, ' +
    'transforming the surrounding Mediterranean settlements into interconnected commercial ' +
    'dependencies of considerable significance throughout the period. Theodosian legislation ' +
    'consolidated these arrangements, and subsequent Palaeologan administrations inherited an ' +
    'apparatus whose complicated procedures survived repeatedly disrupted successions across ' +
    'generations of ecclesiastical and mercantile competition.';
  const d = measureDiction(withNames)!;
  expect(d.heavy).not.toContain('constantinople');
  expect(d.heavy).not.toContain('mediterranean');
  expect(d.heavy).toContain('administrative');
});

test('the instruction names the count and real examples from the text', () => {
  const note = dictionInstruction(measureDiction(MACHINE)!);
  expect(note).toMatch(/\d+ words in every 100/);
  expect(note).toContain('nearer 19');
  expect(note).toContain('encompasses');
  // It must not invite the model to strip technical terms or names.
  expect(note).toContain('Keep names, places and technical terms');
});
