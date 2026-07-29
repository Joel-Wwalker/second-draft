/** Natural replacements for AI-flavored vocabulary. Lowercase keys, best option first. */
export const ALTERNATIVES: Record<string, string[]> = {
  additionally: ['also', 'and', 'plus'],
  arguably: ['maybe', 'possibly'],
  comprehensive: ['complete', 'full', 'thorough'],
  crucial: ['important', 'essential', 'big'],
  delve: ['dig', 'look', 'get'],
  elevate: ['raise', 'lift', 'improve'],
  embark: ['start', 'begin', 'set out'],
  enduring: ['lasting', 'long-running', 'durable'],
  ensure: ['make sure', 'guarantee'],
  essentially: ['basically', 'in short'],
  facilitate: ['help', 'ease', 'run'],
  foster: ['build', 'support', 'grow'],
  furthermore: ['also', 'and', 'on top of that'],
  garner: ['get', 'gather', 'win'],
  holistic: ['whole', 'complete', 'all-round'],
  innovative: ['new', 'inventive', 'fresh'],
  interplay: ['mix', 'interaction', 'back and forth'],
  intricate: ['complex', 'detailed', 'fiddly'],
  landscape: ['field', 'scene', 'area'],
  leverage: ['use', 'tap', 'draw on'],
  meticulous: ['careful', 'thorough', 'exacting'],
  moreover: ['also', 'and', 'besides'],
  myriad: ['many', 'countless', 'a lot of'],
  navigate: ['handle', 'deal with', 'work through'],
  notably: ['especially', 'in particular'],
  nuanced: ['subtle', 'fine-grained'],
  optimize: ['improve', 'tune', 'tighten'],
  paradigm: ['model', 'pattern'],
  plethora: ['plenty', 'lots', 'a glut'],
  pivotal: ['major', 'decisive', 'important'],
  profound: ['deep', 'big', 'serious'],
  realm: ['area', 'field', 'world'],
  robust: ['strong', 'solid', 'sturdy'],
  seamless: ['smooth', 'easy'],
  showcase: ['show', 'display', 'feature'],
  significant: ['big', 'major', 'notable'],
  streamline: ['simplify', 'tighten', 'speed up'],
  synergy: ['teamwork', 'fit'],
  tapestry: ['mix', 'range', 'blend'],
  testament: ['sign', 'proof', 'evidence'],
  transformative: ['sweeping', 'big'],
  ultimately: ['in the end', 'finally'],
  underscore: ['show', 'stress', 'point to'],
  utilize: ['use'],
  vibrant: ['lively', 'bright', 'busy'],
  vital: ['essential', 'needed'],
};

export interface AltSpan {
  start: number;
  end: number;
  word: string;
  options: string[];
}

const WORD_RE = new RegExp(`\\b(${Object.keys(ALTERNATIVES).join('|')})(s|d|ing|es)?\\b`, 'gi');

/** Swappable words in the given text, skipping any that fall inside a skip span. */
export function findAlternatives(text: string, skip: Array<{ start: number; end: number }> = []): AltSpan[] {
  const spans: AltSpan[] = [];
  WORD_RE.lastIndex = 0;
  for (let m = WORD_RE.exec(text); m; m = WORD_RE.exec(text)) {
    const start = m.index;
    const end = start + m[0].length;
    if (m[2]) continue; // only offer swaps for the plain form; suffixed forms need conjugation
    if (skip.some(s => start < s.end && s.start < end)) continue;
    const options = ALTERNATIVES[m[1]!.toLowerCase()];
    if (!options) continue;
    spans.push({ start, end, word: m[0], options });
  }
  return spans;
}

/**
 * Move ranges that sit after a swapped word. Swapping "delve" for "dig" makes
 * the text two characters shorter, and every highlight downstream has to move
 * with it or it lands on the wrong words.
 */
export function shiftRangesAfter<T extends { range: { start: number; end: number } }>(
  items: readonly T[],
  after: number,
  delta: number,
): T[] {
  if (delta === 0) return [...items];
  return items.map(item =>
    item.range.start >= after
      ? { ...item, range: { start: item.range.start + delta, end: item.range.end + delta } }
      : item,
  );
}

/** Replace a span, matching the original word's capitalization. */
export function swapWord(text: string, span: { start: number; end: number }, option: string): string {
  const original = text.slice(span.start, span.end);
  const cased = /^[A-Z]/.test(original) ? option.charAt(0).toUpperCase() + option.slice(1) : option;
  return text.slice(0, span.start) + cased + text.slice(span.end);
}
