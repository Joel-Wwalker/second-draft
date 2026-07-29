import { expect, test } from 'vitest';
import { checkFidelity } from '../src/shared/fidelity';

const kinds = (original: string, rewritten: string): string[] =>
  checkFidelity(original, rewritten).map(i => i.kind);

test('a faithful rewrite reports nothing', () => {
  const original = 'We delve into the plan. It covers three regions and starts in March.';
  const rewritten = 'We dig into the plan. It covers three regions and starts in March.';
  expect(checkFidelity(original, rewritten)).toEqual([]);
});

test('a dropped number is reported by name', () => {
  const original = 'Revenue reached $4.2M in 1994 across 12 stores.';
  const rewritten = 'Revenue grew a lot that year across several stores.';
  const issues = checkFidelity(original, rewritten);
  expect(issues.map(i => i.kind)).toContain('missing-facts');
  const message = issues.find(i => i.kind === 'missing-facts')!.message;
  expect(message).toContain('$4.2M');
  expect(message).toContain('1994');
  expect(message).toContain('12');
});

test('a dropped name is reported when it appears mid sentence', () => {
  const original = 'The agreement was signed by Martinez in Lisbon last spring.';
  const rewritten = 'The agreement was signed abroad last spring.';
  const message = checkFidelity(original, rewritten).find(i => i.kind === 'missing-facts')!.message;
  expect(message).toContain('Martinez');
  expect(message).toContain('Lisbon');
});

test('a name only ever at the start of a sentence is a known miss, not a false alarm', () => {
  // Documented limitation: sentence-initial capitals cannot be told apart from
  // ordinary openers, so they are skipped rather than risking a false warning.
  const original = 'Martinez signed it.';
  const rewritten = 'Someone signed it.';
  expect(kinds(original, rewritten)).not.toContain('missing-facts');
});

test('a capitalized sentence opener is not mistaken for a fact', () => {
  // "Teams" only appears because it starts a sentence; rewording the opener is
  // style, not a lost fact, so it must not be reported.
  const original = 'Teams often struggle with this. Teams often struggle with this.';
  const rewritten = 'This is often a struggle. It usually is.';
  expect(kinds(original, rewritten)).not.toContain('missing-facts');
});

test('a rewrite far shorter than the original is flagged', () => {
  const original = Array.from({ length: 40 }, () => 'padding').join(' ');
  const rewritten = Array.from({ length: 20 }, () => 'padding').join(' ');
  const issue = checkFidelity(original, rewritten).find(i => i.kind === 'shorter');
  expect(issue?.message).toBe('The rewrite is 50 percent shorter, so it may have dropped content.');
});

test('a modest trim is not flagged as shorter', () => {
  const original = Array.from({ length: 40 }, () => 'padding').join(' ');
  const rewritten = Array.from({ length: 30 }, () => 'padding').join(' ');
  expect(kinds(original, rewritten)).not.toContain('shorter');
});

test('a lost paragraph is flagged', () => {
  const original = 'First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.';
  const rewritten = 'First paragraph here.\n\nSecond paragraph here.';
  const issue = checkFidelity(original, rewritten).find(i => i.kind === 'fewer-paragraphs');
  expect(issue?.message).toBe('The original had 3 paragraphs and the rewrite has 2.');
});

test('gaining a paragraph is not flagged', () => {
  const original = 'One long paragraph that the model decided to split up for readability.';
  const rewritten = 'One long paragraph.\n\nThe model split it up for readability.';
  expect(kinds(original, rewritten)).not.toContain('fewer-paragraphs');
});

test('an altered quotation is flagged', () => {
  const original = 'She said "the project is on track" at the meeting.';
  const rewritten = 'She said "the project is going well" at the meeting.';
  expect(kinds(original, rewritten)).toContain('quote-changed');
});

test('an untouched quotation is not flagged', () => {
  const original = 'She said "the project is on track" at the meeting.';
  const rewritten = 'At the meeting she said "the project is on track".';
  expect(kinds(original, rewritten)).not.toContain('quote-changed');
});

test('several problems are reported together', () => {
  const original = 'Martinez raised $4.2M in 1994.\n\nThe round closed in Lisbon.';
  const rewritten = 'Someone raised money.';
  expect(kinds(original, rewritten)).toEqual(
    expect.arrayContaining(['missing-facts', 'shorter', 'fewer-paragraphs']),
  );
});
