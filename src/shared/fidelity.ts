/**
 * Checks that a rewrite did not lose anything from the original. A rewrite can
 * remove every AI tell and still be wrong: models drop sentences, round numbers
 * away, rename people, and truncate when they run out of output budget. The
 * tells score cannot see any of that, so this is a separate pass.
 *
 * Pure and deterministic: no DOM, no model, no network.
 */

export interface FidelityIssue {
  kind: 'missing-facts' | 'shorter' | 'fewer-paragraphs' | 'quote-changed';
  /** One short sentence for the card, already user facing. */
  message: string;
}

/** A rewrite this much shorter than the original has usually lost content. */
const SHORT_RATIO = 0.6;
/** Facts named in the message; more than this and the list is noise. */
const MAX_LISTED = 4;

export function checkFidelity(original: string, rewritten: string): FidelityIssue[] {
  const issues: FidelityIssue[] = [];

  const missing = missingFacts(original, rewritten);
  if (missing.length > 0) {
    const shown = missing.slice(0, MAX_LISTED).join(', ');
    const rest = missing.length > MAX_LISTED ? ` and ${missing.length - MAX_LISTED} more` : '';
    issues.push({
      kind: 'missing-facts',
      message: `Missing from the rewrite: ${shown}${rest}.`,
    });
  }

  const originalWords = words(original).length;
  const rewrittenWords = words(rewritten).length;
  if (originalWords > 0 && rewrittenWords / originalWords < SHORT_RATIO) {
    const percent = Math.round((1 - rewrittenWords / originalWords) * 100);
    issues.push({
      kind: 'shorter',
      message: `The rewrite is ${percent} percent shorter, so it may have dropped content.`,
    });
  }

  const originalParagraphs = paragraphs(original);
  const rewrittenParagraphs = paragraphs(rewritten);
  if (rewrittenParagraphs < originalParagraphs) {
    issues.push({
      kind: 'fewer-paragraphs',
      message: `The original had ${originalParagraphs} paragraphs and the rewrite has ${rewrittenParagraphs}.`,
    });
  }

  const changedQuote = quotes(original).find(q => !rewritten.includes(q));
  if (changedQuote !== undefined) {
    issues.push({
      kind: 'quote-changed',
      message: 'Text inside quotation marks was changed, and quotes should stay word for word.',
    });
  }

  return issues;
}

/**
 * Tokens that carry checkable content: numbers, money, dates, urls, emails, and
 * capitalized words that are not simply the start of a sentence. Losing one of
 * these is a factual change, not a stylistic one.
 *
 * Known gap, on purpose: a proper noun that only ever appears at the start of a
 * sentence is indistinguishable from an ordinary capitalized opener ("Martinez
 * signed it" against "Teams struggle with it"), so those are skipped. A false
 * warning about a word that was never lost teaches people to ignore the
 * warnings, which costs more than the miss.
 */
function facts(text: string): string[] {
  const found = new Set<string>();
  // Money keeps its scale suffix, so "$4.2M" is one fact rather than "$4.2".
  for (const m of text.matchAll(
    /\$[\d,.]+\s?(?:[KMB]|billion|million|thousand)?|\b\d[\d,.:/%-]*\b|\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\b|\bhttps?:\/\/\S+/g,
  )) {
    const value = m[0].replace(/[.,]$/, '');
    if (value.length > 0) found.add(value);
  }
  const sentenceStarts = new Set<string>();
  for (const m of text.matchAll(/(?:^|[.!?]\s+)([A-Z][a-z]+)/g)) {
    if (m[1]) sentenceStarts.add(m[1]);
  }
  for (const m of text.matchAll(/\b[A-Z][a-z]{2,}\b/g)) {
    const value = m[0];
    if (!sentenceStarts.has(value)) found.add(value);
  }
  return [...found];
}

function missingFacts(original: string, rewritten: string): string[] {
  const lower = rewritten.toLowerCase();
  return facts(original).filter(fact => !lower.includes(fact.toLowerCase()));
}

function words(text: string): string[] {
  return text.match(/\S+/g) ?? [];
}

function paragraphs(text: string): number {
  return text.split(/\n{2,}/).filter(part => part.trim().length > 0).length;
}

function quotes(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/"([^"\n]{8,300})"|“([^”\n]{8,300})”/g)) {
    const inner = m[1] ?? m[2];
    if (inner) found.push(inner);
  }
  return found;
}
