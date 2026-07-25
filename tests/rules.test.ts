import { describe, expect, test } from 'vitest';
import { applyFixes, detect } from '../src/engine/rules';

describe('applyFixes', () => {
  test('replaces em dashes with commas', () => {
    const input = 'The plan' + String.fromCharCode(0x2014) + 'announced late' + String.fromCharCode(0x2014) + 'failed.';
    expect(applyFixes(input)).toBe('The plan, announced late, failed.');
  });

  test('writes out numeric en dash ranges', () => {
    const input = 'It ran 1990' + String.fromCharCode(0x2013) + '1995.';
    expect(applyFixes(input)).toBe('It ran 1990 to 1995.');
  });

  test('straightens curly quotes and apostrophes', () => {
    const input1 = 'He said ' + String.fromCharCode(0x201c) + 'fine' + String.fromCharCode(0x201d) + ' and left.';
    expect(applyFixes(input1)).toBe('He said "fine" and left.');

    const input2 = 'don' + String.fromCharCode(0x2019) + 't';
    expect(applyFixes(input2)).toBe("don't");
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
    const input = 'He wrote ' + String.fromCharCode(0x201c) + 'wait ' + String.fromCharCode(0x2014) + ' really?' + String.fromCharCode(0x201d) + ' and left.';
    expect(applyFixes(input)).toBe('He wrote "wait ' + String.fromCharCode(0x2014) + ' really?" and left.');
  });
});

describe('detect', () => {
  test('reports em dashes with rule id and span', () => {
    const tells = detect('A' + String.fromCharCode(0x2014) + 'B');
    expect(tells).toHaveLength(1);
    expect(tells[0]).toMatchObject({ ruleId: 'em-dash', span: { start: 1, end: 2 } });
  });

  test('skips quoted regions for skipQuoted rules', () => {
    const input = 'say ' + String.fromCharCode(0x201c) + 'A' + String.fromCharCode(0x2014) + 'B' + String.fromCharCode(0x201d) + ' now';
    const tells = detect(input);
    expect(tells.filter(t => t.ruleId === 'em-dash')).toHaveLength(0);
  });
});