// @vitest-environment jsdom
import { beforeEach, expect, test } from 'vitest';
import { getEditableSelection, getPlainSelection } from '../src/content/selection';

beforeEach(() => {
  document.body.innerHTML = '';
});

test('extracts a textarea selection of 10+ chars', () => {
  document.body.innerHTML = '<textarea>hello wonderful world</textarea>';
  const ta = document.querySelector('textarea')!;
  ta.focus();
  ta.setSelectionRange(0, 15);
  const sel = getEditableSelection(document);
  expect(sel).toMatchObject({ kind: 'field', start: 0, end: 15, text: 'hello wonderful' });
});

test('returns null under the minimum length', () => {
  document.body.innerHTML = '<textarea>hello wonderful world</textarea>';
  const ta = document.querySelector('textarea')!;
  ta.focus();
  ta.setSelectionRange(0, 5);
  expect(getEditableSelection(document)).toBeNull();
});

test('rejects non-text input types', () => {
  document.body.innerHTML = '<input type="number" value="123456789012">';
  const input = document.querySelector('input')!;
  input.focus();
  expect(getEditableSelection(document)).toBeNull();
});

test('extracts a contenteditable selection', () => {
  document.body.innerHTML = '<div contenteditable="true">some editable content here</div>';
  const div = document.querySelector('div')!;
  const range = document.createRange();
  range.selectNodeContents(div);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  const result = getEditableSelection(document);
  expect(result).toMatchObject({ kind: 'editable', text: 'some editable content here' });
});

test('ignores selections outside editable areas', () => {
  document.body.innerHTML = '<div>plain page text that is long enough</div>';
  const div = document.querySelector('div')!;
  const range = document.createRange();
  range.selectNodeContents(div);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  expect(getEditableSelection(document)).toBeNull();
  expect(getPlainSelection(document)).toBe('plain page text that is long enough');
});
