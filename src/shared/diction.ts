import { LONG_WORD_LETTERS } from './profile';
import { proseOnly } from './prose';

/**
 * How heavy the vocabulary is, which turned out to be the strongest single signal
 * of machine writing available here.
 *
 * Found by measurement rather than invented. Over 1000 Wikipedia article
 * introductions, the share of words running to eight letters or more has a median
 * of 0.19 and a 90th percentile of 0.28. Over 60 paragraphs from the on-device
 * model, the median is 0.34. Only 5% of the machine paragraphs land inside the
 * human interquartile range, better separation than sentence rhythm manages.
 *
 * Note that profile.ts rounds this rate to two decimals for display and this
 * module does not, so a threshold calibrated on one does not transfer to the
 * other. Doing exactly that put the false positive rate at 13.8% instead of the
 * intended 9% until it was caught.
 *
 * This is what the ai-vocab rule is reaching for with its list of forty-odd words,
 * except measured continuously. A model does not only pick "delve" and "tapestry";
 * it reaches for longer, more Latinate words throughout, and a word list can only
 * ever catch the ones someone thought to write down.
 */

export interface Diction {
  /** Share of words with at least LONG_WORD_LETTERS letters. */
  rate: number;
  words: number;
  /** The long words themselves, for naming in a prompt. Proper nouns excluded. */
  heavy: string[];
}

/** Below this the rate says more about the excerpt than the writing. */
export const MIN_WORDS = 55;

/**
 * Above this share of long words the writing reads as machine-made.
 *
 * 0.30 sits just above the human 90th percentile of 0.281 and flags 5.9% of the
 * human corpus against 75.0% of the machine corpus. Loosening to 0.29 buys 1.7
 * points of machine text for 2 points of false positives, which is the wrong
 * trade: every false positive tells somebody their own vocabulary is robotic.
 */
export const MAX_LONG_WORD_RATE = 0.3;

/** How many examples to hand the model. Enough to act on, not a vocabulary list. */
const MAX_EXAMPLES = 6;

function tokens(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function letters(token: string): string {
  return token.replace(/[^A-Za-z’']/g, '');
}

export function measureDiction(text: string): Diction | null {
  const all = tokens(proseOnly(text));
  const words = all.filter(t => letters(t).length > 0);
  if (words.length < MIN_WORDS) return null;

  const long = words.filter(t => letters(t).length >= LONG_WORD_LETTERS);
  // Every capitalised word is skipped, whatever its position. Some of those are
  // ordinary words that merely open a sentence, and losing them as examples costs
  // nothing, because six examples out of a paragraph is plenty. Offering a name
  // instead would invite the model to reword a fact, which is the one thing the
  // rewrite must never do.
  const heavy: string[] = [];
  for (const token of words) {
    const word = letters(token);
    if (word.length < LONG_WORD_LETTERS) continue;
    if (/^[A-Z]/.test(word)) continue;
    const plain = word.toLowerCase();
    if (!heavy.includes(plain)) heavy.push(plain);
  }

  return { rate: long.length / words.length, words: words.length, heavy };
}

export function isOverwrought(diction: Diction): boolean {
  return diction.rate > MAX_LONG_WORD_RATE;
}

/**
 * A rewrite may not raise its long-word share past this much above its own
 * input. Relative to the input rather than to a corpus, because whatever
 * register the user wrote in, a rewrite has no business raising it. At typical
 * paragraph lengths this is roughly two extra heavy words per seventy.
 *
 * The limit of this check, recorded from the Roman Empire sample: a rewrite
 * that upgraded five words (built to constructed, parts to portions) while
 * shedding heavy words elsewhere moved the rate from 0.194 to 0.177 and slid
 * under it. Sideways churn is the prompt's job and the surviving-tells retry's
 * job; this catches only the net-heavier case.
 */
export const MAX_ADDED_LONG_RATE = 0.03;

/** Long words the rewrite introduced that its source did not have. */
export function addedHeavyWords(original: string, rewritten: string): string[] {
  const had = new Set(
    tokens(proseOnly(original))
      .map(letters)
      .filter(word => word.length >= LONG_WORD_LETTERS)
      .map(word => word.toLowerCase()),
  );
  const added: string[] = [];
  for (const token of tokens(proseOnly(rewritten))) {
    const word = letters(token);
    if (word.length < LONG_WORD_LETTERS) continue;
    if (/^[A-Z]/.test(word)) continue; // a name is a fact, not a word choice
    const plain = word.toLowerCase();
    if (had.has(plain) || added.includes(plain)) continue;
    added.push(plain);
  }
  return added;
}

/** Empty when the rewrite kept its input's weight, or either side is too short to judge. */
export function vocabularyDrift(original: string, rewritten: string): string {
  const before = measureDiction(original);
  const after = measureDiction(rewritten);
  if (!before || !after) return '';
  if (after.rate - before.rate <= MAX_ADDED_LONG_RATE) return '';
  const added = addedHeavyWords(original, rewritten).slice(0, 6);
  const named = added.length > 0 ? ` It added ${added.join(', ')}.` : '';
  return `Your rewrite made the vocabulary heavier than the original.${named} Put the original's plainer words back, and make the rewrite different by restructuring sentences instead.`;
}

/** Numbers and examples, the shape of instruction that the model acts on. */
export function dictionInstruction(diction: Diction): string {
  const perHundred = Math.round(diction.rate * 100);
  const parts = [
    `${perHundred} words in every 100 here run to eight letters or more. In writing by people that figure is nearer 19, and this is the clearest sign of machine writing in the text.`,
  ];
  if (diction.heavy.length > 0) {
    parts.push(`Among them: ${diction.heavy.slice(0, MAX_EXAMPLES).join(', ')}.`);
  }
  parts.push(
    'Replace each with the shorter word a person would actually use, and only where it is at least as precise: "analyzed" for "conducted an analysis of", not "looked at". Keep names, places and technical terms exactly as they are, and never trade precision for plainness; a vaguer short word is worse than the long one.',
  );
  return parts.join(' ');
}
