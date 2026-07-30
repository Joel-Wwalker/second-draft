/**
 * Strip lines that are headings rather than prose.
 *
 * A heading has no sentence punctuation, so splitting on sentence enders merges
 * it into the sentence that follows and inflates that sentence's measured
 * length. Found on a real four-section essay: "Ancient Egypt" plus an
 * eleven-word opener measured as one thirteen-word sentence.
 *
 * The rule is deliberately loose. A short line with no full stop is a heading;
 * a long line is prose even unterminated. Dropping the odd stray list item
 * costs nothing, because everything here measures rates over whole texts.
 */
export function proseOnly(text: string): string {
  return text
    .split(/\n+/)
    .filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      return /[.!?]/.test(trimmed) || trimmed.split(/\s+/).length > 8;
    })
    .join('\n');
}
