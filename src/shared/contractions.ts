/**
 * Mechanical contractions for first-person prose.
 *
 * The prompt asked twice, once generically and once as a direct order gated on
 * first person, and a measured run still returned a personal narrative with
 * "because I did not know anyone" intact while the same instruction worked in a
 * letter one paragraph over. A reviewer called the uncontracted form the
 * loudest machine tell in the paragraph. Code does not have moods, so the safe
 * subset is applied mechanically after the rewrite.
 *
 * Conservative on purpose. Only forms whose expansion is never ambiguous are
 * contracted, quoted spans are left alone, and "not" followed by an emphasis
 * word stays: "did not only" and "did not, in fact" are constructions, not
 * stiffness.
 */

const AUX_NOT =
  /\b(do|does|did|was|were|is|are|has|have|had|would|could|should)\s+not\b(?!\s*(?:only|just|merely|,|in fact))/gi;

const PERSONAL: Array<[RegExp, string]> = [
  [/\bI am\b/g, "I'm"],
  [/\bI have\b(?!\s+(?:no|not|never)\b)/g, "I've"],
  [/\bI will\b/g, "I'll"],
  [/\bI would\b/g, "I'd"],
  [/\bit is\b(?=\s+(?:a|an|the|not|hard|easy|difficult|strange|odd|funny|weird)\b)/g, "it's"],
];

/** True when the text is someone talking about themselves. */
export function isFirstPerson(text: string): boolean {
  return /(?:^|[^\w'])(?:I|I'm|I've|my|me)(?:[^\w']|$)/i.test(text);
}

export function applyContractions(text: string): string {
  // Never touch quoted speech: those are someone's exact words.
  const parts = text.split(/("[^"\n]{1,300}")/);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      let out = part.replace(AUX_NOT, (m, aux: string) => {
        const base = aux.toLowerCase() === 'will' ? 'won' : aux;
        return `${base}n't`;
      });
      for (const [re, to] of PERSONAL) out = out.replace(re, to);
      return out;
    })
    .join('');
}
