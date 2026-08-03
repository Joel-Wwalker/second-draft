import { describe, expect, test } from 'vitest';
import { applyFixes, customRules, detect  , wrapperQuoteShare } from '../src/engine/rules';

describe('applyFixes', () => {
  test('replaces em dashes with commas', () => {
    expect(applyFixes('The plan—announced late—failed.')).toBe('The plan, announced late, failed.');
  });

  test('writes out numeric en dash ranges', () => {
    expect(applyFixes('It ran 1990–1995.')).toBe('It ran 1990 to 1995.');
  });

  test('straightens curly quotes and apostrophes', () => {
    expect(applyFixes('He said “fine” and left.')).toBe('He said "fine" and left.');
    expect(applyFixes('don’t')).toBe("don't");
  });

  test('replaces spaced double hyphens', () => {
    expect(applyFixes('The changes -- long overdue -- landed.')).toBe('The changes, long overdue, landed.');
  });

  test('strips emoji', () => {
    expect(applyFixes('Launch 🚀 ready ✅ now')).toBe('Launch ready now');
  });

  test('removes chatbot sign-offs', () => {
    expect(applyFixes('Here is the summary. I hope this helps! Let me know if you need more.'))
      .toBe('Here is the summary.');
  });

  test('leaves em dashes inside quotes alone', () => {
    expect(applyFixes('He wrote "wait — really?" and left.')).toBe('He wrote "wait — really?" and left.');
  });

  test('preserves markdown indentation and double spaces', () => {
    expect(applyFixes('- item\n  - nested\n    - code')).toBe('- item\n  - nested\n    - code');
    expect(applyFixes('One.  Two spaces stay.')).toBe('One.  Two spaces stay.');
  });

  test('strips line-leading emoji without leaving a leading space', () => {
    expect(applyFixes('🚀 Launch\n✅ Done')).toBe('Launch\nDone');
  });

  test('keeps trademark, copyright, and arrow symbols', () => {
    expect(applyFixes('Acme® sells Widget™ © 2026, a ↔ b')).toBe('Acme® sells Widget™ © 2026, a ↔ b');
  });

  test('unbalanced quotes do not shield distant dashes', () => {
    expect(applyFixes('He said "hello and the plan — bold. She said "bye"'))
      .toBe('He said "hello and the plan, bold. She said "bye"');
  });
});

describe('detect', () => {
  test('reports em dashes with rule id and span', () => {
    const tells = detect('A—B');
    expect(tells).toHaveLength(1);
    expect(tells[0]).toMatchObject({ ruleId: 'em-dash', span: { start: 1, end: 2 } });
  });

  test('skips quoted regions for skipQuoted rules', () => {
    const tells = detect('say "A—B" now');
    expect(tells.filter(t => t.ruleId === 'em-dash')).toHaveLength(0);
  });
});

describe('customRules', () => {
  test('escapes regex metacharacters so they match literally and never throw', () => {
    const rules = customRules(['x.y(z)']);
    expect(rules).toHaveLength(1);
    expect(() => detect('Notes: x.y(z) appears here.', rules)).not.toThrow();
    expect(detect('Notes: x.y(z) appears here.', rules).filter(t => t.ruleId === 'custom')).toHaveLength(1);
    // A literal "." must not act as a wildcard for another character.
    expect(detect('Notes: xQy(z) appears here.', rules).filter(t => t.ruleId === 'custom')).toHaveLength(0);
    // Literal "(" ")" must not act as a non-capturing grouping construct.
    expect(detect('See x.yz today, no parens.', rules).filter(t => t.ruleId === 'custom')).toHaveLength(0);
  });

  test('never throws building rules from phrases that look like unbalanced regex', () => {
    expect(() => customRules(['a (b [c', 'weird * + ? group)', '[unterminated', 'a{2,'])).not.toThrow();
  });

  test('ignores empty, whitespace-only, and overlong phrases (80 chars ok, 81 dropped)', () => {
    const rules = customRules(['', '   ', '\t\n', 'x'.repeat(81), 'x'.repeat(80), 'keep me']);
    expect(rules).toHaveLength(2);
  });

  test('matches case-insensitively but only on word boundaries', () => {
    const rules = customRules(['cat']);
    expect(detect('The CAT sat on a mat.', rules).filter(t => t.ruleId === 'custom')).toHaveLength(1);
    expect(
      detect('The category is concatenated by a bobcat.', rules).filter(t => t.ruleId === 'custom'),
    ).toHaveLength(0);
  });

  test('produces detect-only rules tagged with the shared custom id and reason', () => {
    const [rule] = customRules(['delve into it']);
    expect(rule).toMatchObject({ id: 'custom', reason: 'Your custom tell', fixable: false });
    expect(rule?.replacement).toBeUndefined();
  });
});

describe('detect with extra rules', () => {
  test('extra rules are found alongside the built-in ones', () => {
    const extra = customRules(['as an ai']);
    const tells = detect('Well, as an AI I cannot delve into this—sorry.', extra);
    expect(tells.some(t => t.ruleId === 'custom')).toBe(true);
    expect(tells.some(t => t.ruleId === 'ai-vocab')).toBe(true);
    expect(tells.some(t => t.ruleId === 'em-dash')).toBe(true);
  });

  test('extra rules from one call do not leak into a later call that omits them', () => {
    const extra = customRules(['unicorn sighting']);
    expect(detect('There was a unicorn sighting today.', extra).some(t => t.ruleId === 'custom')).toBe(true);
    // Same text, no extra rules this time: the earlier custom phrase must not still be flagged.
    expect(detect('There was a unicorn sighting today.')).toHaveLength(0);
  });

  test('repeated calls with the same extra rules stay correct across different texts', () => {
    const extra = customRules(['zebra']);
    expect(detect('a zebra sighting', extra).filter(t => t.ruleId === 'custom')).toHaveLength(1);
    expect(detect('nothing to see', extra)).toHaveLength(0);
    expect(
      detect('a zebra here and another zebra there', extra).filter(t => t.ruleId === 'custom'),
    ).toHaveLength(2);
  });
});

test('wrapperQuoteShare counts edge-quoted paragraphs and survives a missing first mark', () => {
  // The paste that defeated the pairing version: the first paragraph has no
  // opening mark, only a trailing one, and the rest are fully wrapped. Pairing
  // misaligned on it and measured the gaps between paragraphs; counting edges
  // cannot misalign.
  const usersShape = [
    'Alexander led his army east and the campaign ran on for a decade in the sun."',
    '"Dear Mr. Johnson, I am writing to ask for an extension on the project."',
    '"My first day at a new school was the most memorable event of my life."',
    '"Artificial intelligence has created serious concerns about personal privacy."',
  ].join('\n\n');
  expect(wrapperQuoteShare(usersShape)).toBe(1);

  // A real quotation inside ordinary prose touches no paragraph edge.
  const quoting =
    'The chair opened the meeting with a warning. "We will not fund this twice," she said.\n\n' +
    'The rest of the session covered the roof repairs and the winter schedule.';
  expect(wrapperQuoteShare(quoting)).toBe(0);
  expect(wrapperQuoteShare('')).toBe(0);
});

test('a lone paragraph opening on a quotation is never wrapper formatting', () => {
  expect(wrapperQuoteShare('"We grew fast," she said, and the numbers back her up.')).toBe(0);
});
