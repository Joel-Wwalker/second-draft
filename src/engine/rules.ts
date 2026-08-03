import type { DetectedTell, Span } from '../shared/types';

export interface Rule {
  id: string;
  reason: string;
  /** Must have the g flag (and u where needed). */
  pattern: RegExp;
  fixable: boolean;
  /** Leave matches inside "..." or “...” untouched. */
  skipQuoted?: boolean;
  /** Heuristics only get mentioned to the model when repeated this often. */
  minCountForPrompt?: number;
  replacement?: (match: string) => string;
}

export const RULES: Rule[] = [
  {
    id: 'curly-quote-double',
    reason: 'Curly quotes replaced with straight quotes',
    pattern: /[“”]/g,
    fixable: true,
    replacement: () => '"',
  },
  {
    id: 'curly-quote-single',
    reason: 'Curly apostrophe replaced',
    pattern: /[‘’]/g,
    fixable: true,
    replacement: () => "'",
  },
  {
    id: 'en-dash-range',
    reason: 'En dash range written out',
    pattern: /(\d) ?– ?(?=\d)/g,
    fixable: true,
    skipQuoted: true,
    replacement: match => match.replace(/ ?– ?/, ' to '),
  },
  {
    id: 'em-dash',
    reason: 'Em dash removed (AI tell)',
    pattern: /[ \t]*[—–][ \t]*/g,
    fixable: true,
    skipQuoted: true,
    replacement: () => ', ',
  },
  {
    id: 'double-hyphen',
    reason: 'Double hyphen removed',
    pattern: /[ \t]+--[ \t]+/g,
    fixable: true,
    skipQuoted: true,
    replacement: () => ', ',
  },
  {
    id: 'emoji',
    reason: 'Emoji removed',
    pattern: /[ \t]?(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F)(?:[\p{Extended_Pictographic}\uFE0F\u200D])*[ \t]?/gu,
    fixable: true,
    replacement: () => ' ',
  },
  {
    id: 'chatbot-signoff',
    reason: 'Chatbot filler removed',
    pattern: /\b(?:I hope this helps|Let me know if [^.!?\n]*|Would you like me to [^.!?\n]*)[.!?]?[ \t]*/gi,
    fixable: true,
    replacement: () => '',
  },
  {
    // Every word here earns its place by measurement, not by sounding like
    // something a model would write. `scripts/calibrate-vocab.mjs` scores a
    // candidate against 1000 human-written paragraphs and the 100 machine-written
    // ones from the review batch, and keeps only those appearing in at most 3% of
    // the human prose, at least 2% of the machine prose, and at least three times
    // as often in the second as the first.
    //
    // The list used to hold twenty words chosen by ear, and a review of 100
    // rewrites found the cost: a paragraph carrying meticulously, ultimately
    // twice, Consequently, exacerbated and proactively was reported as having
    // zero tells and returned untouched by the no-rewrite gate below. Not one of
    // those six words was in the list. Meticulously alone appears in 14% of
    // machine paragraphs against 0.1% of human ones.
    //
    // Deliberately absent: arguably. It scores well (0.1% human, 2% machine) but
    // it is an epistemic hedge, and a rule telling the model to replace one is
    // how "the purported trade privileges" became "the trade benefits enjoyed
    // by" in the same review. Catching 2% is not worth asserting as fact what
    // the author declined to.
    id: 'ai-vocab',
    reason: 'AI-associated vocabulary',
    pattern:
      /\b(?:delve(?:s|d)?|tapestry|testament to|underscor(?:es?|ing)|showcas(?:es?|ing)|pivotal|crucial|vibrant|foster(?:s|ing)?|garner(?:s|ed)?|interplay|intricate|intricacies|enduring|moreover|furthermore|additionally|aligns? with|(?:key|vital) (?:role|moment|factor|aspect)|meticulous(?:ly)?|ultimately|consequently|exacerbat(?:e|es|ed|ing)|proactive(?:ly)?|nuanc(?:e|es|ed)|compound(?:ed|ing)|navigat(?:e|es|ed|ing)|landscape|facilitat(?:e|es|ed|ing)|leverag(?:e|es|ed|ing)|robust|streamlin(?:e|es|ed|ing)|holistic(?:ally)?|multifaceted|profound(?:ly)?|invaluable|paramount|significantly|essentially|effectively)\b/gi,
    fixable: false,
    skipQuoted: true,
  },
  {
    id: 'negative-parallelism',
    reason: 'Negative parallelism (not just X, but Y)',
    pattern: /\bnot (?:just|only|merely)\b[^.!?\n]{0,80}\bbut\b/gi,
    fixable: false,
  },
  {
    id: 'rule-of-three',
    reason: 'Possible rule-of-three cadence',
    pattern: /\b[\w'’-]+, [\w'’-]+, and [\w'’-]+\b/g,
    fixable: false,
    minCountForPrompt: 2,
  },
  {
    id: 'title-case-heading',
    reason: 'Title-case heading',
    pattern: /^#{1,6} (?:[A-Z][\w'’-]* ){2,}[A-Z][\w'’-]*[ \t]*$/gm,
    fixable: false,
  },
  {
    id: 'bold-header-list',
    reason: 'Bolded inline-header list item',
    pattern: /^[ \t]*[-*•] \*\*[^*\n]+:?\*\*/gm,
    fixable: false,
  },
];

const CUSTOM_TELL_MAX_LENGTH = 80;

/** Escape regex metacharacters so a plain phrase matches only itself. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds detect-only rules from user-supplied plain phrases (not regexes). Each phrase is
 * matched case-insensitively, on word boundaries where the phrase's own edges are word
 * characters, so a phrase never matches inside a larger word. Empty, whitespace-only, and
 * phrases over 80 characters are dropped rather than turned into a rule.
 */
export function customRules(phrases: string[]): Rule[] {
  const rules: Rule[] = [];
  for (const raw of phrases) {
    const phrase = raw.trim();
    if (!phrase || phrase.length > CUSTOM_TELL_MAX_LENGTH) continue;
    const escaped = escapeRegExp(phrase);
    const open = /^\w/.test(phrase) ? '\\b' : '';
    const close = /\w$/.test(phrase) ? '\\b' : '';
    rules.push({
      id: 'custom',
      reason: 'Your custom tell',
      pattern: new RegExp(`${open}${escaped}${close}`, 'gi'),
      fixable: false,
    });
  }
  return rules;
}

/**
 * The share of paragraphs carrying a double quotation mark on their first or
 * last character, 0 to 1. High means the marks are pasted formatting around
 * whole paragraphs; low means any marks are quotations inside prose.
 *
 * Replaces a sequential-pairing coverage estimate that a real paste defeated:
 * the first paragraph lacked its opening mark, every pair misaligned, and the
 * "coverage" measured the gaps between paragraphs instead of the text. The
 * gate never tripped, the protect-quotations instruction stayed in every
 * prompt, and each edge-quoted paragraph was deterministically echoed, whole
 * or salvaged alone, through seven measured runs. Counting edges cannot
 * misalign.
 */
export function wrapperQuoteShare(text: string): number {
  const paras = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  // Wrapper formatting is a multi-paragraph pattern. A single paragraph that
  // opens with a mark is ordinary prose starting on a quotation, and stripping
  // it would delete half of what somebody said.
  if (paras.length < 2) return 0;
  const edged = paras.filter(p => /^["“”]/.test(p) || /["“”]$/.test(p)).length;
  return edged / paras.length;
}

/**
 * Removes quotation marks that wrap whole paragraphs, in code, before any model
 * sees the text.
 *
 * The prompt-only version of this ("these marks are formatting, rewrite the
 * text inside them") turned out to be a request, and a small model treats a
 * page of quoted paragraphs as untouchable often enough that a five-paragraph
 * paste came back verbatim on most runs. Deleting the marks is not a request.
 * Only wrapper marks go: a mark at a paragraph edge, or a stray unpaired one;
 * quotation marks inside a paragraph's prose stay where they are.
 */
export function stripWrapperQuotes(text: string): string {
  return text
    .split(/(\n\s*\n)/)
    .map(part =>
      /\n/.test(part) ? part : part.replace(/^\s*["“”]+/, '').replace(/["“”]+\s*$/, ''),
    )
    .join('');
}

export function quotedRegions(text: string): Span[] {
  const spans: Span[] = [];
  const re = /(?<!\w)"[^"\n]{1,300}"(?!\w)|“[^”\n]{1,300}”/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    spans.push({ start: m.index, end: m.index + m[0].length });
  }
  return spans;
}

