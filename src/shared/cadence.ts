import { proseOnly } from './prose';

/**
 * Sentence rhythm, which is the tell the rules layer never looked at.
 *
 * The mechanical tells are easy: an em dash is either there or it is not, and code
 * can delete it. What actually marks a paragraph as machine-written is that every
 * sentence comes out the same size. A person writes a nine-word sentence, then a
 * thirty-word one, then a fragment. A model settles into one length and stays
 * there.
 *
 * The prompt has asked for varied sentence length in three different places since
 * the first version, and on-device Gemini Nano returned five sentences of 23, 24,
 * 18, 16, and 15 words. Asking does not work. This module measures instead, so the
 * engine can retry with numbers rather than repeat an adjective the model already
 * ignored.
 */

export interface Cadence {
  /** Words per sentence, in order. */
  lengths: number[];
  mean: number;
  /** Population standard deviation, in words. */
  stdev: number;
  /** Standard deviation over mean. Scale-free, so it compares across registers. */
  spread: number;
  shortest: number;
  longest: number;
}

/**
 * Below this there is not enough text for rhythm to mean anything. Three rather
 * than four because a competitor's output escaped this check entirely by writing
 * three sentences of 32, 53 and 49 words: a wall of text is a rhythm problem, and
 * skipping it because there were too few sentences was the wrong call. The word
 * floor below is what actually keeps short snippets from being judged.
 */
export const MIN_SENTENCES = 3;
export const MIN_WORDS = 55;
/** A sentence this short or shorter counts as a change of pace. */
export const SHORT_SENTENCE = 11;
/** A sentence this long counts as the other end of the range. */
export const LONG_SENTENCE = 25;
/**
 * Longest minus shortest, at or under this, is worth naming in the instruction.
 * Not a trigger: see isFlat for why it did not earn that. Purely descriptive, so
 * the model is told the actual shape of the problem rather than a ratio.
 */
export const NARROW_BAND = 8;
/**
 * Every sentence at least this long is its own failure mode. Splitting one in half
 * yields two more mid-length sentences, so the split instruction on its own makes
 * no difference; the model has to be told to aim for genuinely short.
 */
export const UNIFORM_LONG = 18;
/**
 * Spread below this reads as one length repeated.
 *
 * Measured, not guessed. Across 1000 Wikipedia article introductions, written and
 * edited by people, spread runs p10 0.24, median 0.41, p90 0.66. Across 60
 * paragraphs written by the on-device model it runs p10 0.09, median 0.16, p90
 * 0.26. The two barely overlap, which is what makes this the one style signal
 * worth acting on.
 *
 * One caveat on those model numbers: the paragraphs were generated with an
 * instruction asking for about 90 words in five or six sentences, which
 * mechanically narrows the spread. So treat the human side as sound and the
 * model side as an upper bound on how well this catches machine text.
 *
 * 0.22 flags 7.7% of that human prose. Going to 0.30, which an earlier version
 * used, flagged 22.6% of it: a fifth of people would have been told their own
 * writing was evenly paced, and a fifth of rewrites would have burned a second
 * pass for nothing.
 */
export const MIN_SPREAD = 0.22;

function wordsIn(part: string): number {
  return part.trim().split(/\s+/).filter(Boolean).length;
}

/** Null when the text is too short to say anything honest about its rhythm. */
export function measureCadence(text: string): Cadence | null {
  const lengths = proseOnly(text)
    .split(/[.!?]+(?=\s|$)/)
    .map(wordsIn)
    .filter(count => count > 0);
  const words = lengths.reduce((sum, n) => sum + n, 0);
  if (lengths.length < MIN_SENTENCES || words < MIN_WORDS) return null;

  const mean = words / lengths.length;
  const variance = lengths.reduce((sum, n) => sum + (n - mean) ** 2, 0) / lengths.length;
  const stdev = Math.sqrt(variance);
  return {
    lengths,
    mean,
    stdev,
    spread: stdev / mean,
    shortest: Math.min(...lengths),
    longest: Math.max(...lengths),
  };
}

/**
 * One length repeated, whatever that length happens to be.
 *
 * Spread only. A narrow longest-minus-shortest band was tried here as a second
 * trigger, on the reasoning that spread is scale-free and so an 8-word swing
 * looks like variety at a mean of 24 and like a lot at a mean of 9. Measurement
 * killed it: adding `band <= 8` moved the human false-positive rate from 7.7% to
 * 7.8% and caught no machine paragraph that spread had not already caught, on
 * either the 98 inputs or the 100 outputs. It is entirely subsumed.
 *
 * The band survives in cadenceInstruction, where it describes a paragraph
 * already known to be flat rather than deciding whether one is.
 */
export function isFlat(cadence: Cadence): boolean {
  return cadence.spread < MIN_SPREAD;
}

/**
 * What to tell the model, in numbers it can act on. "Vary sentence length" has
 * been in the prompt from the start and does not work; a target does.
 */
export function cadenceInstruction(cadence: Cadence): string {
  const parts = [
    `The sentences in this text run ${cadence.lengths.join(', ')} words.`,
    'That steady length is the strongest sign of machine writing here, stronger than any word choice.',
  ];
  if (cadence.shortest > SHORT_SENTENCE) {
    parts.push(
      `Nothing is under ${SHORT_SENTENCE + 1} words. Split one long sentence so at least one comes out under ${SHORT_SENTENCE + 1} words.`,
    );
  }
  if (cadence.longest < LONG_SENTENCE) {
    parts.push(
      `Nothing reaches ${LONG_SENTENCE} words. Merge two related sentences into one longer one, joined with a comma, a semicolon or a subordinating word.`,
    );
  }
  // Two further clauses lived here and were removed by measurement. One named the
  // longest-minus-shortest band, the other named an all-long paragraph and asked
  // for a genuinely short sentence rather than a half-length one. Both read as
  // obviously helpful and both made this instruction worse.
  //
  // Across the same 100 sources, the engine that carried them de-flattened 8 of
  // 29 flat inputs where the engine without them managed 22, and every flat
  // output in that run had already spent its retry. Nothing else in the pacing
  // path had changed, and restoring the prompt wording cut in the same commit
  // moved the count by zero. Nano acts on a short instruction with a number in
  // it; a longer one covering more cases is not a better one.
  //
  // NARROW_BAND and UNIFORM_LONG stay exported and documented so the next attempt
  // starts from the measurement rather than the idea.
  // Splitting alone raises the number while making the prose worse, and the
  // model will do exactly that if only splitting is named: one batch produced a
  // paragraph of thirteen clipped sentences that scored well and read like a
  // machine. Both directions, every time.
  parts.push(
    'Do both, not just splitting. Chopping everything into short sentences is itself a machine tell, and a paragraph needs at least one genuinely long sentence.',
    'Do not even out the result. Short next to long is the point.',
  );
  return parts.join(' ');
}
