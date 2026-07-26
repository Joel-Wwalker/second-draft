// @vitest-environment jsdom
import { beforeEach, expect, test } from 'vitest';
import { applyReplacement, locate } from '../src/content/replace';
import type { EditableSelection } from '../src/content/selection';

beforeEach(() => {
  document.body.innerHTML = '';
});

test('locate finds a unique occurrence and rejects ambiguity', () => {
  expect(locate('a delve b', 'delve')).toBe(2);
  expect(locate('delve delve', 'delve')).toBeNull();
  expect(locate('nothing here', 'delve')).toBeNull();
});

test('replaces a field selection and fires an input event', () => {
  document.body.innerHTML = '<textarea>We delve into the plan.</textarea>';
  const el = document.querySelector('textarea')!;
  let fired = false;
  el.addEventListener('input', () => {
    fired = true;
  });
  const target: EditableSelection = { kind: 'field', el, start: 3, end: 8, text: 'delve' };
  expect(applyReplacement(target, 'dig', document)).toBe(true);
  expect(el.value).toBe('We dig into the plan.');
  expect(fired).toBe(true);
});

test('relocates drifted text when it is unique', () => {
  document.body.innerHTML = '<textarea>PREFIX We delve into the plan.</textarea>';
  const el = document.querySelector('textarea')!;
  // Captured before "PREFIX " was typed, so offsets are stale:
  const target: EditableSelection = { kind: 'field', el, start: 3, end: 8, text: 'delve' };
  expect(applyReplacement(target, 'dig', document)).toBe(true);
  expect(el.value).toBe('PREFIX We dig into the plan.');
});

test('refuses ambiguous relocation and leaves the field untouched', () => {
  document.body.innerHTML = '<textarea>delve or delve</textarea>';
  const el = document.querySelector('textarea')!;
  const target: EditableSelection = { kind: 'field', el, start: 0, end: 5, text: 'delve' };
  // Both stale-offset text ("delve" at 0..5 matches!) -- craft real drift:
  el.value = 'now delve or delve';
  expect(applyReplacement(target, 'dig', document)).toBe(false);
  expect(el.value).toBe('now delve or delve');
});

test('replaces inside contenteditable and refuses when the range drifted', () => {
  document.body.innerHTML = '<div contenteditable="true">We delve into the plan today.</div>';
  const root = document.querySelector('div')!;
  const textNode = root.firstChild!;
  const range = document.createRange();
  range.setStart(textNode, 3);
  range.setEnd(textNode, 8);
  const good: EditableSelection = { kind: 'editable', root, range: range.cloneRange(), text: 'delve' };
  expect(applyReplacement(good, 'dig', document)).toBe(true);
  expect(root.textContent).toBe('We dig into the plan today.');

  const stale: EditableSelection = { kind: 'editable', root, range: range.cloneRange(), text: 'delve' };
  // Range text no longer matches the captured text after the first replacement:
  expect(applyReplacement(stale, 'dig', document)).toBe(false);
});
