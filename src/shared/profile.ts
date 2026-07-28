/**
 * Simple, hand-checkable statistics about a person's writing, computed locally.
 * Every number here is meant to be reproducible with a pen: tokens are
 * whitespace separated, sentences are split on terminal punctuation.
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
const LONG_WORD_LETTERS = 8;
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
  const all = tokens(text);
  const perSentence = sentenceWordCounts(text);
  const sentences = perSentence.length;
  if (all.length === 0 || sentences === 0) {
    return {
      words: 0,
      avgSentenceWords: 0,
      sentenceVariety: 0,
      contractionRate: 0,
      commasPerSentence: 0,
      longWordRate: 0,
    };
  }
  const mean = perSentence.reduce((sum, count) => sum + count, 0) / sentences;
  const variance = perSentence.reduce((sum, count) => sum + (count - mean) ** 2, 0) / sentences;
  const contractions = all.filter(token => /['’][A-Za-z]/.test(token)).length;
  const commas = (text.match(/,/g) ?? []).length;
  const long = all.filter(token => letters(token).length >= LONG_WORD_LETTERS).length;
  return {
    words: all.length,
    avgSentenceWords: round(mean, 1),
    sentenceVariety: round(Math.sqrt(variance), 1),
    contractionRate: round(contractions / all.length, 2),
    commasPerSentence: round(commas / sentences, 2),
    longWordRate: round(long / all.length, 2),
  };
}

function tokens(text: string): string[] {
  return text.match(/\S+/g) ?? [];
}

function sentenceWordCounts(text: string): number[] {
  return text
    .split(/[.!?]+/)
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
