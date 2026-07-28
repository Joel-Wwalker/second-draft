import { expect, test } from 'vitest';
import { analyzeWriting, compareToProfile } from '../src/shared/profile';
import type { WritingProfile } from '../src/shared/profile';

/**
 * Hand-counted fixture. Four sentences, token counts 5, 18, 4, 16 (43 words).
 * mean 43/4 = 10.75; deviations -5.75, 7.25, -6.75, 5.25; squares 33.0625,
 * 52.5625, 45.5625, 27.5625; sum 158.75; variance 158.75/4 = 39.6875;
 * sqrt = 6.29980... Contractions: "don't", "It's" = 2 of 43 = 0.0465.
 * Commas: 1 of 4 sentences = 0.25. Words of 8+ letters: "Sometimes" (9),
 * "sentence" (8), "thinking" (8) = 3 of 43 = 0.0698.
 */
const SAMPLE = [
  'I write in short bursts.',
  'Sometimes a sentence runs much longer than it really needs to, and I let it wander a bit.',
  "I don't fix that.",
  "It's just how the words come out when I am not thinking about it too hard.",
].join(' ');

test('analyzeWriting reports hand-counted statistics', () => {
  expect(analyzeWriting(SAMPLE)).toEqual({
    words: 43,
    avgSentenceWords: 10.8,
    sentenceVariety: 6.3,
    contractionRate: 0.05,
    commasPerSentence: 0.25,
    longWordRate: 0.07,
  });
});

test('sentenceVariety is zero when every sentence is the same length', () => {
  const even = 'One two three four five. Six seven eight nine ten. Alpha beta gamma delta epsilon.';
  const profile = analyzeWriting(`${even} ${even} ${even}`);
  expect(profile?.sentenceVariety).toBe(0);
  expect(profile?.avgSentenceWords).toBe(5);
});

test('a sample under the floor has no profile, and one word more does', () => {
  const thirtyNine = Array.from({ length: 39 }, () => 'word').join(' ');
  const forty = Array.from({ length: 40 }, () => 'word').join(' ');
  expect(analyzeWriting(thirtyNine)).toBeNull();
  expect(analyzeWriting(forty)?.words).toBe(40);
});

const PROFILE = analyzeWriting(SAMPLE) as WritingProfile;

test('a rewrite with much longer sentences reports the drift', () => {
  // One sentence, 22 words. |22 - 10.8| = 11.2, over the 4 word threshold.
  const longer =
    'The quality of the output depends entirely on how carefully the author has considered the structure of the argument being presented here.';
  expect(compareToProfile(longer, PROFILE)).toBe(
    'Your writing averages 10.8 word sentences; this runs 22.',
  );
});

test('a rewrite with far fewer contractions reports that instead', () => {
  // Two sentences, 11 words each: avg 11.0 (within 4 of 10.8, so no length
  // note), 5 contractions of 22 words = 0.23 against the sample's 0.05.
  const chatty =
    "I can't tell whether it's working the way we wanted here. I don't know why it's happening, and I can't fix it.";
  expect(compareToProfile(chatty, PROFILE)).toBe(
    'This rewrite uses more contractions than you usually do.',
  );
});

test('a rewrite close to the profile gets no note', () => {
  // 23 words over 3 sentences: avg 7.7 (3.1 away, under the threshold) and one
  // contraction of 23 words = 0.04 against 0.05.
  const close =
    "I write in short bursts here. Sometimes a sentence wanders a little longer than needed, and I let it. I don't fix that.";
  expect(compareToProfile(close, PROFILE)).toBeNull();
});

test('a rewrite too short to judge gets no note', () => {
  expect(compareToProfile('Far too short to judge fairly.', PROFILE)).toBeNull();
});

test('the note names the direction when the author uses more contractions', () => {
  // Eight sentences, 45 words, 9 contractions = 0.2; average 45/8 = 5.6.
  const chattyProfile = analyzeWriting(
    "I can't stop writing like this. I don't plan it. It's just how I talk. We won't change it now. " +
      "They'd rather I did not. I can't help it either way. I'm not going to pretend it's different. " +
      "You'd hear it in my email too.",
  ) as WritingProfile;
  expect(chattyProfile.contractionRate).toBe(0.2);
  // Four sentences, 17 words, no contractions; average 4.3 stays within the
  // sentence-length threshold so the contraction note is the one that fires.
  const formal =
    'The committee reviewed the proposal. The schedule will remain. Staff must submit forms. Managers will review them.';
  expect(compareToProfile(formal, chattyProfile)).toBe(
    'You use more contractions than this rewrite does.',
  );
});
