import { expect, test } from 'vitest';
import { findAlternatives, swapWord } from '../src/shared/alternatives';

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
