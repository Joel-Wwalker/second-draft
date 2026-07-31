import { expect, test } from 'vitest';
import { MIN_SENTENCES, cadenceInstruction, isFlat, measureCadence } from '../src/shared/cadence';

/** What this extension produced, judged flatter than a competitor's output. */
const OURS =
  'Helen of Troy remains a really well-known figure in Greek mythology, celebrated for her beauty ' +
  'and her involvement in starting the Trojan War. She married Menelaus, who was the king of Sparta, ' +
  'but she either left or was taken by Trojan prince Paris and brought to Troy. This sparked a huge ' +
  'Greek expedition led by Menelaus to retrieve her, which then became a decade-long war. Though ' +
  'Helen often gets blamed for the war, many accounts present her as a complex person. Her decisions ' +
  'were influenced by the gods, fate, and the powerful men in her life.';

/** A competitor's output on the same source. Read as more human, and is also flat. */
const THEIRS =
  'Helen of Troy, one of the key heroines or characters in Greek myths is most remembered as being ' +
  'responsible for the Trojan War because of her extreme beauty. Helen was married to Menelaus, King ' +
  'of the Spartans who had won her as a spouse in an athletic competition. One day, however, Menelaus ' +
  'found out that his wife had gone with or, depending on interpretation, was captured by Paris the ' +
  'Trojan prince. Menelaus and the other Greek noblemen went to war just in order to retrieve Helen ' +
  'which ended up in ten years of combat between Greek and Trojan armies. Even though Helen has ' +
  'usually been presented as the villain, some interpretations see the goddesses, divine fate, and ' +
  'the influential men as the reason behind Helen.';

test('our own output measures as flat, which is why it read like a machine wrote it', () => {
  const cadence = measureCadence(OURS)!;
  expect(cadence.lengths).toEqual([23, 24, 18, 16, 15]);
  expect(cadence.spread).toBeLessThan(0.2);
  expect(cadence.shortest).toBe(15); // nothing short anywhere
  expect(isFlat(cadence)).toBe(true);
});

test("the competitor's output is flat too, so this is not a copy of their trick", () => {
  // They read more human because of loose grammar, not rhythm. Worth pinning: if
  // the threshold ever passes this, it has stopped measuring what it claims to.
  const cadence = measureCadence(THEIRS)!;
  expect(isFlat(cadence)).toBe(true);
});

test('prose that changes pace is not flagged', () => {
  // Nine words, then thirty-one, then five, then twenty-two.
  const varied =
    'Helen married the king of Sparta. Then Paris took her to Troy, or she went with him, ' +
    'depending on which poet you believe and how much blame he wanted to place on a woman rather ' +
    'than on the men who sailed after her. The war lasted ten years. Homer gives her lines that ' +
    'sound less like a prize than like someone tired of being one.';
  const cadence = measureCadence(varied)!;
  expect(isFlat(cadence)).toBe(false);
});

test('text too short to have a rhythm is not judged', () => {
  expect(measureCadence('Short. Very short. Tiny.')).toBeNull();
  const threeLong = Array.from({ length: MIN_SENTENCES - 1 }, () => 'word '.repeat(25).trim() + '.').join(' ');
  expect(measureCadence(threeLong)).toBeNull();
});

test('the instruction names measured numbers, not a preference', () => {
  const note = cadenceInstruction(measureCadence(OURS)!);
  // "vary sentence length" has been in the prompt from the start and is ignored.
  expect(note).toContain('23, 24, 18, 16, 15');
  expect(note).toContain('under 12 words');
  expect(note).toMatch(/split/i);
});

test('a text with no long sentence is told to join two, not only to split one', () => {
  const allShort = 'One two three four five. Six seven eight nine ten. ' .repeat(6);
  const cadence = measureCadence(allShort);
  if (cadence) expect(cadenceInstruction(cadence)).toMatch(/merge two/i);
});

test('a heading does not count into the sentence after it', () => {
  // Found on a real four-section essay: "Ancient Egypt" merged into the opener
  // and measured as one longer sentence, because a heading has no full stop.
  const body =
    'The empire controlled the whole coast for two hundred years. Trade made it rich. ' +
    'Its fleets carried grain, wine, and silver between three continents every season of the year. ' +
    'Nothing about that lasted. The capital fell within a generation of the first defeat. ' +
    'Historians still argue about why, and every explanation says more about the historian than the fall.';
  const withHeading = 'The Rise And Fall\n\n' + body;
  expect(measureCadence(withHeading)!.lengths).toEqual(measureCadence(body)!.lengths);
});

test('the pacing instruction stays short enough for a small model to act on', () => {
  // Two extra clauses were added here, naming the longest-to-shortest band and
  // the all-long case. Both read as helpful. Measured over 100 rewrites, the
  // engine carrying them de-flattened 8 of 29 flat inputs where the engine
  // without them managed 22. Length is not free: this instruction competes for
  // a small model's attention with everything else in the prompt.
  const sentences = Array.from({ length: 6 }, (_, i) => `${'word '.repeat(20 + i)}end.`);
  const flat = measureCadence(sentences.join(' '));
  expect(flat).not.toBeNull();
  const note = cadenceInstruction(flat!);
  expect(note.length).toBeLessThan(700);
  // Still says the two things that earn their place: the numbers, and both directions.
  expect(note).toContain('words.');
  expect(note).toContain('Do both, not just splitting');
});
