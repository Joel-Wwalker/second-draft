import { expect, test } from 'vitest';
import { findAlternatives, shiftRangesAfter, swapWord } from '../src/shared/alternatives';

test('finds swappable words with options', () => {
  const spans = findAlternatives('We delve into a vibrant landscape.');
  expect(spans.map(s => s.word)).toEqual(['delve', 'vibrant', 'landscape']);
  expect(spans[0]!.options[0]).toBe('dig');
});

test('skips words inside skip spans', () => {
  const text = 'We delve into a vibrant place.';
  const skip = [{ start: 3, end: 8 }];
  expect(findAlternatives(text, skip).map(s => s.word)).toEqual(['vibrant']);
});

test('ignores suffixed forms that would need conjugation', () => {
  expect(findAlternatives('It showcases and delves deeply.')).toEqual([]);
});

test('swapWord preserves capitalization', () => {
  const text = 'Delve into it.';
  expect(swapWord(text, { start: 0, end: 5 }, 'dig')).toBe('Dig into it.');
  const mid = 'We delve in.';
  expect(swapWord(mid, { start: 3, end: 8 }, 'dig')).toBe('We dig in.');
});

test('swapping a word moves the highlights that come after it', () => {
  // "delve" (5) to "dig" (3) shortens the text by 2, so the later highlight has
  // to slide back by 2 or it points two characters past its own word.
  const text = 'We delve into the tapestry of it.';
  const span = { start: 3, end: 8, word: 'delve', options: ['dig'] };
  const changes = [
    { range: { start: 3, end: 8 } }, // the swapped word itself
    { range: { start: 18, end: 26 } }, // "tapestry", downstream
  ];
  const swapped = swapWord(text, span, 'dig');
  expect(swapped).toBe('We dig into the tapestry of it.');
  const moved = shiftRangesAfter(changes, span.end, swapped.length - text.length);
  expect(moved[0]!.range).toEqual({ start: 3, end: 8 });
  expect(moved[1]!.range).toEqual({ start: 16, end: 24 });
  expect(swapped.slice(16, 24)).toBe('tapestry');
});

test('a swap of equal length moves nothing', () => {
  const changes = [{ range: { start: 10, end: 20 } }];
  expect(shiftRangesAfter(changes, 5, 0)).toEqual(changes);
});

test('a longer replacement moves later highlights forward', () => {
  const changes = [{ range: { start: 0, end: 3 } }, { range: { start: 10, end: 14 } }];
  const moved = shiftRangesAfter(changes, 5, +4);
  expect(moved[0]!.range).toEqual({ start: 0, end: 3 });
  expect(moved[1]!.range).toEqual({ start: 14, end: 18 });
});
