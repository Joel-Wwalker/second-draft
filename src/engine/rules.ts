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
    pattern: /[ \t]?\p{Extended_Pictographic}(?:[\p{Extended_Pictographic}\u{FE0F}\u{200D}])*[ \t]?/gu,
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
];

export function quotedRegions(text: string): Span[] {
  const spans: Span[] = [];
  const re = /"[^"\n]{1,300}"|“[^”\n]{1,300}”/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    spans.push({ start: m.index, end: m.index + m[0].length });
  }
  return spans;
}

function intersects(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

export function detect(text: string): DetectedTell[] {
  const quoted = quotedRegions(text);
  const tells: DetectedTell[] = [];
  for (const rule of RULES) {
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
    const quoted = rule.skipQuoted ? quotedRegions(out) : [];
    rule.pattern.lastIndex = 0;
    out = out.replace(rule.pattern, (match, ...rest) => {
      const offset = rest[rest.length - 2] as number;
      const span: Span = { start: offset, end: offset + match.length };
      if (quoted.some(q => intersects(span, q))) return match;
      return rule.replacement!(match);
    });
  }
  return tidy(out);
}

/** Cleanup after mechanical replacements. */
export function tidy(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ([,.;:!?])/g, '$1')
    .replace(/, *,/g, ',')
    .replace(/^[ \t]+|[ \t]+$/gm, '');
}
