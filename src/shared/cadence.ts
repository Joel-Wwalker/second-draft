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

/** Below this there is not enough text for rhythm to mean anything. */
export const MIN_SENTENCES = 4;
export const MIN_WORDS = 55;
/** A sentence this short or shorter counts as a change of pace. */
export const SHORT_SENTENCE = 11;
/** A sentence this long counts as the other end of the range. */
export const LONG_SENTENCE = 25;
/**
 * Spread below this reads as one length repeated. Chosen from the two samples
 * that prompted this: our own output measured 0.19 and a competitor's 0.18, and
 * both read flat. Prose that varies on purpose sits well above it.
 */
export const MIN_SPREAD = 0.3;

function wordsIn(part: string): number {
  return part.trim().split(/\s+/).filter(Boolean).length;
}

/** Null when the text is too short to say anything honest about its rhythm. */
export function measureCadence(text: string): Cadence | null {
  const lengths = text
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

/** One length repeated, whatever that length happens to be. */
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
      `Nothing is under ${SHORT_SENTENCE + 1} words. Split one of the long sentences so that at least one comes out under ${SHORT_SENTENCE + 1} words.`,
    );
  }
  if (cadence.longest < LONG_SENTENCE) {
    parts.push(`Nothing reaches ${LONG_SENTENCE} words. Join two related sentences into one longer one.`);
  }
  parts.push('Do not even out the result. Short next to long is the point.');
  return parts.join(' ');
}