function intersects(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

export function detect(text: string, extra: Rule[] = []): DetectedTell[] {
  const quoted = quotedRegions(text);
  const tells: DetectedTell[] = [];
  for (const rule of [...RULES, ...extra]) {
    rule.pattern.lastIndex = 0;
    for (let m = rule.pattern.exec(text); m; m = rule.pattern.exec(text)) {
      const span: Span = { start: m.index, end: m.index + m[0].length };
      if (m[0].length === 0) {
        rule.pattern.lastIndex++;
        continue;
      }
      if (rule.skipQuoted && quoted.some(q => intersects(span, q))) continue;
      tells.push({ ruleId: rule.id, span, excerpt: m[0].trim(), reason: rule.reason });
    }
  }
  return tells.sort((a, b) => a.span.start - b.span.start);
}

export function applyFixes(text: string): string {
  let out = text;
  for (const rule of RULES) {
    if (!rule.fixable || !rule.replacement) continue;
    out = replaceOutsideQuotes(out, rule);
  }
  return tidy(out);
}

function replaceOutsideQuotes(text: string, rule: Rule): string {
  const quoted = rule.skipQuoted ? quotedRegions(text) : [];
  let out = '';
  let last = 0;
  rule.pattern.lastIndex = 0;
  for (let m = rule.pattern.exec(text); m; m = rule.pattern.exec(text)) {
    if (m[0].length === 0) {
      rule.pattern.lastIndex++;
      continue;
    }
    const span: Span = { start: m.index, end: m.index + m[0].length };
    out += text.slice(last, span.start);
    out += quoted.some(q => intersects(span, q)) ? m[0] : rule.replacement!(m[0]);
    last = span.end;
  }
  return out + text.slice(last);
}

/** Cleanup after mechanical replacements. */
export function tidy(text: string): string {
  return text
    .replace(/ ([,.;:!?])/g, '$1')
    .replace(/, *,/g, ',')
    .replace(/[ \t]+$/gm, '')
    .replace(/^ (?=\S)/gm, '');
}
