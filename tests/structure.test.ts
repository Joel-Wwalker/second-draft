import { expect, test } from 'vitest';
import { isMonotonous, measureStructure, structureInstruction } from '../src/shared/structure';

/**
 * Our output after the sentence-length fix landed. Lengths finally varied, 9 to 25
 * words, and then every sentence turned out to open with its subject.
 */
const AFTER_LENGTH_FIX =
  'Helen of Troy is one of the most famous figures in Greek mythology. She is known for her ' +
  'extraordinary beauty and for her role in starting the Trojan War. She married Menelaus, the king ' +
  'of Sparta, but then she left with, or was taken by, the Trojan prince Paris, and they went to ' +
  'Troy. Menelaus and other Greek leaders responded by launching a large expedition to bring her ' +
  'back. This began a war that lasted for ten years. While Helen is often blamed for the conflict, ' +
  'many versions of the myth show her as a complicated person. The gods, fate, and the powerful men ' +
  'around her all influenced her decisions.';

test('varied lengths with identical shapes is still caught', () => {
  const s = measureStructure(AFTER_LENGTH_FIX)!;
  expect(s.sentences).toBe(7);
  // Only "While Helen is often blamed..." puts anything before the subject.
  expect(s.fronted).toBe(1);
  expect(s.frontedTarget).toBe(2);
  expect(isMonotonous(s)).toBe(true);
});

test('prose that fronts clauses is left alone', () => {
  const varied =
    'Helen of Troy was the daughter of Zeus. After she married Menelaus, the king of Sparta, ' +
    'she left for Troy with Paris, or was taken by him. Because Menelaus would not let it stand, ' +
    'a Greek fleet sailed after her. The war ran ten years. Even now she carries more of the blame ' +
    'than the men who launched it.';
  const s = measureStructure(varied)!;
  expect(s.fronted).toBeGreaterThanOrEqual(s.frontedTarget);
  expect(isMonotonous(s)).toBe(false);
});

test('the same opening word three times is caught even when fronting is fine', () => {
  const repetitive =
    'When the war began, she was in Sparta. When Paris arrived, she left with him. ' +
    'When Menelaus found out, he called on the other kings. When they sailed, it was with a thousand ships. ' +
    'She watched from the walls for ten years.';
  const s = measureStructure(repetitive)!;
  expect(s.commonestOpener).toBe('when');
  expect(s.commonestOpenerCount).toBe(4);
  expect(isMonotonous(s)).toBe(true);
});

test('text too short to judge is not judged', () => {
  expect(measureStructure('One. Two. Three. Four.')).toBeNull();
});

test('the instruction gives a count and an example, not an adjective', () => {
  const note = structureInstruction(measureStructure(AFTER_LENGTH_FIX)!);
  expect(note).toContain('only 1 start with anything before the subject');
  expect(note).toContain('at least 2');
  expect(note).toContain('After the war ended');
  // It must not invite the model to change what the text says.
  expect(note).toContain('Keep the meaning and every fact');
});

test('a comparative phrase with a comma counts as fronting', () => {
  // Real Nano output. "More than anyone else in the story, Helen is blamed" fronts
  // a phrase, and an earlier version of this list missed it, so the measurement
  // reported the model had ignored an instruction it had followed.
  const real =
    'Helen of Troy is a really famous figure in Greek mythology. People celebrate her for being ' +
    'extraordinarily beautiful and for her involvement in the Trojan War. She was the daughter of ' +
    'Zeus and married Menelaus, who was the king of Sparta. Then, the Trojan prince Paris took her ' +
    'to Troy, which then sparked a Greek expedition to retrieve her. That expedition ended up ' +
    'becoming a war that lasted for ten years. More than anyone else in the story, Helen is blamed ' +
    'for the war.';
  const s = measureStructure(real)!;
  expect(s.sentences).toBe(6);
  expect(s.fronted).toBe(2); // "Then," and "More than anyone else in the story,"
  expect(s.frontedTarget).toBe(2);
  expect(isMonotonous(s)).toBe(false);
});

test('the same word without a comma is a subject, not a fronted phrase', () => {
  const subject =
    'More ships arrived that spring. Helen watched from the walls of Troy. The war ground on. ' +
    'Menelaus would not leave. Paris kept to the city.';
  const s = measureStructure(subject)!;
  expect(s.fronted).toBe(0);
});

test('the benchmark script uses the same opener list as the engine', async () => {
  // scripts/compare.mjs cannot import TypeScript, so it holds a copy. A copy that
  // drifts would report a number the engine does not act on.
  const { readFileSync } = await import('node:fs');
  const script = readFileSync('scripts/compare.mjs', 'utf8');
  const source = readFileSync('src/shared/structure.ts', 'utf8');
  const words = (text: string, marker: string): string[] => {
    const start = text.indexOf(marker);
    const open = text.indexOf('[', start);
    const close = text.indexOf(']', open);
    return [...text.slice(open, close).matchAll(/'([a-z’']+)'/g)].map(m => m[1]!).sort();
  };
  expect(words(script, 'const FRONTED')).toEqual(words(source, 'const FRONTED_OPENERS'));
  expect(words(script, 'const COMMA_GATED')).toEqual(words(source, 'const COMMA_GATED_OPENERS'));
});
