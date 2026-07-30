/**
 * Sentence shape, which is the tell that survived fixing sentence length.
 *
 * Measuring length worked: the model started producing a nine-word sentence next
 * to a twenty-five word one. Then every one of those sentences turned out to open
 * the same way, subject followed by verb, seven times in a row. The model gave us
 * exactly what we measured and nothing more, which is what always happens.
 *
 * A person varies where a sentence starts, not only how long it runs. They put a
 * clause in front sometimes: "After the war ended, ..." rather than "The war
 * ended and ...". This module counts that, so the engine can ask for it in
 * numbers.
 *
 * No parser here, so the test is the opening word. Fronted material almost always
 * begins with a subordinator, a preposition, or an adverb, and a bare subject
 * almost never does. That misses some real fronting and is deliberately
 * conservative: a false negative asks the model for variety it already has, while
 * a false positive would push it to mangle plain sentences that were fine.
 */

/**
 * Words that begin something before the main clause. Not an exhaustive list of
 * English function words, only the ones that reliably signal fronting.
 */
const FRONTED_OPENERS = new Set([
  'after', 'although', 'as', 'because', 'before', 'besides', 'beyond', 'but',
  'by', 'despite', 'during', 'even', 'except', 'for', 'from', 'given', 'if',
  'in', 'inside', 'instead', 'like', 'meanwhile', 'once', 'on', 'onto', 'other',
  'outside', 'over', 'rather', 'since', 'so', 'though', 'through', 'to',
  'toward', 'under', 'unless', 'until', 'upon', 'when', 'whenever', 'where',
  'whereas', 'wherever', 'whether', 'while', 'with', 'within', 'without', 'yet',
  // Time and sequence adverbs, which front just as often.
  'afterward', 'again', 'already', 'eventually', 'finally', 'first', 'later',
  'now', 'often', 'soon', 'still', 'sometimes', 'then', 'today', 'usually',
]);

export interface Structure {
  sentences: number;
  /** Sentences that put something before the subject. */
  fronted: number;
  /** How many the text ought to have, given its length. */
  frontedTarget: number;
  /** The opening word used most, and how many sentences start with it. */
  commonestOpener: string;
  commonestOpenerCount: number;
}

/** Below this there is nothing to say about variety. */
export const MIN_SENTENCES = 5;
/** One fronted opener per this many sentences, rounded up. */
export const SENTENCES_PER_FRONTED = 4;
/** The same opening word this many times reads as a list, not as prose. */
export const MAX_SAME_OPENER = 3;

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function firstWord(sentence: string): string {
  const match = sentence.match(/[A-Za-z'’-]+/);
  return match ? match[0].toLowerCase() : '';
}

/** Null when the text is too short to judge. */
export function measureStructure(text: string): Structure | null {
  const sentences = sentencesOf(text);
  if (sentences.length < MIN_SENTENCES) return null;

  const openers = new Map<string, number>();
  let fronted = 0;
  for (const sentence of sentences) {
    const word = firstWord(sentence);
    if (!word) continue;
    if (FRONTED_OPENERS.has(word)) fronted += 1;
    openers.set(word, (openers.get(word) ?? 0) + 1);
  }

  let commonestOpener = '';
  let commonestOpenerCount = 0;
  for (const [word, count] of openers) {
    if (count > commonestOpenerCount) {
      commonestOpener = word;
      commonestOpenerCount = count;
    }
  }

  return {
    sentences: sentences.length,
    fronted,
    frontedTarget: Math.ceil(sentences.length / SENTENCES_PER_FRONTED),
    commonestOpener,
    commonestOpenerCount,
  };
}

/** Every sentence built the same way, however much their lengths differ. */
export function isMonotonous(structure: Structure): boolean {
  return structure.fronted < structure.frontedTarget || structure.commonestOpenerCount >= MAX_SAME_OPENER;
}

/** Numbers and a target, because "vary your sentences" is what already failed. */
export function structureInstruction(structure: Structure): string {
  const parts: string[] = [];
  if (structure.fronted < structure.frontedTarget) {
    parts.push(
      `Of ${structure.sentences} sentences, only ${structure.fronted} start with anything before the subject.`,
      `Rewrite so at least ${structure.frontedTarget} of them open with a clause or a phrase first, as in "After the war ended, she ..." rather than "She ...".`,
    );
  }
  if (structure.commonestOpenerCount >= MAX_SAME_OPENER) {
    parts.push(
      `${structure.commonestOpenerCount} sentences begin with the word "${structure.commonestOpener}". Change all but one of those.`,
    );
  }
  parts.push('Keep the meaning and every fact. This is about how sentences are built, not what they say.');
  return parts.join(' ');
}
