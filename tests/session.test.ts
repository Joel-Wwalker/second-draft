// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { ApplyResponse, CaptureResponse } from '../src/shared/messages';

type Listener = (
  msg: unknown,
  sender?: chrome.runtime.MessageSender,
  sendResponse?: (res: CaptureResponse | ApplyResponse) => void,
) => void;

let listeners: Listener[] = [];
let session: import('../src/content/session').HumanizeSession;

// jsdom lacks Range.getBoundingClientRect; nothing here positions UI, but
// replace.ts's contenteditable path touches Range APIs.
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = function (this: Range): DOMRect {
    return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) } as DOMRect;
  };
}

beforeEach(async () => {
  listeners = [];
  (globalThis as Record<string, unknown>)['chrome'] = {
    runtime: {
      id: 'test',
      onMessage: {
        addListener: (fn: Listener): void => void listeners.push(fn),
        removeListener: (fn: Listener): void => {
          const i = listeners.indexOf(fn);
          if (i >= 0) listeners.splice(i, 1);
        },
      },
    },
  } as unknown as typeof chrome;
  document.body.innerHTML = '<textarea>We delve into the plan boldly.</textarea>';
  const { HumanizeSession } = await import('../src/content/session');
  session = new HumanizeSession(document);
  session.start();
});

afterEach(() => {
  session.stop();
});

/** Drive the content script the way the popup and background do. */
function send(msg: unknown, sender: chrome.runtime.MessageSender = { id: 'test' }): unknown {
  let response: unknown;
  for (const fn of [...listeners]) fn(msg, sender, res => (response = res));
  return response;
}

function selectAllOfTextarea(): HTMLTextAreaElement {
  const ta = document.querySelector('textarea')!;
  ta.focus();
  ta.setSelectionRange(0, ta.value.length);
  return ta;
}

test('capture hands over the selected text and says it can be applied', () => {
  selectAllOfTextarea();
  expect(send({ type: 'capture' })).toEqual({
    ok: true,
    text: 'We delve into the plan boldly.',
    canApply: true,
  });
});

test('capture refuses when nothing is selected', () => {
  expect(send({ type: 'capture' })).toEqual({ ok: false, reason: 'none' });
});

test('capture never hands over a credential field', () => {
  document.body.innerHTML = '<input type="text" autocomplete="cc-number" value="4111111111111111">';
  const input = document.querySelector('input')!;
  input.focus();
  input.setSelectionRange(0, 16);
  expect(send({ type: 'capture' })).toEqual({ ok: false, reason: 'sensitive' });
});

test('apply writes the rewrite into the captured field, and undo puts the original back', () => {
  selectAllOfTextarea();
  send({ type: 'capture' });
  expect(send({ type: 'apply', text: 'We dig into the plan boldly.' })).toEqual({ ok: true });
  expect(document.querySelector('textarea')!.value).toBe('We dig into the plan boldly.');
  expect(send({ type: 'undo' })).toEqual({ ok: true });
  expect(document.querySelector('textarea')!.value).toBe('We delve into the plan boldly.');
});

test('apply without a capture does nothing', () => {
  expect(send({ type: 'apply', text: 'anything' })).toEqual({ ok: false });
  expect(document.querySelector('textarea')!.value).toBe('We delve into the plan boldly.');
});

test('undo refuses when the applied text is gone from the field', () => {
  const ta = selectAllOfTextarea();
  send({ type: 'capture' });
  send({ type: 'apply', text: 'We dig into the plan boldly.' });
  ta.value = 'Something else entirely.';
  expect(send({ type: 'undo' })).toEqual({ ok: false });
  expect(ta.value).toBe('Something else entirely.');
});

test('apply and undo work on a partial contenteditable selection across text nodes', () => {
  document.body.innerHTML = '<div contenteditable="true">We delve into the plan boldly, said the team.</div>';
  const el = document.querySelector('div')!;
  const textNode = el.firstChild!;
  const range = document.createRange();
  range.setStart(textNode, 3);
  range.setEnd(textNode, 22);
  const sel = document.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  expect(send({ type: 'capture' })).toEqual({ ok: true, text: 'delve into the plan', canApply: true });
  expect(send({ type: 'apply', text: 'dig into the strategy' })).toEqual({ ok: true });
  expect(el.textContent).toBe('We dig into the strategy boldly, said the team.');
  expect(send({ type: 'undo' })).toEqual({ ok: true });
  expect(el.textContent).toBe('We delve into the plan boldly, said the team.');
});

test('non-editable page text is handed over but marked as not applyable', () => {
  document.body.innerHTML = '<p>Plain page text that is long enough to select.</p>';
  const p = document.querySelector('p')!;
  const range = document.createRange();
  range.selectNodeContents(p);
  const sel = document.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  expect(send({ type: 'capture' })).toEqual({
    ok: true,
    text: 'Plain page text that is long enough to select.',
    canApply: false,
  });
  expect(send({ type: 'apply', text: 'rewritten' })).toEqual({ ok: false });
});

test('a foreign sender is ignored', () => {
  selectAllOfTextarea();
  expect(send({ type: 'capture' }, { id: 'some-other-extension' })).toBeUndefined();
});

test('stop removes the listener and clears what was captured', () => {
  selectAllOfTextarea();
  send({ type: 'capture' });
  const retained = listeners[0]!;
  session.stop();
  expect(listeners).toHaveLength(0);
  let answered = false;
  retained({ type: 'apply', text: 'x' }, { id: 'test' }, () => (answered = true));
  expect(answered).toBe(false);
  expect(document.querySelector('textarea')!.value).toBe('We delve into the plan boldly.');
});
