/**
 * Simple, hand-checkable statistics about a person's writing, computed locally.
 * Every number here is meant to be reproducible with a pen: words are
 * whitespace separated tokens, and a sentence ends at terminal punctuation that
 * is followed by a space or the end of the text. That lookahead keeps "e.g.",
 * "3.14", "example.com" and "v2.0.1" intact instead of shredding them into
 * fragments, and `words` is summed from the sentences themselves so the counts
 * can never drift apart.
 */
export interface WritingProfile {
  words: number;
  avgSentenceWords: number;
  /** Population standard deviation of sentence lengths, in words. */
  sentenceVariety: number;
  contractionRate: number;
  commasPerSentence: number;
  longWordRate: number;
}

/** Below this a sample says more about the excerpt than about the writer. */
export const MIN_PROFILE_WORDS = 40;
/** Below this a rewrite is too short to compare fairly. */
export const MIN_COMPARE_WORDS = 15;
/** A word this long or longer counts as heavy. Shared with diction.ts. */
export const LONG_WORD_LETTERS = 8;
const SENTENCE_DRIFT_WORDS = 4;
const CONTRACTION_DRIFT = 0.15;

export function analyzeWriting(text: string): WritingProfile | null {
  const profile = stats(text);
  return profile.words < MIN_PROFILE_WORDS ? null : profile;
}

/**
 * One short note when a rewrite drifts from how the author writes, or null when
 * it is close enough to leave alone.
 */
export function compareToProfile(text: string, profile: WritingProfile): string | null {
  const candidate = stats(text);
  if (candidate.words < MIN_COMPARE_WORDS) return null;
  // Only ever one note. Sentence length wins when both drift, because rhythm is
  // the more visible difference to a reader.
  if (Math.abs(candidate.avgSentenceWords - profile.avgSentenceWords) > SENTENCE_DRIFT_WORDS) {
    return `Your writing averages ${profile.avgSentenceWords} word sentences; this runs ${candidate.avgSentenceWords}.`;
  }
  if (Math.abs(candidate.contractionRate - profile.contractionRate) > CONTRACTION_DRIFT) {
    return profile.contractionRate > candidate.contractionRate
      ? 'You use more contractions than this rewrite does.'
      : 'This rewrite uses more contractions than you usually do.';
  }
  return null;
}

function stats(text: string): WritingProfile {
  const perSentence = sentenceWordCounts(text);
  const sentences = perSentence.length;
  const all = tokens(text);
  const words = perSentence.reduce((sum, count) => sum + count, 0);
  if (words === 0 || sentences === 0) {
    return {
      words: 0,
      avgSentenceWords: 0,
      sentenceVariety: 0,
      contractionRate: 0,
      commasPerSentence: 0,
      longWordRate: 0,
    };
  }
  const mean = words / sentences;
  const variance = perSentence.reduce((sum, count) => sum + (count - mean) ** 2, 0) / sentences;
  const contractions = all.filter(token => /['’][A-Za-z]/.test(token)).length;
  const commas = (text.match(/,/g) ?? []).length;
  const long = all.filter(token => letters(token).length >= LONG_WORD_LETTERS).length;
  return {
    words,
    avgSentenceWords: round(mean, 1),
    sentenceVariety: round(Math.sqrt(variance), 1),
    contractionRate: round(contractions / words, 2),
    commasPerSentence: round(commas / sentences, 2),
    longWordRate: round(long / words, 2),
  };
}

function tokens(text: string): string[] {
  return text.match(/\S+/g) ?? [];
}

function sentenceWordCounts(text: string): number[] {
  return text
    .split(/[.!?]+(?=\s|$)/)
    .map(part => tokens(part).length)
    .filter(count => count > 0);
}

function letters(token: string): string {
  return token.replace(/[^A-Za-z]/g, '');
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
