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

test('rejects input types without a readable selection', () => {
  document.body.innerHTML = '<input type="number" value="123456789012">';
  document.querySelector('input')!.focus();
  expect(getEditableSelection(document)).toBeNull();

  document.body.innerHTML = '<input type="email" value="someone@example.com">';
  document.querySelector('input')!.focus();
  expect(getEditableSelection(document)).toBeNull();
});

test('never captures password fields', () => {
  document.body.innerHTML = '<input type="password" value="hunter2hunter2">';
  document.querySelector('input')!.focus();
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

test('resolves the editable root when the selection anchors in a text node', () => {
  document.body.innerHTML = '<div contenteditable="true">hello <b>wonderful text</b> world</div>';
  const textNode = document.querySelector('b')!.firstChild!;
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, 14);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  const result = getEditableSelection(document);
  expect(result).toMatchObject({ kind: 'editable', text: 'wonderful text' });
});

test('never captures credential-scented text fields', () => {
  document.body.innerHTML = '<input type="text" autocomplete="cc-number" value="4111111111111111">';
  const input = document.querySelector('input')!;
  input.focus();
  input.setSelectionRange(0, 16);
  expect(getEditableSelection(document)).toBeNull();
});
