import { describe, expect, test } from 'vitest';
import { applyFixes, detect } from '../src/engine/rules';

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
